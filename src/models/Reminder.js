const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  type: { 
    type: String, 
    enum: ['call', 'email', 'meeting', 'whatsapp', 'sms', 'task', 'note', 'custom'], 
    default: 'call' 
  },
  dueDate: { type: Date, required: true },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'urgent'], 
    default: 'medium' 
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'snoozed', 'cancelled'],
    default: 'pending'
  },
  isCompleted: { type: Boolean, default: false },
  completedAt: { type: Date },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  snoozedUntil: { type: Date },
  
  reminderOption: {
    type: String,
    enum: ['none', '5m', '10m', '15m', '30m', '1h', '2h', '1d', 'custom'],
    default: 'none'
  },
  reminderOffsetMinutes: { type: Number, default: 0 },
  reminderTime: { type: Date },
  reminderSent: { type: Boolean, default: false },
  dueNowSent: { type: Boolean, default: false },
  overdueSent: { type: Boolean, default: false },

  repeat: {
    type: String,
    enum: ['none', 'daily', 'weekly', 'monthly', 'custom'],
    default: 'none'
  },

  isAutomated: { type: Boolean, default: false },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation' },
  automationExecution: { type: mongoose.Schema.Types.ObjectId, ref: 'AutomationExecution' },

  notes: { type: String },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  history: [{
    action: { type: String, required: true }, // e.g., 'created', 'completed', 'rescheduled', 'snoozed', 'reassigned', 'edited'
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
    details: { type: String }
  }],

  idempotencyKey: { type: String, sparse: true, index: true }
}, { timestamps: true });

// Index for efficient querying by client, assignedTo, dueDate, and status
reminderSchema.index({ client: 1, dueDate: 1, status: 1 });
reminderSchema.index({ assignedTo: 1, dueDate: 1, status: 1 });
reminderSchema.index({ reminderSent: 1, reminderTime: 1 });
reminderSchema.index({ dueNowSent: 1, dueDate: 1 });
reminderSchema.index({ overdueSent: 1, dueDate: 1 });

module.exports = mongoose.model('Reminder', reminderSchema);
