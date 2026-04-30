const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: {
    type: String, // 'client' or 'agent'
    enum: ['client', 'agent'],
    required: true
  },
  content: { type: String, required: true },
  messageType: {
    type: String,
    enum: ['text', 'image', 'document', 'audio', 'video', 'email'],
    default: 'text'
  },
  attachments: [{
    url: String,
    filename: String,
    mimetype: String
  }],
  externalId: { type: String }, // ID from WhatsApp/FB/IG
  read: { type: Boolean, default: false },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // if agent sent it
}, { timestamps: true });

const conversationSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  platform: {
    type: String,
    enum: ['whatsapp', 'facebook', 'instagram', 'email', 'website', 'call'],
    required: true
  },
  externalConversationId: { type: String }, // external platform conversation ID
  platformContactId: { type: String }, // user/page ID on external platform
  subject: { type: String }, // for emails
  status: {
    type: String,
    enum: ['open', 'pending', 'resolved', 'archived'],
    default: 'open'
  },
  tags: [{ type: String, enum: ['hot_lead', 'follow_up', 'closed', 'important'] }],
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastMessage: { type: String },
  lastMessageAt: { type: Date, default: Date.now },
  unreadCount: { type: Number, default: 0 },
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = { Message, Conversation };
