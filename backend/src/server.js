require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { initDb } = require("./db");

const app = express();
const db = initDb();

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@coswap.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(morgan("dev"));

ensureAdminUser();

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, is_admin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    is_admin: !!row.is_admin,
    pending_fee: row.pending_fee,
    created_at: row.created_at
  };
}

function notify(userId, message, action = null) {
  db.prepare(
    "INSERT INTO notifications (user_id, message, action, created_at) VALUES (?, ?, ?, ?)"
  ).run(userId, message, action, new Date().toISOString());
}

function notifyAdmins(message, action = null) {
  const admins = db.prepare("SELECT id FROM users WHERE is_admin = 1").all();
  admins.forEach((admin) => notify(admin.id, message, action));
}

function getSellerStats(sellerId) {
  const user = db.prepare("SELECT rating_sum, rating_count FROM users WHERE id = ?").get(sellerId);
  if (!user) return { rating: null, fraudPercent: 0, level: 1 };

  const sold = db.prepare(
    `SELECT COUNT(*) AS total_sold,
            COUNT(DISTINCT purchases.buyer_id) AS customers
     FROM purchases
     JOIN coupons ON coupons.id = purchases.coupon_id
     WHERE coupons.seller_id = ?`
  ).get(sellerId);

  const reportCount = db.prepare(
    "SELECT COUNT(*) AS total_reports FROM reports WHERE seller_id = ?"
  ).get(sellerId);

  const totalSold = sold.total_sold || 0;
  const customers = sold.customers || 0;
  const fraudPercent = totalSold > 0 ? Math.round((reportCount.total_reports / totalSold) * 100) : 0;
  const rating =
    user.rating_count > 0 ? (user.rating_sum / user.rating_count).toFixed(1) : null;

  let level = 1;
  if (customers >= 10) level = 2;
  if (customers >= 25) level = 3;
  if (customers >= 50) level = 4;
  if (customers >= 100) level = 5;

  return { rating, fraudPercent, level };
}

function ensureAdminUser() {
  const admin = db.prepare("SELECT * FROM users WHERE email = ?").get(ADMIN_EMAIL);
  if (!admin) {
    const password_hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    const created_at = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (name, email, password_hash, created_at, status, is_admin) VALUES (?, ?, ?, ?, 'active', 1)"
    ).run("Admin", ADMIN_EMAIL.toLowerCase(), password_hash, created_at);
  } else if (!admin.is_admin) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.id);
  }
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireAdmin(req, res, next) {
  auth(req, res, () => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: "Admin access required." });
    }
    req.admin = user;
    next();
  });
}

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Auth
app.post("/auth/signup", (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ error: "Email already registered." });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const created_at = new Date().toISOString();
  const info = db
    .prepare("INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(name.trim(), email.trim().toLowerCase(), password_hash, created_at);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  const token = createToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  if (user.status === "frozen") {
    return res.status(403).json({ error: "Account frozen. Please contact support." });
  }
  if (user.status === "deleted") {
    return res.status(403).json({ error: "Account disabled. Please contact support." });
  }

  const token = createToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

app.post("/auth/forgot", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required." });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!user) return res.status(404).json({ error: "Email not found." });

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const reset_token = crypto.randomBytes(24).toString("hex");
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare(
    "INSERT INTO password_resets (email, otp, reset_token, expires_at) VALUES (?, ?, ?, ?)"
  ).run(email.trim().toLowerCase(), otp, reset_token, expires_at);

  res.json({ message: "OTP generated", otp });
});

app.post("/auth/verify-otp", (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ error: "Email and OTP are required." });
  }

  const record = db.prepare(
    "SELECT * FROM password_resets WHERE email = ? AND otp = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1"
  ).get(email.trim().toLowerCase(), String(otp).trim());

  if (!record) return res.status(400).json({ error: "Invalid OTP." });

  if (new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: "OTP expired." });
  }

  res.json({ resetToken: record.reset_token });
});

app.post("/auth/reset", (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) {
    return res.status(400).json({ error: "Reset token and new password are required." });
  }

  const record = db.prepare(
    "SELECT * FROM password_resets WHERE reset_token = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1"
  ).get(resetToken);

  if (!record) return res.status(400).json({ error: "Invalid reset token." });
  if (new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: "Reset token expired." });
  }

  const password_hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(
    password_hash,
    record.email
  );

  db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    record.id
  );

  res.json({ message: "Password reset successful." });
});

app.get("/me", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: sanitizeUser(user) });
});

app.get("/me/profile", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });

  const sold = db.prepare(
    `SELECT COUNT(*) AS total_sold,
            COUNT(DISTINCT purchases.buyer_id) AS customers
     FROM purchases
     JOIN coupons ON coupons.id = purchases.coupon_id
     WHERE coupons.seller_id = ?`
  ).get(req.user.id);

  const reportCount = db.prepare(
    "SELECT COUNT(*) AS total_reports FROM reports WHERE seller_id = ?"
  ).get(req.user.id);

  const totalSold = sold.total_sold || 0;
  const customers = sold.customers || 0;
  const fraudReports = reportCount.total_reports || 0;
  const fraudPercent = totalSold > 0 ? Math.round((fraudReports / totalSold) * 100) : 0;

  const rating =
    user.rating_count > 0 ? (user.rating_sum / user.rating_count).toFixed(1) : null;

  let level = 1;
  let maxPrice = 10;
  if (customers >= 10) { level = 2; maxPrice = 20; }
  if (customers >= 25) { level = 3; maxPrice = 40; }
  if (customers >= 50) { level = 4; maxPrice = 70; }
  if (customers >= 100) { level = 5; maxPrice = 100; }

  res.json({
    profile: {
      id: user.id,
      name: user.name,
      customers,
      totalSold,
      fraudReports,
      fraudPercent,
      rating,
      ratingCount: user.rating_count,
      level,
      maxPrice,
      status: user.status,
      pending_fee: user.pending_fee
    }
  });
});

app.get("/me/notifications", auth, (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC"
  ).all(req.user.id);
  res.json({ notifications: rows });
});

app.get("/me/wallet", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const payments = db.prepare(
    "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC"
  ).all(req.user.id);

  res.json({
    wallet: {
      pending_fee: user.pending_fee,
      payments
    }
  });
});

app.post("/me/wallet/pay", auth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });

  if (user.pending_fee <= 0) {
    return res.status(400).json({ error: "No pending fees." });
  }

  const amount = user.pending_fee;
  db.prepare("UPDATE users SET pending_fee = 0 WHERE id = ?").run(req.user.id);
  db.prepare(
    "INSERT INTO payments (user_id, amount, method, status, created_at) VALUES (?, ?, ?, 'paid', ?)"
  ).run(req.user.id, amount, "upi", new Date().toISOString());

  notify(req.user.id, "Payment received. Your pending fee is cleared.", "wallet.html");

  res.json({ message: "Payment recorded.", amount });
});

app.get("/sellers/:id", (req, res) => {
  const seller = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!seller) return res.status(404).json({ error: "Seller not found." });

  const sold = db.prepare(
    `SELECT COUNT(*) AS total_sold,
            COUNT(DISTINCT purchases.buyer_id) AS customers
     FROM purchases
     JOIN coupons ON coupons.id = purchases.coupon_id
     WHERE coupons.seller_id = ?`
  ).get(seller.id);

  const reportCount = db.prepare(
    "SELECT COUNT(*) AS total_reports FROM reports WHERE seller_id = ?"
  ).get(seller.id);

  const totalSold = sold.total_sold || 0;
  const customers = sold.customers || 0;
  const fraudReports = reportCount.total_reports || 0;
  const fraudPercent = totalSold > 0 ? Math.round((fraudReports / totalSold) * 100) : 0;
  const rating =
    seller.rating_count > 0 ? (seller.rating_sum / seller.rating_count).toFixed(1) : "4.8";

  let level = 1;
  if (customers >= 10) level = 2;
  if (customers >= 25) level = 3;
  if (customers >= 50) level = 4;
  if (customers >= 100) level = 5;

  res.json({
    seller: {
      id: seller.id,
      name: seller.name,
      customers,
      rating,
      ratingCount: seller.rating_count,
      fraudPercent,
      fraudVotes: seller.fraud_votes,
      genuineVotes: seller.genuine_votes,
      level
    }
  });
});

app.post("/sellers/:id/rate", auth, (req, res) => {
  const { rating } = req.body || {};
  const val = Number(rating);
  if (!val || val < 1 || val > 5) {
    return res.status(400).json({ error: "Rating must be between 1 and 5." });
  }

  const seller = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!seller) return res.status(404).json({ error: "Seller not found." });

  db.prepare(
    "UPDATE users SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?"
  ).run(val, seller.id);

  notify(seller.id, "You received a new seller rating.", "sellerprofile.html");

  res.json({ message: "Rating recorded." });
});

app.post("/sellers/:id/vote", auth, (req, res) => {
  const { type } = req.body || {};
  if (!type || !["genuine", "fraud"].includes(type)) {
    return res.status(400).json({ error: "Vote type must be genuine or fraud." });
  }

  const seller = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!seller) return res.status(404).json({ error: "Seller not found." });

  if (type === "genuine") {
    db.prepare("UPDATE users SET genuine_votes = genuine_votes + 1 WHERE id = ?").run(
      seller.id
    );
  } else {
    db.prepare("UPDATE users SET fraud_votes = fraud_votes + 1 WHERE id = ?").run(
      seller.id
    );
  }

  notify(seller.id, "A buyer left feedback on your profile.", "sellerprofile.html");
  res.json({ message: "Vote recorded." });
});

// Coupons
app.get("/coupons", (req, res) => {
  const { search, category, status } = req.query || {};
  const today = new Date().toISOString().split("T")[0];

  const conditions = [];
  const params = [];

  if (status) {
    conditions.push("coupons.status = ?");
    params.push(status);
  } else {
    conditions.push("coupons.status = 'active'");
  }

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }

  if (search) {
    conditions.push("(title LIKE ? OR details LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  conditions.push("(expiry IS NULL OR expiry >= ?)");
  params.push(today);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT coupons.*, users.name AS seller_name
       FROM coupons
       JOIN users ON users.id = coupons.seller_id
       ${where}
       ORDER BY coupons.created_at DESC`
    )
    .all(...params);

  const coupons = rows.map((c) => {
    const stats = getSellerStats(c.seller_id);
    return {
      ...c,
      seller_rating: stats.rating,
      seller_fraud_percent: stats.fraudPercent,
      seller_level: stats.level
    };
  });

  res.json({ coupons });
});

app.get("/coupons/:id", (req, res) => {
  const coupon = db
    .prepare(
      `SELECT coupons.*, users.name AS seller_name
       FROM coupons
       JOIN users ON users.id = coupons.seller_id
       WHERE coupons.id = ?`
    )
    .get(req.params.id);

  if (!coupon) return res.status(404).json({ error: "Coupon not found." });
  const stats = getSellerStats(coupon.seller_id);
  res.json({
    coupon: {
      ...coupon,
      seller_rating: stats.rating,
      seller_fraud_percent: stats.fraudPercent,
      seller_level: stats.level
    }
  });
});

app.post("/coupons", auth, (req, res) => {
  const { title, details, expiry, price, category, image } = req.body || {};

  if (!title || !price) {
    return res.status(400).json({ error: "Title and price are required." });
  }

  const seller = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!seller) return res.status(404).json({ error: "User not found." });
  if (seller.status === "frozen") {
    return res.status(403).json({ error: "Account frozen. Clear pending fees to sell." });
  }
  if (seller.pending_fee > 0) {
    return res.status(403).json({ error: "Pending fees due. Please pay in wallet to sell." });
  }

  const created_at = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO coupons (title, details, expiry, price, category, image_url, seller_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    )
    .run(
      title.trim(),
      details || "",
      expiry || null,
      Number(price),
      category || "",
      image || "bg.png",
      req.user.id,
      created_at
    );

  const coupon = db
    .prepare(
      `SELECT coupons.*, users.name AS seller_name
       FROM coupons
       JOIN users ON users.id = coupons.seller_id
       WHERE coupons.id = ?`
    )
    .get(info.lastInsertRowid);

  res.json({ coupon });
});

app.put("/coupons/:id", auth, (req, res) => {
  const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(req.params.id);
  if (!coupon) return res.status(404).json({ error: "Coupon not found." });
  if (coupon.seller_id !== req.user.id) {
    return res.status(403).json({ error: "Not allowed." });
  }

  const { title, details, expiry, price, category, image_url, status } = req.body || {};

  db.prepare(
    `UPDATE coupons
     SET title = ?, details = ?, expiry = ?, price = ?, category = ?, image_url = ?, status = ?
     WHERE id = ?`
  ).run(
    title ?? coupon.title,
    details ?? coupon.details,
    expiry ?? coupon.expiry,
    price ?? coupon.price,
    category ?? coupon.category,
    image_url ?? coupon.image_url,
    status ?? coupon.status,
    coupon.id
  );

  const updated = db
    .prepare(
      `SELECT coupons.*, users.name AS seller_name
       FROM coupons
       JOIN users ON users.id = coupons.seller_id
       WHERE coupons.id = ?`
    )
    .get(coupon.id);

  res.json({ coupon: updated });
});

app.delete("/coupons/:id", auth, (req, res) => {
  const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(req.params.id);
  if (!coupon) return res.status(404).json({ error: "Coupon not found." });
  if (coupon.seller_id !== req.user.id) {
    return res.status(403).json({ error: "Not allowed." });
  }

  db.prepare("DELETE FROM coupons WHERE id = ?").run(coupon.id);
  res.status(204).send();
});

app.get("/me/listings", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT coupons.*, users.name AS seller_name
       FROM coupons
       JOIN users ON users.id = coupons.seller_id
       WHERE coupons.seller_id = ?
       ORDER BY coupons.created_at DESC`
    )
    .all(req.user.id);
  res.json({ coupons: rows });
});

// Purchases
app.post("/purchases", auth, (req, res) => {
  const { couponId } = req.body || {};
  if (!couponId) return res.status(400).json({ error: "couponId is required." });

  const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(couponId);
  if (!coupon) return res.status(404).json({ error: "Coupon not found." });
  if (coupon.status !== "active") {
    return res.status(400).json({ error: "Coupon not available." });
  }
  if (coupon.seller_id === req.user.id) {
    return res.status(400).json({ error: "You cannot purchase your own coupon." });
  }

  const purchased_at = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO purchases (coupon_id, buyer_id, price, status, purchased_at)
       VALUES (?, ?, ?, 'success', ?)`
    )
    .run(coupon.id, req.user.id, coupon.price, purchased_at);

  db.prepare("UPDATE coupons SET status = 'sold' WHERE id = ?").run(coupon.id);

  const fee = Math.round(coupon.price * 0.05 * 100) / 100;
  if (fee > 0) {
    db.prepare("UPDATE users SET pending_fee = pending_fee + ? WHERE id = ?").run(
      fee,
      coupon.seller_id
    );
  }

  notify(req.user.id, "Purchase completed successfully.", "mypurchases.html");
  notify(coupon.seller_id, "Your coupon was sold. A fee has been added to your wallet.", "wallet.html");

  const purchase = db
    .prepare(
      `SELECT purchases.*, coupons.title, coupons.image_url, coupons.seller_id, coupons.category
       FROM purchases
       JOIN coupons ON coupons.id = purchases.coupon_id
       WHERE purchases.id = ?`
    )
    .get(info.lastInsertRowid);

  res.json({ purchase, fee });
});

app.get("/me/purchases", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT purchases.*, coupons.title, coupons.image_url, coupons.category, coupons.expiry,
              users.name AS seller_name
       FROM purchases
       JOIN coupons ON coupons.id = purchases.coupon_id
       JOIN users ON users.id = coupons.seller_id
       WHERE purchases.buyer_id = ?
       ORDER BY purchases.purchased_at DESC`
    )
    .all(req.user.id);
  res.json({ purchases: rows });
});

// Chats
app.post("/chats", auth, (req, res) => {
  const { couponId } = req.body || {};
  if (!couponId) return res.status(400).json({ error: "couponId is required." });

  const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(couponId);
  if (!coupon) return res.status(404).json({ error: "Coupon not found." });

  if (coupon.seller_id === req.user.id) {
    return res.status(400).json({ error: "Cannot chat with yourself." });
  }

  const existing = db
    .prepare(
      "SELECT * FROM chats WHERE coupon_id = ? AND buyer_id = ? AND seller_id = ?"
    )
    .get(coupon.id, req.user.id, coupon.seller_id);

  if (existing) return res.json({ chat: existing });

  const created_at = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO chats (coupon_id, buyer_id, seller_id, status, created_at)
       VALUES (?, ?, ?, 'active', ?)`
    )
    .run(coupon.id, req.user.id, coupon.seller_id, created_at);

  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(info.lastInsertRowid);
  res.json({ chat });
});

app.get("/chats", auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT chats.*, coupons.title AS coupon_title,
              u1.name AS buyer_name, u2.name AS seller_name
       FROM chats
       JOIN coupons ON coupons.id = chats.coupon_id
       JOIN users u1 ON u1.id = chats.buyer_id
       JOIN users u2 ON u2.id = chats.seller_id
       WHERE chats.buyer_id = ? OR chats.seller_id = ?
       ORDER BY chats.last_message_at DESC, chats.created_at DESC`
    )
    .all(req.user.id, req.user.id);
  res.json({ chats: rows });
});

app.get("/chats/:id", auth, (req, res) => {
  const chat = db
    .prepare(
      `SELECT chats.*, coupons.title AS coupon_title,
              u1.name AS buyer_name, u2.name AS seller_name
       FROM chats
       JOIN coupons ON coupons.id = chats.coupon_id
       JOIN users u1 ON u1.id = chats.buyer_id
       JOIN users u2 ON u2.id = chats.seller_id
       WHERE chats.id = ?`
    )
    .get(req.params.id);

  if (!chat) return res.status(404).json({ error: "Chat not found." });
  if (chat.buyer_id !== req.user.id && chat.seller_id !== req.user.id) {
    return res.status(403).json({ error: "Not allowed." });
  }

  res.json({ chat });
});

app.get("/chats/:id/messages", auth, (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  if (chat.buyer_id !== req.user.id && chat.seller_id !== req.user.id) {
    return res.status(403).json({ error: "Not allowed." });
  }

  const rows = db
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC")
    .all(chat.id);

  res.json({ messages: rows });
});

app.post("/chats/:id/messages", auth, (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: "Message body is required." });

  const chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(req.params.id);
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  if (chat.buyer_id !== req.user.id && chat.seller_id !== req.user.id) {
    return res.status(403).json({ error: "Not allowed." });
  }

  const created_at = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (chat_id, sender_id, body, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(chat.id, req.user.id, body, created_at);

  db.prepare(
    "UPDATE chats SET last_message = ?, last_message_at = ? WHERE id = ?"
  ).run(body, created_at, chat.id);

  const message = db.prepare("SELECT * FROM messages WHERE id = ?").get(info.lastInsertRowid);
  res.json({ message });
});

function expireRequests() {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE buy_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < ?"
  ).run(now);
}

// Buy Requests
app.post("/requests", auth, (req, res) => {
  const { couponId } = req.body || {};
  if (!couponId) return res.status(400).json({ error: "couponId is required." });

  const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(couponId);
  if (!coupon) return res.status(404).json({ error: "Coupon not found." });
  if (coupon.status !== "active") {
    return res.status(400).json({ error: "Coupon not available." });
  }
  if (coupon.seller_id === req.user.id) {
    return res.status(400).json({ error: "You cannot request your own coupon." });
  }

  expireRequests();

  const existing = db.prepare(
    "SELECT * FROM buy_requests WHERE coupon_id = ? AND buyer_id = ? AND status = 'pending'"
  ).get(coupon.id, req.user.id);
  if (existing) return res.json({ request: existing });

  const created_at = new Date().toISOString();
  const expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const info = db.prepare(
    `INSERT INTO buy_requests (coupon_id, buyer_id, seller_id, status, created_at, expires_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  ).run(coupon.id, req.user.id, coupon.seller_id, created_at, expires_at);

  notify(
    coupon.seller_id,
    "New buy request received. Please respond.",
    "requests.html"
  );

  const request = db.prepare("SELECT * FROM buy_requests WHERE id = ?").get(info.lastInsertRowid);
  res.json({ request });
});

app.get("/me/requests", auth, (req, res) => {
  expireRequests();

  const asSeller = db.prepare(
    `SELECT buy_requests.*, coupons.title AS coupon_title, users.name AS buyer_name
     FROM buy_requests
     JOIN coupons ON coupons.id = buy_requests.coupon_id
     JOIN users ON users.id = buy_requests.buyer_id
     WHERE buy_requests.seller_id = ?
     ORDER BY buy_requests.created_at DESC`
  ).all(req.user.id);

  const asBuyer = db.prepare(
    `SELECT buy_requests.*, coupons.title AS coupon_title, users.name AS seller_name
     FROM buy_requests
     JOIN coupons ON coupons.id = buy_requests.coupon_id
     JOIN users ON users.id = buy_requests.seller_id
     WHERE buy_requests.buyer_id = ?
     ORDER BY buy_requests.created_at DESC`
  ).all(req.user.id);

  res.json({ asSeller, asBuyer });
});

app.get("/requests/:id", auth, (req, res) => {
  expireRequests();

  const request = db.prepare("SELECT * FROM buy_requests WHERE id = ?").get(req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found." });
  if (request.buyer_id !== req.user.id && request.seller_id !== req.user.id) {
    return res.status(403).json({ error: "Not allowed." });
  }

  res.json({ request });
});

app.post("/requests/:id/accept", auth, (req, res) => {
  expireRequests();

  const request = db.prepare("SELECT * FROM buy_requests WHERE id = ?").get(req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found." });
  if (request.seller_id !== req.user.id) {
    return res.status(403).json({ error: "Not allowed." });
  }
  if (request.status !== "pending") {
    return res.status(400).json({ error: "Request is not pending." });
  }

  let chat = db.prepare(
    "SELECT * FROM chats WHERE coupon_id = ? AND buyer_id = ? AND seller_id = ?"
  ).get(request.coupon_id, request.buyer_id, request.seller_id);

  if (!chat) {
    const created_at = new Date().toISOString();
    const info = db.prepare(
      `INSERT INTO chats (coupon_id, buyer_id, seller_id, status, created_at)
       VALUES (?, ?, ?, 'active', ?)`
    ).run(request.coupon_id, request.buyer_id, request.seller_id, created_at);
    chat = db.prepare("SELECT * FROM chats WHERE id = ?").get(info.lastInsertRowid);
  }

  db.prepare(
    "UPDATE buy_requests SET status = 'accepted', chat_id = ? WHERE id = ?"
  ).run(chat.id, request.id);

  notify(request.buyer_id, "Your buy request was accepted. Chat is ready.", "chatlist.html");

  res.json({ request: { ...request, status: "accepted", chat_id: chat.id }, chat });
});

app.post("/requests/:id/ignore", auth, (req, res) => {
  expireRequests();

  const request = db.prepare("SELECT * FROM buy_requests WHERE id = ?").get(req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found." });
  if (request.seller_id !== req.user.id) {
    return res.status(403).json({ error: "Not allowed." });
  }
  if (request.status !== "pending") {
    return res.status(400).json({ error: "Request is not pending." });
  }

  db.prepare("UPDATE buy_requests SET status = 'ignored' WHERE id = ?").run(request.id);

  notify(request.buyer_id, "Your buy request was declined.", "browse.html");
  res.json({ request: { ...request, status: "ignored" } });
});

// Reports
app.post("/reports", auth, (req, res) => {
  const { couponId, sellerId, reason, description } = req.body || {};
  if (!reason) return res.status(400).json({ error: "Reason is required." });

  let seller_id = sellerId;
  let coupon_id = couponId || null;

  if (coupon_id) {
    const coupon = db.prepare("SELECT * FROM coupons WHERE id = ?").get(coupon_id);
    if (!coupon) return res.status(404).json({ error: "Coupon not found." });
    seller_id = coupon.seller_id;
  }

  if (!seller_id) return res.status(400).json({ error: "Seller is required." });

  const created_at = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO reports (reporter_id, seller_id, coupon_id, reason, description, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).run(req.user.id, seller_id, coupon_id, reason, description || "", created_at);

  notifyAdmins("New fraud report submitted.", "admin-reports.html");
  notify(seller_id, "A fraud report was filed against your account.", "sellerprofile.html");

  const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(info.lastInsertRowid);
  res.json({ report });
});

// Transactions (buyer)
app.get("/me/transactions", auth, (req, res) => {
  const rows = db.prepare(
    `SELECT purchases.*, coupons.title, coupons.image_url, coupons.category, coupons.expiry,
            users.name AS seller_name
     FROM purchases
     JOIN coupons ON coupons.id = purchases.coupon_id
     JOIN users ON users.id = coupons.seller_id
     WHERE purchases.buyer_id = ?
     ORDER BY purchases.purchased_at DESC`
  ).all(req.user.id);

  const transactions = rows.map((p) => ({
    ...p,
    fee: Math.round(p.price * 0.05 * 100) / 100
  }));

  res.json({ transactions });
});

// Notifications
app.post("/me/notifications/:id/read", auth, (req, res) => {
  db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?")
    .run(new Date().toISOString(), req.params.id, req.user.id);
  res.json({ ok: true });
});

// Admin
app.post("/admin/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());
  if (!user || !user.is_admin) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }

  const token = createToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

app.get("/admin/overview", requireAdmin, (req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 0").get().count;
  const couponCount = db.prepare("SELECT COUNT(*) AS count FROM coupons").get().count;
  const activeChats = db.prepare("SELECT COUNT(*) AS count FROM chats WHERE status = 'active'").get().count;
  const pendingReports = db.prepare("SELECT COUNT(*) AS count FROM reports WHERE status = 'pending'").get().count;
  const frozenSellers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'frozen'").get().count;

  const purchaseRows = db.prepare("SELECT price FROM purchases").all();
  const revenue = purchaseRows.reduce((sum, p) => sum + p.price * 0.05, 0);

  res.json({
    overview: {
      totalUsers,
      couponCount,
      revenue: Math.round(revenue * 100) / 100,
      pendingReports,
      suspiciousSellers: frozenSellers,
      activeChats
    }
  });
});

app.get("/admin/users", requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT users.*,
            (SELECT COUNT(*) FROM reports WHERE seller_id = users.id) AS report_count,
            (SELECT COUNT(*) FROM purchases
             JOIN coupons ON coupons.id = purchases.coupon_id
             WHERE coupons.seller_id = users.id) AS total_sold
     FROM users
     WHERE users.is_admin = 0
     ORDER BY users.created_at DESC`
  ).all();

  const users = rows.map((u) => {
    const rating =
      u.rating_count > 0 ? (u.rating_sum / u.rating_count).toFixed(1) : "4.8";
    const fraudPercent =
      u.total_sold > 0 ? Math.round((u.report_count / u.total_sold) * 100) : 0;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      rating,
      fraudPercent,
      status: u.status
    };
  });

  res.json({ users });
});

app.post("/admin/users/:id/freeze", requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET status = 'frozen' WHERE id = ?").run(req.params.id);
  notify(req.params.id, "Your account was frozen by admin.", "sellerprofile.html");
  res.json({ ok: true });
});

app.post("/admin/users/:id/unfreeze", requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
  notify(req.params.id, "Your account was unfrozen by admin.", "sellerprofile.html");
  res.json({ ok: true });
});

app.delete("/admin/users/:id", requireAdmin, (req, res) => {
  db.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/admin/reports", requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT reports.*, u1.name AS reporter_name, u2.name AS seller_name,
            coupons.title AS coupon_title
     FROM reports
     JOIN users u1 ON u1.id = reports.reporter_id
     JOIN users u2 ON u2.id = reports.seller_id
     LEFT JOIN coupons ON coupons.id = reports.coupon_id
     ORDER BY reports.created_at DESC`
  ).all();

  res.json({ reports: rows });
});

app.post("/admin/reports/:id/warn", requireAdmin, (req, res) => {
  const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found." });

  db.prepare("UPDATE reports SET status = 'warned', resolved_at = ? WHERE id = ?")
    .run(new Date().toISOString(), report.id);
  notify(report.seller_id, "Admin issued a warning based on a report.", "sellerprofile.html");
  res.json({ ok: true });
});

app.post("/admin/reports/:id/freeze", requireAdmin, (req, res) => {
  const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found." });

  db.prepare("UPDATE users SET status = 'frozen' WHERE id = ?").run(report.seller_id);
  db.prepare("UPDATE reports SET status = 'resolved', resolved_at = ? WHERE id = ?")
    .run(new Date().toISOString(), report.id);

  notify(report.seller_id, "Your account was frozen due to repeated reports.", "sellerprofile.html");
  res.json({ ok: true });
});

app.post("/admin/reports/:id/resolve", requireAdmin, (req, res) => {
  db.prepare("UPDATE reports SET status = 'resolved', resolved_at = ? WHERE id = ?")
    .run(new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});

app.get("/admin/coupons", requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT coupons.*, users.name AS seller_name
     FROM coupons
     JOIN users ON users.id = coupons.seller_id
     ORDER BY coupons.created_at DESC`
  ).all();
  res.json({ coupons: rows });
});

app.post("/admin/coupons/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!status || !["active", "disabled", "sold"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  db.prepare("UPDATE coupons SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

app.delete("/admin/coupons/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM coupons WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`CoSwap backend running on http://localhost:${PORT}`);
});
