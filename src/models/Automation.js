const mongoose = require('mongoose');

const automationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  trigger: {
    type: String,
    enum: ['new_lead', 'stage_changed', 'assigned', 'manual'],
    required: true
  },
  triggerConditions: {
    source: { type: String }, // e.g., 'facebook', 'google', 'website'
    stage: { type: String }
  },
  steps: [{
    action: {
      type: String,
      enum: ['send_email', 'wait', 'create_task', 'change_stage', 'stop'],
      required: true
    },
    config: {
      // For send_email: templateId (ObjectId)
      // For wait: delayValue (Number), delayUnit ('minutes', 'hours', 'days')
      // For create_task: title, dueInValue, dueInUnit, priority, notes
      // For change_stage: newStage
      type: mongoose.Schema.Types.Mixed
    },
    order: { type: Number, required: true }
  }],
  isActive: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Automation', automationSchema);
