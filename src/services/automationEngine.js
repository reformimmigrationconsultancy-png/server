const Automation = require('../models/Automation');
const AutomationExecution = require('../models/AutomationExecution');
const EmailTemplate = require('../models/EmailTemplate');
const Reminder = require('../models/Reminder');
const Client = require('../models/Client');
const User = require('../models/User');
const { sendNotificationEmail } = require('../utils/notifications');
const { resolveVariables } = require('../utils/variableResolver');

const replaceVariables = (text, client, admin) => {
  return resolveVariables(text, client, admin);
};

const executeStep = async (execution) => {
  const { automation, client, currentStepIndex } = execution;
  const step = automation.steps.find(s => s.order === currentStepIndex + 1);

  if (!step) {
    // No more steps, mark as completed
    execution.status = 'completed';
    execution.completedAt = new Date();
    await execution.save();
    return;
  }

  // Check stop conditions (e.g., if lead stage changed to a stop stage)
  if (automation.stopConditions && Array.isArray(automation.stopConditions.stopOnStage)) {
    if (automation.stopConditions.stopOnStage.includes(client.stage)) {
      execution.status = 'stopped';
      execution.history.push({
        stepIndex: currentStepIndex,
        action: 'stop',
        status: 'success',
        details: `Automation stopped automatically because lead stage is '${client.stage}'`
      });
      await execution.save();
      return;
    }
  }

  // Idempotency check: Did we already execute this step index successfully?
  const alreadyRan = execution.history.find(h => h.stepIndex === currentStepIndex && h.status === 'success');
  if (alreadyRan) {
    console.log(`[Automation] Skipping step ${currentStepIndex} for execution ${execution._id} - already ran.`);
    execution.currentStepIndex += 1;
    await execution.save();
    return;
  }

  try {
    const admin = await User.findOne({ role: 'admin' }); // Assuming we assign tasks/send from admin

    if (step.action === 'wait') {
      const { delayValue, delayUnit } = step.config;
      const msMultiplier = delayUnit === 'minutes' ? 60000 : (delayUnit === 'hours' ? 3600000 : 86400000);
      const delayMs = (parseInt(delayValue) || 1) * msMultiplier;
      
      execution.nextRunAt = new Date(Date.now() + delayMs);
      
      execution.history.push({ stepIndex: currentStepIndex, action: 'wait', status: 'success', details: `Waiting ${delayValue} ${delayUnit}` });
      execution.currentStepIndex += 1;
      await execution.save();
      return;
    }

    if (step.action === 'send_email') {
      const template = await EmailTemplate.findById(step.config.templateId);
      if (!template) throw new Error('Template not found');
      if (!client.email || client.email.includes('example.com') || client.email.includes('@fb.com')) {
        throw new Error('Lead has no valid email');
      }

      const subject = replaceVariables(template.subject, client, admin);
      const bodyHtml = replaceVariables(template.body, client, admin);

      await sendNotificationEmail(subject, 'Automated Email', bodyHtml, client.email);
      
      execution.history.push({ stepIndex: currentStepIndex, action: 'send_email', status: 'success', details: `Sent email: ${template.name}` });
      execution.currentStepIndex += 1;
      execution.nextRunAt = new Date(); // Immediately run next step if possible
      await execution.save();
      return;
    }

    if (step.action === 'create_task') {
      const { title, dueInValue, dueInUnit, priority, notes } = step.config;
      const msMultiplier = dueInUnit === 'minutes' ? 60000 : (dueInUnit === 'hours' ? 3600000 : 86400000);
      const dueDate = new Date(Date.now() + (parseInt(dueInValue) || 1) * msMultiplier);

      await Reminder.create({
        title: replaceVariables(title, client, admin) || 'Follow up',
        client: client._id,
        dueDate,
        priority: priority || 'medium',
        notes: replaceVariables(notes, client, admin),
        assignedTo: admin._id,
        createdBy: admin._id,
        isAutomated: true,
        automation: execution.automation ? execution.automation._id : null,
        automationExecution: execution._id,
        history: [{
          action: 'created',
          performedBy: admin._id,
          timestamp: new Date(),
          details: `Automated task created via '${execution.automation?.name || 'Automation'}'`
        }]
      });

      execution.history.push({ stepIndex: currentStepIndex, action: 'create_task', status: 'success', details: `Task created: ${title}` });
      execution.currentStepIndex += 1;
      execution.nextRunAt = new Date();
      await execution.save();
      return;
    }

    if (step.action === 'change_stage') {
      client.stage = step.config.newStage || client.stage;
      await client.save();
      
      execution.history.push({ stepIndex: currentStepIndex, action: 'change_stage', status: 'success', details: `Stage changed to ${step.config.newStage}` });
      execution.currentStepIndex += 1;
      execution.nextRunAt = new Date();
      await execution.save();
      return;
    }

    if (step.action === 'stop') {
      execution.status = 'stopped';
      execution.history.push({ stepIndex: currentStepIndex, action: 'stop', status: 'success', details: `Automation explicitly stopped` });
      await execution.save();
      return;
    }

  } catch (err) {
    console.error(`❌ [Automation] Step ${currentStepIndex} failed for lead ${client._id}:`, err.message);
    execution.status = 'failed';
    execution.failureReason = err.message;
    execution.history.push({ stepIndex: currentStepIndex, action: step.action, status: 'failed', details: err.message });
    await execution.save();
  }
};

const runEngine = async () => {
  try {
    // Find all executions that are active and due
    const dueExecutions = await AutomationExecution.find({
      status: 'active',
      $or: [
        { nextRunAt: { $lte: new Date() } },
        { nextRunAt: null },
        { nextRunAt: { $exists: false } }
      ]
    }).populate('client').populate('automation');

    for (const execution of dueExecutions) {
      if (!execution.automation || !execution.automation.isActive || !execution.client) {
        execution.status = 'failed';
        execution.failureReason = 'Automation or Client missing/inactive';
        await execution.save();
        continue;
      }
      await executeStep(execution);
    }
  } catch (error) {
    console.error('❌ [Automation Engine] Error:', error.message);
  }
};

const startEngine = () => {
  console.log('🚀 [Automation Engine] Starting persistent scheduler...');
  // Run every 1 minute
  setInterval(runEngine, 60 * 1000);
  
  // Also run immediately on startup after a small delay
  setTimeout(runEngine, 5000);
};

const enrollLead = async (client) => {
  try {
    // Find automations that match
    // For simplicity, we check triggers: 'new_lead'
    const matchingAutomations = await Automation.find({ 
      isActive: true, 
      trigger: 'new_lead'
    });

    for (const auto of matchingAutomations) {
      let match = true;
      if (auto.triggerConditions?.source && auto.triggerConditions.source !== 'all') {
        if (auto.triggerConditions.source !== client.source) match = false;
      }

      if (match) {
        // Enroll
        try {
          await AutomationExecution.create({
            client: client._id,
            automation: auto._id,
            currentStepIndex: 0,
            status: 'active',
            nextRunAt: new Date()
          });
          console.log(`✅ [Automation] Enrolled lead ${client.fullName} in automation: ${auto.name}`);
        } catch (dupErr) {
          // Ignore duplicate enrollment error due to unique index
        }
      }
    }
  } catch (err) {
    console.error('❌ [Automation] Enrollment error:', err.message);
  }
};

const stopAutomationsForLead = async (clientId, reason) => {
  try {
    await AutomationExecution.updateMany(
      { client: clientId, status: 'active' },
      { 
        $set: { status: 'stopped', failureReason: reason },
        $push: { history: { stepIndex: -1, action: 'stop', status: 'success', details: `Stopped: ${reason}` } }
      }
    );
  } catch (err) {
    console.error('❌ [Automation] Stop automations error:', err.message);
  }
}

module.exports = {
  startEngine,
  enrollLead,
  stopAutomationsForLead
};
