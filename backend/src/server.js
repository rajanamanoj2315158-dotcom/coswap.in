require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");
const compression = require("compression");
const helmet = require("helmet");

const {
  initDb,
  User,
  Coupon,
  Purchase,
  Chat,
  Message,
  Report,
  Notification,
  BuyRequest,
  PasswordReset
} = require("./db");

const app = express();

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@coswap.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const MAX_RECOMMENDATIONS = 6;
const SEMANTIC_GROUPS = {
  ott: ["streaming", "netflix", "prime", "hotstar", "subscription", "movie", "shows"],
  food: ["dining", "restaurant", "meal", "pizza", "burger", "cafe", "swiggy", "zomato"],
  shopping: ["fashion", "apparel", "clothing", "myntra", "amazon", "flipkart", "lifestyle"],
  travel: ["flight", "hotel", "trip", "vacation", "journey", "stay"],
  beauty: ["salon", "spa", "wellness", "skincare", "makeup", "grooming"],
  gaming: ["game", "steam", "xbox", "playstation", "esports", "console"],
  electronics: ["gadgets", "device", "mobile", "laptop", "tech", "smartphone"],
  grocery: ["groceries", "mart", "supermarket", "daily", "essentials"],
  fitness: ["gym", "health", "workout", "protein", "training"],
  education: ["course", "learning", "study", "class", "upskill", "certification"]
};

app.use(cors());
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "5mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Serve frontend static files with caching
app.use(express.static(path.join(__dirname, "../../"), {
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createToken(user) {
  return jwt.sign(
    { id: user._id || user.id, email: user.email, name: user.name, is_admin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: "365d" }
  );
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value = "") {
  return normalizeText(value).split(" ").filter(Boolean);
}

function buildExpandedTerms(query) {
  const expanded = new Set(tokenize(query));
  for (const token of Array.from(expanded)) {
    for (const [group, terms] of Object.entries(SEMANTIC_GROUPS)) {
      if (
        group.includes(token) ||
        token.includes(group) ||
        terms.some((term) => term.includes(token) || token.includes(term))
      ) {
        expanded.add(group);
        terms.forEach((term) => expanded.add(term));
      }
    }
  }
  return Array.from(expanded);
}

function getCouponSearchIndex(coupon) {
  const title = normalizeText(coupon.title);
  const category = normalizeText(coupon.category);
  const details = normalizeText(coupon.details);
  const sellerName = normalizeText(coupon.seller_name);
  const combined = `${title} ${category} ${details} ${sellerName}`.trim();
  return { title, category, details, sellerName, combined, tokens: new Set(tokenize(combined)) };
}

function buildSemanticQuery(query) {
  const normalized = normalizeText(query);
  return { raw: query, normalized, tokens: tokenize(query), expandedTerms: buildExpandedTerms(query) };
}

function scoreCouponForSemanticQuery(coupon, semanticQuery) {
  const index = getCouponSearchIndex(coupon);
  let score = 0;
  const reasons = [];
  if (!semanticQuery.normalized) return { score, reasons };
  if (index.title.includes(semanticQuery.normalized)) { score += 120; reasons.push("Strong title match"); }
  if (index.category.includes(semanticQuery.normalized)) { score += 100; reasons.push("Category alignment"); }
  for (const token of semanticQuery.tokens) {
    if (!token) continue;
    if (index.tokens.has(token)) score += 20;
    if (index.title.includes(token)) score += 28;
    else if (Array.from(index.tokens).some((v) => v.startsWith(token))) score += 10;
    if (index.category.includes(token)) score += 24;
    if (index.details.includes(token)) score += 12;
  }
  for (const term of semanticQuery.expandedTerms) {
    if (!term) continue;
    if (index.category.includes(term)) score += 16;
    if (index.title.includes(term)) score += 12;
    if (index.details.includes(term)) score += 8;
  }
  if (coupon.seller_rating) score += Number(coupon.seller_rating) * 2;
  const createdAt = coupon.created_at ? new Date(coupon.created_at).getTime() : 0;
  if (createdAt) {
    const ageDays = Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60 * 24));
    score += Math.max(0, 18 - ageDays);
  }
  return { score, reasons: [...new Set(reasons)] };
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: String(row._id || row.id),
    name: row.name,
    email: row.email,
    status: row.status,
    is_admin: !!row.is_admin,
    pending_fee: 0,
    created_at: row.created_at
  };
}

async function notify(userId, message, action = null) {
  await Notification.create({ user_id: userId, message, action, created_at: new Date().toISOString() });
}

async function notifyAdmins(message, action = null) {
  const admins = await User.find({ is_admin: true }).lean();
  for (const admin of admins) {
    await notify(admin._id, message, action);
  }
}

async function getSellerStats(sellerId) {
  const user = await User.findById(sellerId).lean();
  if (!user) return { rating: null, fraudPercent: 0, level: 1 };

  const soldCoupons = await Coupon.find({ seller_id: sellerId }).lean();
  const couponIds = soldCoupons.map((c) => c._id);
  const purchases = await Purchase.find({ coupon_id: { $in: couponIds } }).lean();
  const totalSold = purchases.length;
  const customers = new Set(purchases.map((p) => String(p.buyer_id))).size;

  const reportCount = await Report.countDocuments({ seller_id: sellerId });
  const fraudPercent = totalSold > 0 ? Math.round((reportCount / totalSold) * 100) : 0;
  const rating = user.rating_count > 0 ? (user.rating_sum / user.rating_count).toFixed(1) : null;

  let level = 1;
  if (customers >= 10) level = 2;
  if (customers >= 25) level = 3;
  if (customers >= 50) level = 4;
  if (customers >= 100) level = 5;

  return { rating, fraudPercent, level };
}

async function addCouponPresentation(coupon) {
  const stats = await getSellerStats(coupon.seller_id);
  return { ...coupon, seller_rating: stats.rating, seller_fraud_percent: stats.fraudPercent, seller_level: stats.level };
}

async function ensureAdminUser() {
  const admin = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });
  if (!admin) {
    const password_hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    await User.create({ name: "Admin", email: ADMIN_EMAIL.toLowerCase(), password_hash, status: "active", is_admin: true, created_at: new Date().toISOString() });
  } else if (!admin.is_admin) {
    await User.updateOne({ _id: admin._id }, { is_admin: true });
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function authOptional(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next();
  try { req.user = jwt.verify(token, JWT_SECRET); } catch { req.user = null; }
  next();
}

function requireAdmin(req, res, next) {
  authMiddleware(req, res, async () => {
    const user = await User.findById(req.user.id).lean();
    if (!user || !user.is_admin) return res.status(403).json({ error: "Admin access required." });
    req.admin = user;
    next();
  });
}

async function expireRequests() {
  const now = new Date().toISOString();
  await BuyRequest.updateMany({ status: "pending", expires_at: { $lt: now } }, { status: "expired" });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), env: process.env.NODE_ENV || "development" });
});

// ─── robots.txt ──────────────────────────────────────────────────────────────
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send([
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /admin/",
    "",
    `Sitemap: https://coswap.in/sitemap.xml`
  ].join("\n"));
});

// ─── sitemap.xml ─────────────────────────────────────────────────────────────
app.get("/sitemap.xml", async (req, res) => {
  const base = "https://coswap.in";
  const staticPages = [
    { url: "/", priority: "1.0", freq: "daily" },
    { url: "/browse.html", priority: "0.9", freq: "hourly" },
    { url: "/about.html", priority: "0.7", freq: "monthly" },
    { url: "/how-it-works.html", priority: "0.8", freq: "monthly" },
    { url: "/terms.html", priority: "0.5", freq: "yearly" },
    { url: "/login.html", priority: "0.6", freq: "monthly" },
    { url: "/signup.html", priority: "0.6", freq: "monthly" }
  ];
  const today = new Date().toISOString().split("T")[0];
  const urls = staticPages.map(p =>
    `  <url>\n    <loc>${base}${p.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.freq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
  ).join("\n");
  res.type("application/xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});

// Auth
app.post("/auth/signup", async (req, res) => {
  try {
    const { name, email, password, acceptTerms } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: "Name, email, and password are required." });
    if (!acceptTerms) return res.status(400).json({ error: "You must accept the Terms & Conditions." });

    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) return res.status(409).json({ error: "Email already registered." });

    const password_hash = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();
    const user = await User.create({ name: name.trim(), email: email.trim().toLowerCase(), password_hash, created_at: now, terms_accepted_at: now });
    const token = createToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid email or password." });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password." });
    if (user.status === "frozen") return res.status(403).json({ error: "Account frozen. Please contact support." });
    if (user.status === "deleted") return res.status(403).json({ error: "Account disabled. Please contact support." });

    const token = createToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/auth/forgot", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required." });

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(404).json({ error: "Email not found." });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const reset_token = crypto.randomBytes(24).toString("hex");
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await PasswordReset.create({ email: email.trim().toLowerCase(), otp, reset_token, expires_at });

    res.json({ message: "OTP generated", otp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required." });

    const record = await PasswordReset.findOne({ email: email.trim().toLowerCase(), otp: String(otp).trim(), used_at: null }).sort({ _id: -1 });
    if (!record) return res.status(400).json({ error: "Invalid OTP." });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: "OTP expired." });

    res.json({ resetToken: record.reset_token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/auth/reset", async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body || {};
    if (!resetToken || !newPassword) return res.status(400).json({ error: "Reset token and new password are required." });

    const record = await PasswordReset.findOne({ reset_token: resetToken, used_at: null }).sort({ _id: -1 });
    if (!record) return res.status(400).json({ error: "Invalid reset token." });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: "Reset token expired." });

    const password_hash = bcrypt.hashSync(newPassword, 10);
    await User.updateOne({ email: record.email }, { password_hash });
    await PasswordReset.updateOne({ _id: record._id }, { used_at: new Date().toISOString() });

    res.json({ message: "Password reset successful." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    res.json({ user: sanitizeUser(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/me/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ error: "User not found." });

    const soldCoupons = await Coupon.find({ seller_id: req.user.id }).lean();
    const couponIds = soldCoupons.map((c) => c._id);
    const purchases = await Purchase.find({ coupon_id: { $in: couponIds } }).lean();
    const totalSold = purchases.length;
    const customers = new Set(purchases.map((p) => String(p.buyer_id))).size;
    const reportCount = await Report.countDocuments({ seller_id: req.user.id });
    const fraudReports = reportCount;
    const fraudPercent = totalSold > 0 ? Math.round((fraudReports / totalSold) * 100) : 0;
    const rating = user.rating_count > 0 ? (user.rating_sum / user.rating_count).toFixed(1) : null;

    let level = 1, maxPrice = 10;
    if (customers >= 10) { level = 2; maxPrice = 20; }
    if (customers >= 25) { level = 3; maxPrice = 40; }
    if (customers >= 50) { level = 4; maxPrice = 70; }
    if (customers >= 100) { level = 5; maxPrice = 100; }

    res.json({ profile: { id: String(user._id), name: user.name, customers, totalSold, fraudReports, fraudPercent, rating, ratingCount: user.rating_count, level, maxPrice, status: user.status, pending_fee: 0 } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/me/notifications", authMiddleware, async (req, res) => {
  try {
    const rows = await Notification.find({ user_id: req.user.id }).sort({ created_at: -1 }).lean();
    res.json({ notifications: rows.map((n) => ({ ...n, id: String(n._id) })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/me/wallet", authMiddleware, (req, res) => {
  res.json({ wallet: { pending_fee: 0, payments: [] } });
});

app.post("/me/wallet/pay", authMiddleware, (req, res) => {
  res.json({ message: "Wallet payments are no longer required on CoSwap.", amount: 0 });
});

// Sellers
app.get("/sellers/:id", async (req, res) => {
  try {
    const seller = await User.findById(req.params.id).lean();
    if (!seller) return res.status(404).json({ error: "Seller not found." });

    const soldCoupons = await Coupon.find({ seller_id: req.params.id }).lean();
    const couponIds = soldCoupons.map((c) => c._id);
    const purchases = await Purchase.find({ coupon_id: { $in: couponIds } }).lean();
    const totalSold = purchases.length;
    const customers = new Set(purchases.map((p) => String(p.buyer_id))).size;
    const reportCount = await Report.countDocuments({ seller_id: req.params.id });
    const fraudPercent = totalSold > 0 ? Math.round((reportCount / totalSold) * 100) : 0;
    const rating = seller.rating_count > 0 ? (seller.rating_sum / seller.rating_count).toFixed(1) : "4.8";

    let level = 1;
    if (customers >= 10) level = 2;
    if (customers >= 25) level = 3;
    if (customers >= 50) level = 4;
    if (customers >= 100) level = 5;

    res.json({ seller: { id: String(seller._id), name: seller.name, customers, rating, ratingCount: seller.rating_count, fraudPercent, fraudVotes: seller.fraud_votes, genuineVotes: seller.genuine_votes, level } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/sellers/:id/rate", authMiddleware, async (req, res) => {
  try {
    const { rating } = req.body || {};
    const val = Number(rating);
    if (!val || val < 1 || val > 5) return res.status(400).json({ error: "Rating must be between 1 and 5." });

    const seller = await User.findById(req.params.id);
    if (!seller) return res.status(404).json({ error: "Seller not found." });

    await User.updateOne({ _id: seller._id }, { $inc: { rating_sum: val, rating_count: 1 } });
    await notify(seller._id, "You received a new seller rating.", "sellerprofile.html");
    res.json({ message: "Rating recorded." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/sellers/:id/vote", authMiddleware, async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!type || !["genuine", "fraud"].includes(type)) return res.status(400).json({ error: "Vote type must be genuine or fraud." });

    const seller = await User.findById(req.params.id);
    if (!seller) return res.status(404).json({ error: "Seller not found." });

    if (type === "genuine") await User.updateOne({ _id: seller._id }, { $inc: { genuine_votes: 1 } });
    else await User.updateOne({ _id: seller._id }, { $inc: { fraud_votes: 1 } });

    await notify(seller._id, "A buyer left feedback on your profile.", "sellerprofile.html");
    res.json({ message: "Vote recorded." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Coupons
app.get("/coupons", async (req, res) => {
  try {
    const { search, category, status } = req.query || {};
    const today = new Date().toISOString().split("T")[0];
    const query = {};

    if (status) query.status = status;
    else query.status = "active";
    if (category) query.category = category;
    query.$or = [{ expiry: null }, { expiry: { $gte: today } }];

    const rawCoupons = await Coupon.find(query).sort({ created_at: -1 }).lean();
    const sellerIds = [...new Set(rawCoupons.map((c) => String(c.seller_id)))];
    const sellers = await User.find({ _id: { $in: sellerIds } }).lean();
    const sellerMap = {};
    sellers.forEach((s) => { sellerMap[String(s._id)] = s.name; });

    const coupons = await Promise.all(rawCoupons.map(async (c) => {
      const stats = await getSellerStats(c.seller_id);
      return { ...c, id: String(c._id), seller_id: String(c.seller_id), seller_name: sellerMap[String(c.seller_id)] || "", seller_rating: stats.rating, seller_fraud_percent: stats.fraudPercent, seller_level: stats.level };
    }));

    if (!search) return res.json({ coupons });

    const semanticQuery = buildSemanticQuery(search);
    const ranked = coupons
      .map((coupon) => {
        const semantic = scoreCouponForSemanticQuery(coupon, semanticQuery);
        return { ...coupon, semanticScore: semantic.score, semanticReason: semantic.reasons[0] || "Semantic match" };
      })
      .filter((c) => c.semanticScore > 0)
      .sort((a, b) => b.semanticScore !== a.semanticScore ? b.semanticScore - a.semanticScore : new Date(b.created_at) - new Date(a.created_at));

    res.json({ coupons: ranked, semantic: { query: search, expandedTerms: semanticQuery.expandedTerms.slice(0, 8), totalMatches: ranked.length } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/recommendations", authOptional, async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const limit = Math.max(1, Math.min(MAX_RECOMMENDATIONS, Number(req.query.limit) || MAX_RECOMMENDATIONS));
    const rawCoupons = await Coupon.find({ status: "active", $or: [{ expiry: null }, { expiry: { $gte: today } }] }).sort({ created_at: -1 }).lean();

    const sellerIds = [...new Set(rawCoupons.map((c) => String(c.seller_id)))];
    const sellers = await User.find({ _id: { $in: sellerIds } }).lean();
    const sellerMap = {};
    sellers.forEach((s) => { sellerMap[String(s._id)] = s.name; });

    const coupons = await Promise.all(rawCoupons.map(async (c) => {
      const stats = await getSellerStats(c.seller_id);
      return { ...c, id: String(c._id), seller_id: String(c.seller_id), seller_name: sellerMap[String(c.seller_id)] || "", seller_rating: stats.rating, seller_fraud_percent: stats.fraudPercent, seller_level: stats.level };
    }));

    // Build recommendation profile
    let preferredCategories = new Map();
    let ownedCouponIds = new Set();
    let purchasedCouponIds = new Set();
    let averagePrice = null;
    if (req.user) {
      const myPurchases = await Purchase.find({ buyer_id: req.user.id }).populate("coupon_id").lean();
      const myListings = await Coupon.find({ seller_id: req.user.id }).lean();
      const prices = [];
      myPurchases.forEach((p) => {
        if (p.coupon_id) {
          purchasedCouponIds.add(String(p.coupon_id._id || p.coupon_id));
          const cat = normalizeText(p.coupon_id.category || "");
          preferredCategories.set(cat, (preferredCategories.get(cat) || 0) + 3);
          if (p.price) prices.push(Number(p.price));
        }
      });
      myListings.forEach((l) => {
        ownedCouponIds.add(String(l._id));
        const cat = normalizeText(l.category || "");
        preferredCategories.set(cat, (preferredCategories.get(cat) || 0) + 2);
        if (l.price) prices.push(Number(l.price));
      });
      if (prices.length) averagePrice = prices.reduce((s, v) => s + v, 0) / prices.length;
    }

    const personalized = Boolean(req.user && preferredCategories.size > 0);

    const ranked = coupons
      .filter((c) => {
        if (!req.user) return true;
        if (ownedCouponIds.has(c.id)) return false;
        if (purchasedCouponIds.has(c.id)) return false;
        return c.seller_id !== String(req.user.id);
      })
      .map((coupon) => {
        const normalizedCategory = normalizeText(coupon.category);
        const affinityScore = preferredCategories.get(normalizedCategory) || 0;
        let score = affinityScore * 24;
        let reason = affinityScore > 0 ? `Recommended because you engage with ${coupon.category || "similar"} deals` : "";
        if (averagePrice && coupon.price) {
          const diffRatio = Math.abs(Number(coupon.price) - averagePrice) / Math.max(averagePrice, 1);
          if (diffRatio <= 0.2) score += 18;
          else if (diffRatio <= 0.45) score += 10;
        }
        if (coupon.seller_rating) score += Number(coupon.seller_rating) * 8;
        score += Math.max(0, 25 - (coupon.seller_fraud_percent || 0));
        score += (coupon.seller_level || 1) * 3;
        const createdAt = coupon.created_at ? new Date(coupon.created_at).getTime() : 0;
        if (createdAt) score += Math.max(0, 20 - Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60 * 24)));
        if (!reason) {
          if ((coupon.seller_rating || 0) >= 4.8) reason = "Top-rated seller recommendation";
          else if ((coupon.seller_level || 1) >= 3) reason = "High-trust listing from a proven seller";
          else reason = "Trending listing on CoSwap";
        }
        return { ...coupon, recommendation_reason: reason, recommendation_score: score };
      })
      .sort((a, b) => b.recommendation_score !== a.recommendation_score ? b.recommendation_score - a.recommendation_score : new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);

    res.json({ strategy: personalized ? "personalized" : "trending", recommendations: ranked });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/coupons/:id", async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id).lean();
    if (!coupon) return res.status(404).json({ error: "Coupon not found." });
    const seller = await User.findById(coupon.seller_id).lean();
    const stats = await getSellerStats(coupon.seller_id);
    res.json({ coupon: { ...coupon, id: String(coupon._id), seller_id: String(coupon.seller_id), seller_name: seller ? seller.name : "", seller_rating: stats.rating, seller_fraud_percent: stats.fraudPercent, seller_level: stats.level } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/coupons", authMiddleware, async (req, res) => {
  try {
    const { title, details, expiry, price, category, image } = req.body || {};
    if (!title || !price) return res.status(400).json({ error: "Title and price are required." });

    const seller = await User.findById(req.user.id).lean();
    if (!seller) return res.status(404).json({ error: "User not found." });
    if (seller.status === "frozen") return res.status(403).json({ error: "Account frozen. Please contact support." });

    const coupon = await Coupon.create({ title: title.trim(), details: details || "", expiry: expiry || null, price: Number(price), category: category || "", image_url: image || "bg.png", seller_id: req.user.id, status: "active", created_at: new Date().toISOString() });
    res.json({ coupon: { ...coupon.toObject(), id: String(coupon._id), seller_id: String(coupon.seller_id), seller_name: seller.name } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/coupons/:id", authMiddleware, async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id).lean();
    if (!coupon) return res.status(404).json({ error: "Coupon not found." });
    if (String(coupon.seller_id) !== String(req.user.id)) return res.status(403).json({ error: "Not allowed." });

    const { title, details, expiry, price, category, image_url, status } = req.body || {};
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (details !== undefined) updates.details = details;
    if (expiry !== undefined) updates.expiry = expiry;
    if (price !== undefined) updates.price = price;
    if (category !== undefined) updates.category = category;
    if (image_url !== undefined) updates.image_url = image_url;
    if (status !== undefined) updates.status = status;

    const updated = await Coupon.findByIdAndUpdate(coupon._id, updates, { new: true }).lean();
    const seller = await User.findById(updated.seller_id).lean();
    res.json({ coupon: { ...updated, id: String(updated._id), seller_id: String(updated.seller_id), seller_name: seller ? seller.name : "" } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/coupons/:id", authMiddleware, async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id).lean();
    if (!coupon) return res.status(404).json({ error: "Coupon not found." });
    if (String(coupon.seller_id) !== String(req.user.id)) return res.status(403).json({ error: "Not allowed." });
    await Coupon.deleteOne({ _id: coupon._id });
    res.status(204).send();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/me/listings", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    const rows = await Coupon.find({ seller_id: req.user.id }).sort({ created_at: -1 }).lean();
    res.json({ coupons: rows.map((c) => ({ ...c, id: String(c._id), seller_id: String(c.seller_id), seller_name: user ? user.name : "" })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Purchases
app.post("/purchases", authMiddleware, async (req, res) => {
  try {
    const { couponId } = req.body || {};
    if (!couponId) return res.status(400).json({ error: "couponId is required." });

    const coupon = await Coupon.findById(couponId).lean();
    if (!coupon) return res.status(404).json({ error: "Coupon not found." });
    if (coupon.status !== "active") return res.status(400).json({ error: "Coupon not available." });
    if (String(coupon.seller_id) === String(req.user.id)) return res.status(400).json({ error: "You cannot purchase your own coupon." });

    const purchase = await Purchase.create({ coupon_id: coupon._id, buyer_id: req.user.id, price: coupon.price, status: "success", purchased_at: new Date().toISOString() });
    await Coupon.updateOne({ _id: coupon._id }, { status: "sold" });

    await notify(req.user.id, "Purchase completed successfully.", "mypurchases.html");
    await notify(coupon.seller_id, "Your coupon was sold successfully.", "mylistings.html");

    res.json({ purchase: { ...purchase.toObject(), id: String(purchase._id), coupon_id: String(coupon._id), buyer_id: String(req.user.id), title: coupon.title, image_url: coupon.image_url, category: coupon.category }, fee: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/me/purchases", authMiddleware, async (req, res) => {
  try {
    const purchases = await Purchase.find({ buyer_id: req.user.id }).sort({ purchased_at: -1 }).lean();
    const result = await Promise.all(purchases.map(async (p) => {
      const coupon = await Coupon.findById(p.coupon_id).lean();
      const seller = coupon ? await User.findById(coupon.seller_id).lean() : null;
      return { ...p, id: String(p._id), coupon_id: String(p.coupon_id), buyer_id: String(p.buyer_id), title: coupon ? coupon.title : "", image_url: coupon ? coupon.image_url : "", category: coupon ? coupon.category : "", expiry: coupon ? coupon.expiry : "", seller_name: seller ? seller.name : "" };
    }));
    res.json({ purchases: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Chats
app.post("/chats", authMiddleware, async (req, res) => {
  try {
    const { couponId } = req.body || {};
    if (!couponId) return res.status(400).json({ error: "couponId is required." });

    const coupon = await Coupon.findById(couponId).lean();
    if (!coupon) return res.status(404).json({ error: "Coupon not found." });
    if (String(coupon.seller_id) === String(req.user.id)) return res.status(400).json({ error: "Cannot chat with yourself." });

    let chat = await Chat.findOne({ coupon_id: coupon._id, buyer_id: req.user.id, seller_id: coupon.seller_id }).lean();
    if (chat) return res.json({ chat: { ...chat, id: String(chat._id) } });

    chat = await Chat.create({ coupon_id: coupon._id, buyer_id: req.user.id, seller_id: coupon.seller_id, status: "active", created_at: new Date().toISOString() });
    res.json({ chat: { ...chat.toObject(), id: String(chat._id) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/chats", authMiddleware, async (req, res) => {
  try {
    const chats = await Chat.find({ $or: [{ buyer_id: req.user.id }, { seller_id: req.user.id }] }).sort({ last_message_at: -1, created_at: -1 }).lean();
    const result = await Promise.all(chats.map(async (chat) => {
      const coupon = await Coupon.findById(chat.coupon_id).lean();
      const buyer = await User.findById(chat.buyer_id).lean();
      const seller = await User.findById(chat.seller_id).lean();
      return { ...chat, id: String(chat._id), coupon_id: String(chat.coupon_id), buyer_id: String(chat.buyer_id), seller_id: String(chat.seller_id), coupon_title: coupon ? coupon.title : "", buyer_name: buyer ? buyer.name : "", seller_name: seller ? seller.name : "" };
    }));
    res.json({ chats: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/chats/:id", authMiddleware, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id).lean();
    if (!chat) return res.status(404).json({ error: "Chat not found." });
    if (String(chat.buyer_id) !== String(req.user.id) && String(chat.seller_id) !== String(req.user.id)) return res.status(403).json({ error: "Not allowed." });
    const coupon = await Coupon.findById(chat.coupon_id).lean();
    const buyer = await User.findById(chat.buyer_id).lean();
    const seller = await User.findById(chat.seller_id).lean();
    res.json({ chat: { ...chat, id: String(chat._id), coupon_id: String(chat.coupon_id), buyer_id: String(chat.buyer_id), seller_id: String(chat.seller_id), coupon_title: coupon ? coupon.title : "", buyer_name: buyer ? buyer.name : "", seller_name: seller ? seller.name : "" } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/chats/:id/messages", authMiddleware, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id).lean();
    if (!chat) return res.status(404).json({ error: "Chat not found." });
    if (String(chat.buyer_id) !== String(req.user.id) && String(chat.seller_id) !== String(req.user.id)) return res.status(403).json({ error: "Not allowed." });
    const messages = await Message.find({ chat_id: chat._id }).sort({ created_at: 1 }).lean();
    res.json({ messages: messages.map((m) => ({ ...m, id: String(m._id), chat_id: String(m.chat_id), sender_id: String(m.sender_id) })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/chats/:id/messages", authMiddleware, async (req, res) => {
  try {
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: "Message body is required." });

    const chat = await Chat.findById(req.params.id).lean();
    if (!chat) return res.status(404).json({ error: "Chat not found." });
    if (String(chat.buyer_id) !== String(req.user.id) && String(chat.seller_id) !== String(req.user.id)) return res.status(403).json({ error: "Not allowed." });

    const now = new Date().toISOString();
    const message = await Message.create({ chat_id: chat._id, sender_id: req.user.id, body, created_at: now });
    await Chat.updateOne({ _id: chat._id }, { last_message: body, last_message_at: now });
    res.json({ message: { ...message.toObject(), id: String(message._id), chat_id: String(message.chat_id), sender_id: String(message.sender_id) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Buy Requests
app.post("/requests", authMiddleware, async (req, res) => {
  try {
    const { couponId } = req.body || {};
    if (!couponId) return res.status(400).json({ error: "couponId is required." });

    const coupon = await Coupon.findById(couponId).lean();
    if (!coupon) return res.status(404).json({ error: "Coupon not found." });
    if (coupon.status !== "active") return res.status(400).json({ error: "Coupon not available." });
    if (String(coupon.seller_id) === String(req.user.id)) return res.status(400).json({ error: "You cannot request your own coupon." });

    await expireRequests();

    const existing = await BuyRequest.findOne({ coupon_id: coupon._id, buyer_id: req.user.id, status: "pending" }).lean();
    if (existing) return res.json({ request: { ...existing, id: String(existing._id) } });

    const now = new Date().toISOString();
    const expires_at = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const request = await BuyRequest.create({ coupon_id: coupon._id, buyer_id: req.user.id, seller_id: coupon.seller_id, status: "pending", created_at: now, expires_at });
    await notify(coupon.seller_id, "New buy request received. Please respond.", "requests.html");

    res.json({ request: { ...request.toObject(), id: String(request._id) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/me/requests", authMiddleware, async (req, res) => {
  try {
    await expireRequests();
    const [sellerReqs, buyerReqs] = await Promise.all([
      BuyRequest.find({ seller_id: req.user.id }).sort({ created_at: -1 }).lean(),
      BuyRequest.find({ buyer_id: req.user.id }).sort({ created_at: -1 }).lean()
    ]);

    const enrichReq = async (r, role) => {
      const coupon = await Coupon.findById(r.coupon_id).lean();
      const other = await User.findById(role === "seller" ? r.buyer_id : r.seller_id).lean();
      return { ...r, id: String(r._id), coupon_id: String(r.coupon_id), buyer_id: String(r.buyer_id), seller_id: String(r.seller_id), coupon_title: coupon ? coupon.title : "", [role === "seller" ? "buyer_name" : "seller_name"]: other ? other.name : "" };
    };

    const asSeller = await Promise.all(sellerReqs.map((r) => enrichReq(r, "seller")));
    const asBuyer = await Promise.all(buyerReqs.map((r) => enrichReq(r, "buyer")));
    res.json({ asSeller, asBuyer });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/requests/:id", authMiddleware, async (req, res) => {
  try {
    await expireRequests();
    const request = await BuyRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (String(request.buyer_id) !== String(req.user.id) && String(request.seller_id) !== String(req.user.id)) return res.status(403).json({ error: "Not allowed." });
    res.json({ request: { ...request, id: String(request._id) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/requests/:id/accept", authMiddleware, async (req, res) => {
  try {
    await expireRequests();
    const request = await BuyRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (String(request.seller_id) !== String(req.user.id)) return res.status(403).json({ error: "Not allowed." });
    if (request.status !== "pending") return res.status(400).json({ error: "Request is not pending." });

    let chat = await Chat.findOne({ coupon_id: request.coupon_id, buyer_id: request.buyer_id, seller_id: request.seller_id }).lean();
    if (!chat) {
      chat = await Chat.create({ coupon_id: request.coupon_id, buyer_id: request.buyer_id, seller_id: request.seller_id, status: "active", created_at: new Date().toISOString() });
    }

    // ── First-request-wins: accept this one, decline all others for same coupon ──
    await BuyRequest.updateOne({ _id: request._id }, { status: "accepted", chat_id: chat._id });

    // Decline all other pending requests for the same coupon
    const otherPending = await BuyRequest.find({
      coupon_id: request.coupon_id,
      _id: { $ne: request._id },
      status: "pending"
    }).lean();
    if (otherPending.length > 0) {
      await BuyRequest.updateMany(
        { coupon_id: request.coupon_id, _id: { $ne: request._id }, status: "pending" },
        { status: "declined" }
      );
      for (const other of otherPending) {
        await notify(other.buyer_id, "Your buy request was declined — the seller accepted another buyer first.", "browse.html");
      }
    }

    await notify(request.buyer_id, "Your buy request was accepted! Chat is ready.", "chatlist.html");

    res.json({ request: { ...request, id: String(request._id), status: "accepted", chat_id: String(chat._id || chat.id) }, chat: { ...chat, id: String(chat._id || chat.id) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/requests/:id/ignore", authMiddleware, async (req, res) => {
  try {
    await expireRequests();
    const request = await BuyRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: "Request not found." });
    if (String(request.seller_id) !== String(req.user.id)) return res.status(403).json({ error: "Not allowed." });
    if (request.status !== "pending") return res.status(400).json({ error: "Request is not pending." });

    await BuyRequest.updateOne({ _id: request._id }, { status: "ignored" });
    await notify(request.buyer_id, "Your buy request was declined.", "browse.html");
    res.json({ request: { ...request, id: String(request._id), status: "ignored" } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reports
app.post("/reports", authMiddleware, async (req, res) => {
  try {
    const { couponId, sellerId, reason, description } = req.body || {};
    if (!reason) return res.status(400).json({ error: "Reason is required." });

    let seller_id = sellerId;
    let coupon_id = couponId || null;

    if (coupon_id) {
      const coupon = await Coupon.findById(coupon_id).lean();
      if (!coupon) return res.status(404).json({ error: "Coupon not found." });
      seller_id = coupon.seller_id;
    }

    if (!seller_id) return res.status(400).json({ error: "Seller is required." });

    const report = await Report.create({ reporter_id: req.user.id, seller_id, coupon_id: coupon_id || undefined, reason, description: description || "", status: "pending", created_at: new Date().toISOString() });
    await notifyAdmins("New fraud report submitted.", "admin-reports.html");
    await notify(seller_id, "A fraud report was filed against your account.", "sellerprofile.html");

    res.json({ report: { ...report.toObject(), id: String(report._id) } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Transactions
app.get("/me/transactions", authMiddleware, async (req, res) => {
  try {
    const purchases = await Purchase.find({ buyer_id: req.user.id }).sort({ purchased_at: -1 }).lean();
    const result = await Promise.all(purchases.map(async (p) => {
      const coupon = await Coupon.findById(p.coupon_id).lean();
      const seller = coupon ? await User.findById(coupon.seller_id).lean() : null;
      return { ...p, id: String(p._id), fee: 0, title: coupon ? coupon.title : "", image_url: coupon ? coupon.image_url : "", category: coupon ? coupon.category : "", expiry: coupon ? coupon.expiry : "", seller_name: seller ? seller.name : "" };
    }));
    res.json({ transactions: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Notifications
app.post("/me/notifications/:id/read", authMiddleware, async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, user_id: req.user.id }, { read_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin
app.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const user = await User.findOne({ email: email.trim().toLowerCase() }).lean();
    if (!user || !user.is_admin) return res.status(401).json({ error: "Invalid admin credentials." });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid admin credentials." });

    res.json({ token: createToken(user), user: sanitizeUser(user) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/admin/overview", requireAdmin, async (req, res) => {
  try {
    const [totalUsers, couponCount, activeChats, pendingReports, frozenSellers, allPurchases] = await Promise.all([
      User.countDocuments({ is_admin: false }),
      Coupon.countDocuments(),
      Chat.countDocuments({ status: "active" }),
      Report.countDocuments({ status: "pending" }),
      User.countDocuments({ status: "frozen" }),
      Purchase.find({}, "price").lean()
    ]);
    const salesVolume = Math.round(allPurchases.reduce((sum, p) => sum + p.price, 0) * 100) / 100;
    res.json({ overview: { totalUsers, couponCount, salesVolume, pendingReports, suspiciousSellers: frozenSellers, activeChats } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await User.find({ is_admin: false }).sort({ created_at: -1 }).lean();
    const result = await Promise.all(users.map(async (u) => {
      const reportCount = await Report.countDocuments({ seller_id: u._id });
      const myCoupons = await Coupon.find({ seller_id: u._id }).lean();
      const totalSold = await Purchase.countDocuments({ coupon_id: { $in: myCoupons.map((c) => c._id) } });
      const rating = u.rating_count > 0 ? (u.rating_sum / u.rating_count).toFixed(1) : "4.8";
      const fraudPercent = totalSold > 0 ? Math.round((reportCount / totalSold) * 100) : 0;
      return { id: String(u._id), name: u.name, email: u.email, rating, fraudPercent, status: u.status };
    }));
    res.json({ users: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/users/:id/freeze", requireAdmin, async (req, res) => {
  try {
    await User.updateOne({ _id: req.params.id }, { status: "frozen" });
    await notify(req.params.id, "Your account was frozen by admin.", "sellerprofile.html");
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/users/:id/unfreeze", requireAdmin, async (req, res) => {
  try {
    await User.updateOne({ _id: req.params.id }, { status: "active" });
    await notify(req.params.id, "Your account was unfrozen by admin.", "sellerprofile.html");
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    await User.updateOne({ _id: req.params.id }, { status: "deleted" });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/admin/reports", requireAdmin, async (req, res) => {
  try {
    const reports = await Report.find().sort({ created_at: -1 }).lean();
    const result = await Promise.all(reports.map(async (r) => {
      const reporter = await User.findById(r.reporter_id).lean();
      const seller = await User.findById(r.seller_id).lean();
      const coupon = r.coupon_id ? await Coupon.findById(r.coupon_id).lean() : null;
      return { ...r, id: String(r._id), reporter_name: reporter ? reporter.name : "", seller_name: seller ? seller.name : "", coupon_title: coupon ? coupon.title : "" };
    }));
    res.json({ reports: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/reports/:id/warn", requireAdmin, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ error: "Report not found." });
    await Report.updateOne({ _id: report._id }, { status: "warned", resolved_at: new Date().toISOString() });
    await notify(report.seller_id, "Admin issued a warning based on a report.", "sellerprofile.html");
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/reports/:id/freeze", requireAdmin, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ error: "Report not found." });
    await User.updateOne({ _id: report.seller_id }, { status: "frozen" });
    await Report.updateOne({ _id: report._id }, { status: "resolved", resolved_at: new Date().toISOString() });
    await notify(report.seller_id, "Your account was frozen due to repeated reports.", "sellerprofile.html");
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/reports/:id/resolve", requireAdmin, async (req, res) => {
  try {
    await Report.updateOne({ _id: req.params.id }, { status: "resolved", resolved_at: new Date().toISOString() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/admin/coupons", requireAdmin, async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ created_at: -1 }).lean();
    const result = await Promise.all(coupons.map(async (c) => {
      const seller = await User.findById(c.seller_id).lean();
      return { ...c, id: String(c._id), seller_id: String(c.seller_id), seller_name: seller ? seller.name : "" };
    }));
    res.json({ coupons: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/coupons/:id/status", requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status || !["active", "disabled", "sold"].includes(status)) return res.status(400).json({ error: "Invalid status." });
    await Coupon.updateOne({ _id: req.params.id }, { status });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/admin/coupons/:id", requireAdmin, async (req, res) => {
  try {
    await Coupon.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Start ───────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDb();
    await ensureAdminUser();
    app.listen(PORT, () => {
      console.log(`CoSwap backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
