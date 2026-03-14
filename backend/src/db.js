const mongoose = require("mongoose");

let MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/coswap";

// Strip problematic legacy majority parameters if present and re-add them correctly
if (MONGODB_URI.includes("majority") && !MONGODB_URI.includes("w=majority")) {
  MONGODB_URI = MONGODB_URI.replace(/majority/g, "w=majority");
}
if (MONGODB_URI.startsWith("mongodb+srv") && !MONGODB_URI.includes("retryWrites")) {
  MONGODB_URI += (MONGODB_URI.includes("?") ? "&" : "?") + "retryWrites=true&w=majority";
}

async function initDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    });
    console.log("MongoDB connected:", MONGODB_URI.split("@").pop().split("?")[0]);
    await ensureIndexes();
  }
  return mongoose;
}

async function ensureIndexes() {
  try {
    // Coupon indexes
    await Coupon.collection.createIndex({ status: 1, created_at: -1 });
    await Coupon.collection.createIndex({ seller_id: 1, status: 1 });
    await Coupon.collection.createIndex({ category: 1, status: 1 });
    await Coupon.collection.createIndex({ status: 1, expiry: 1 });

    // BuyRequest indexes
    await BuyRequest.collection.createIndex({ coupon_id: 1, status: 1 });
    await BuyRequest.collection.createIndex({ seller_id: 1, status: 1, created_at: -1 });
    await BuyRequest.collection.createIndex({ buyer_id: 1, status: 1, created_at: -1 });
    await BuyRequest.collection.createIndex({ status: 1, expires_at: 1 });

    // Purchase indexes
    await Purchase.collection.createIndex({ buyer_id: 1, purchased_at: -1 });
    await Purchase.collection.createIndex({ coupon_id: 1 });

    // Notification indexes
    await Notification.collection.createIndex({ user_id: 1, created_at: -1 });
    await Notification.collection.createIndex({ user_id: 1, read_at: 1 });

    // Message indexes
    await Message.collection.createIndex({ chat_id: 1, created_at: 1 });

    // Chat indexes
    await Chat.collection.createIndex({ buyer_id: 1, seller_id: 1 });
    await Chat.collection.createIndex({ coupon_id: 1, buyer_id: 1, seller_id: 1 });

    // Report indexes
    await Report.collection.createIndex({ seller_id: 1, status: 1 });
    await Report.collection.createIndex({ status: 1, created_at: -1 });

    // PasswordReset indexes
    await PasswordReset.collection.createIndex({ email: 1, used_at: 1 });
    await PasswordReset.collection.createIndex({ reset_token: 1, used_at: 1 });
    await PasswordReset.collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
    
    // SignupOTP indexes
    await SignupOTP.collection.createIndex({ email: 1 });
    await SignupOTP.collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

    console.log("Database indexes ensured.");
  } catch (err) {
    console.warn("Index creation warning (non-fatal):", err.message);
  }
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password_hash: { type: String }, // Made optional for Google Sign-in
  google_id: { type: String },
  profile_picture: { type: String },
  created_at: { type: String, default: () => new Date().toISOString() },
  terms_accepted_at: String,
  status: { type: String, default: "active" },
  is_admin: { type: Boolean, default: false },
  pending_fee: { type: Number, default: 0 },
  rating_sum: { type: Number, default: 0 },
  rating_count: { type: Number, default: 0 },
  fraud_votes: { type: Number, default: 0 },
  genuine_votes: { type: Number, default: 0 }
});

const couponSchema = new mongoose.Schema({
  title: { type: String, required: true },
  details: String,
  expiry: String,
  price: { type: Number, required: true },
  category: String,
  image_url: String,
  seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, default: "active" },
  created_at: { type: String, default: () => new Date().toISOString() }
});

const purchaseSchema = new mongoose.Schema({
  coupon_id: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
  buyer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  price: { type: Number, required: true },
  status: { type: String, default: "success" },
  purchased_at: { type: String, default: () => new Date().toISOString() }
});

const chatSchema = new mongoose.Schema({
  coupon_id: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
  buyer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, default: "active" },
  last_message: String,
  last_message_at: String,
  created_at: { type: String, default: () => new Date().toISOString() }
});

const messageSchema = new mongoose.Schema({
  chat_id: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true },
  sender_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  body: { type: String, required: true },
  created_at: { type: String, default: () => new Date().toISOString() }
});

const reportSchema = new mongoose.Schema({
  reporter_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  coupon_id: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon" },
  reason: { type: String, required: true },
  description: String,
  status: { type: String, default: "pending" },
  created_at: { type: String, default: () => new Date().toISOString() },
  resolved_at: String
});

const notificationSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: String, required: true },
  action: String,
  created_at: { type: String, default: () => new Date().toISOString() },
  read_at: String
});

const buyRequestSchema = new mongoose.Schema({
  coupon_id: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
  buyer_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  seller_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  status: { type: String, default: "pending" },
  created_at: { type: String, default: () => new Date().toISOString() },
  expires_at: { type: String, required: true },
  chat_id: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" }
});

const paymentSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  amount: { type: Number, required: true },
  method: String,
  status: { type: String, default: "paid" },
  created_at: { type: String, default: () => new Date().toISOString() }
});

const passwordResetSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true },
  otp: { type: String, required: true },
  reset_token: { type: String, required: true },
  expires_at: { type: String, required: true },
  used_at: String
});

const signupOTPSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password_hash: { type: String, required: true },
  otp: { type: String, required: true },
  expires_at: { type: String, required: true },
  attempts: { type: Number, default: 0 }
});

// ─── Models ─────────────────────────────────────────────────────────────────

const User = mongoose.model("User", userSchema);
const Coupon = mongoose.model("Coupon", couponSchema);
const Purchase = mongoose.model("Purchase", purchaseSchema);
const Chat = mongoose.model("Chat", chatSchema);
const Message = mongoose.model("Message", messageSchema);
const Report = mongoose.model("Report", reportSchema);
const Notification = mongoose.model("Notification", notificationSchema);
const BuyRequest = mongoose.model("BuyRequest", buyRequestSchema);
const Payment = mongoose.model("Payment", paymentSchema);
const PasswordReset = mongoose.model("PasswordReset", passwordResetSchema);
const SignupOTP = mongoose.model("SignupOTP", signupOTPSchema);

module.exports = {
  initDb,
  User,
  Coupon,
  Purchase,
  Chat,
  Message,
  Report,
  Notification,
  BuyRequest,
  Payment,
  PasswordReset,
  SignupOTP
};
