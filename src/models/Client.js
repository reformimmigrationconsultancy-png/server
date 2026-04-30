const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  source: {
    type: String,
    enum: ['whatsapp', 'facebook', 'instagram', 'email', 'website', 'call', 'manual'],
    default: 'manual'
  },
  platformContactId: { type: String }, // PSID for Facebook, Phone for WhatsApp
  externalId: { type: String },

  stage: {
    type: String,
    enum: ['new_lead', 'contacted', 'interested', 'documents_received', 'approved', 'closed'],
    default: 'new_lead'
  },
  tags: [{ type: String }],
  notes: [{
    content: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  documents: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    uploadedAt: { type: Date, default: Date.now }
  }],
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  loanAmount: { type: Number },
  propertyValue: { type: Number },
  address: { type: String },
  isArchived: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Client', clientSchema);
