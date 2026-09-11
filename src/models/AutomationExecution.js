const mongoose = require('mongoose');

const automationExecutionSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  automation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation', required: true },
  currentStepIndex: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'stopped', 'failed'],
    default: 'active'
  },
  nextRunAt: { type: Date },
  completedAt: { type: Date },
  failureReason: { type: String },
  history: [{
    stepIndex: Number,
    action: String,
    executedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['success', 'failed'], default: 'success' },
    details: mongoose.Schema.Types.Mixed
  }]
}, { timestamps: true });

// Prevent a client from being actively enrolled in the exact same automation twice
automationExecutionSchema.index({ client: 1, automation: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });

module.exports = mongoose.model('AutomationExecution', automationExecutionSchema);
