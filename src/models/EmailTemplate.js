const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  subject: { type: String, required: true, trim: true },
  body: { type: String, required: true },
  category: { 
    type: String, 
    enum: ['Welcome', 'Follow-up', 'Appointment', 'Reminder', 'Documents', 'Application', 'Re-engagement', 'General', 'Custom'],
    default: 'General'
  },
  status: {
    type: String,
    enum: ['active', 'draft', 'archived'],
    default: 'active'
  },
  isActive: { type: Boolean, default: true },
  usageCount: { type: Number, default: 0 },
  lastUsedAt: { type: Date },
  isSystem: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Pre-save hook to sync isActive and status
emailTemplateSchema.pre('save', function(next) {
  if (this.status === 'archived') {
    this.isActive = false;
  } else if (this.status === 'active') {
    this.isActive = true;
  }
  next();
});

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);

