const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: ['followup', 'automation', 'email', 'lead', 'system'],
    default: 'followup'
  },
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  
  // Entity reference for deep navigation
  entityType: {
    type: String,
    enum: ['reminder', 'client', 'automation', 'conversation'],
    default: 'reminder'
  },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true },

  // Lead snapshot details for direct display
  leadName: { type: String },
  leadEmail: { type: String },
  leadPhone: { type: String },

  // Status tracking
  readAt: { type: Date, default: null },
  dismissedAt: { type: Date, default: null },
  snoozedUntil: { type: Date, default: null },

  // Idempotency key to prevent duplicate notifications
  idempotencyKey: { type: String, required: true, unique: true, index: true }
}, { timestamps: true });

// Compound indexes for fast unread queries and performance
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, type: 1, readAt: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
