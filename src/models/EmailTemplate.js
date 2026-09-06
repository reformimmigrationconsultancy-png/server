const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  subject: { type: String, required: true },
  body: { type: String, required: true },
  category: { 
    type: String, 
    enum: ['Welcome', 'Follow-up', 'Appointment', 'Reminder', 'General', 'Custom'],
    default: 'General'
  },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
