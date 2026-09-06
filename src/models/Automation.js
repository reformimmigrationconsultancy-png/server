const mongoose = require('mongoose');

const automationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  trigger: {
    type: String,
    enum: ['new_lead', 'stage_changed', 'assigned', 'manual'],
    default: 'new_lead',
    required: true
  },
  triggerConditions: {
    source: { type: String }, // e.g., 'facebook', 'google', 'website', 'all'
    stage: { type: String }
  },
  stopConditions: {
    stopOnReply: { type: Boolean, default: true },
    stopOnStage: [{ type: String }] // e.g. ['contacted', 'converted', 'closed']
  },
  settings: {
    workingHoursOnly: { type: Boolean, default: false },
    timezone: { type: String, default: 'UTC' },
    maxEmailsPerLead: { type: Number, default: 10 }
  },
  steps: [{
    action: {
      type: String,
      enum: ['send_email', 'wait', 'create_task', 'change_stage', 'stop'],
      required: true
    },
    config: {
      // For send_email: templateId (ObjectId), subjectOverride (String)
      // For wait: delayValue (Number), delayUnit ('minutes', 'hours', 'days')
      // For create_task: title, dueInValue, dueInUnit, priority, notes, type
      // For change_stage: newStage
      type: mongoose.Schema.Types.Mixed
    },
    order: { type: Number, required: true }
  }],
  status: {
    type: String,
    enum: ['active', 'paused', 'draft', 'error'],
    default: 'draft'
  },
  isActive: { type: Boolean, default: false },
  lastRunAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Sync status with isActive before save
automationSchema.pre('save', function(next) {
  if (this.isActive && this.status === 'draft') {
    this.status = 'active';
  } else if (!this.isActive && this.status === 'active') {
    this.status = 'paused';
  }
  next();
});

module.exports = mongoose.model('Automation', automationSchema);

