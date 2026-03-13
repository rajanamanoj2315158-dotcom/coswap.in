const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/coswap";

async function initDb() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
    console.log("MongoDB connected:", MONGODB_URI.split("@").pop());
  }
  return mongoose;
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password_hash: { type: String, required: true },
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
  PasswordReset
};
