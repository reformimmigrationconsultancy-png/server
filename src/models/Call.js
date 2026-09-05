const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  direction: { type: String, enum: ['inbound', 'outbound'], default: 'outbound' },
  status: { type: String, enum: ['answered', 'missed', 'voicemail', 'busy'], default: 'answered' },
  duration: { type: Number, default: 0 }, // in seconds
  notes: { type: String },
  recordingUrl: { type: String },
  twilioCallSid: { type: String },
  loggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  callTime: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Call', callSchema);
