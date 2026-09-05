const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema({
  eventId: { type: String, unique: true, sparse: true, index: true }, // unique event/lead ID or message ID
  eventType: { type: String, required: true }, // 'leadgen', 'messaging', 'instagram', 'whatsapp'
  platform: { type: String, required: true }, // 'facebook', 'instagram', 'whatsapp'
  payload: { type: mongoose.Schema.Types.Mixed },
  status: { type: String, enum: ['success', 'duplicate', 'failed', 'invalid_signature', 'ignored'], default: 'success' },
  errorMessage: { type: String },
  processedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('WebhookLog', webhookLogSchema);
