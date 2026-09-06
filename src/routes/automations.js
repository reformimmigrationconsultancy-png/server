const express = require('express');
const router = express.Router();
const { protect: auth } = require('../middleware/auth');
const Automation = require('../models/Automation');
const AutomationExecution = require('../models/AutomationExecution');
const Client = require('../models/Client');

// 1. GET /api/automations/stats - Summary Metrics (MUST be before /:id)
router.get('/stats', auth, async (req, res) => {
  try {
    const activeCount = await Automation.countDocuments({ isActive: true });
    const pausedCount = await Automation.countDocuments({ isActive: false, status: 'paused' });
    const totalEnrolled = await AutomationExecution.countDocuments({ status: 'active' });

    // Actions executed this week
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let actionsThisWeek = 0;
    try {
      const weeklyActionsAgg = await AutomationExecution.aggregate([
        { $match: { 'history.executedAt': { $gte: oneWeekAgo }, 'history.status': 'success' } },
        { $unwind: { path: '$history', preserveNullAndEmptyArrays: false } },
        { $match: { 'history.executedAt': { $gte: oneWeekAgo }, 'history.status': 'success' } },
        { $count: 'totalThisWeek' }
      ]);
      actionsThisWeek = weeklyActionsAgg[0]?.totalThisWeek || 0;
    } catch (aggErr) {
      console.warn('⚠️ Weekly actions aggregation fallback:', aggErr.message);
      actionsThisWeek = 0;
    }

    res.json({
      success: true,
      stats: {
        active: activeCount,
        paused: pausedCount,
        enrolled: totalEnrolled,
        actionsThisWeek
      }
    });
  } catch (err) {
    console.error('❌ Automation Stats Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. GET /api/automations/activity - Global Automation Activity Feed (MUST be before /:id)
router.get('/activity', auth, async (req, res) => {
  try {
    const executions = await AutomationExecution.find()
      .populate('client', 'fullName email phone source')
      .populate('automation', 'name')
      .sort({ updatedAt: -1 })
      .limit(30);

    const feed = [];
    if (Array.isArray(executions)) {
      executions.forEach(exec => {
        if (exec && Array.isArray(exec.history)) {
          exec.history.forEach(h => {
            if (h) {
              feed.push({
                id: `${exec._id}-${h.stepIndex || 0}-${h.executedAt ? new Date(h.executedAt).getTime() : Date.now()}`,
                executionId: exec._id,
                automationName: exec.automation?.name || 'Automation',
                client: exec.client ? { _id: exec.client._id, name: exec.client.fullName, email: exec.client.email } : null,
                action: h.action || 'action',
                status: h.status || 'success',
                details: h.details || '',
                executedAt: h.executedAt || exec.updatedAt || new Date()
              });
            }
          });
        }
      });
    }

    // Sort feed by executedAt descending
    feed.sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt));

    res.json({ success: true, activity: feed.slice(0, 30) });
  } catch (err) {
    console.error('❌ Automation Activity Error:', err);
    res.status(500).json({ success: false, message: err.message, activity: [] });
  }
});

// 3. GET /api/automations/executions/client/:clientId - Get executions for a client (MUST be before /:id)
router.get('/executions/client/:clientId', auth, async (req, res) => {
  try {
    const executions = await AutomationExecution.find({ client: req.params.clientId })
      .populate('automation')
      .sort({ createdAt: -1 });
    res.json(executions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. GET /api/automations - List automations with search, filters, and stats
router.get('/', auth, async (req, res) => {
  try {
    const { search, status, trigger, sort } = req.query;

    const filter = {};
    if (status && status !== 'all') {
      if (status === 'active') filter.isActive = true;
      else if (status === 'paused') { filter.isActive = false; filter.status = 'paused'; }
      else if (status === 'draft') { filter.status = 'draft'; }
    }

    if (trigger && trigger !== 'all') {
      filter.trigger = trigger;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { description: searchRegex },
        { trigger: searchRegex }
      ];
    }

    let query = Automation.find(filter);

    if (sort === 'recently_updated') query = query.sort({ updatedAt: -1 });
    else if (sort === 'recently_created') query = query.sort({ createdAt: -1 });
    else query = query.sort({ createdAt: -1 });

    const automations = await query.exec();

    // Aggregate stats per automation
    let statsAgg = [];
    try {
      statsAgg = await AutomationExecution.aggregate([
        {
          $group: {
            _id: '$automation',
            enrolled: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
            stopped: { $sum: { $cond: [{ $eq: ['$status', 'stopped'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
            lastActivityAt: { $max: '$updatedAt' }
          }
        }
      ]);
    } catch (aggErr) {
      console.warn('⚠️ Per-automation stats aggregation fallback:', aggErr.message);
    }

    const result = automations.map(auto => {
      const stat = statsAgg.find(s => s._id && s._id.toString() === auto._id.toString());
      return {
        ...auto.toObject(),
        stats: {
          enrolled: stat?.enrolled || 0,
          active: stat?.active || 0,
          completed: stat?.completed || 0,
          stopped: stat?.stopped || 0,
          failed: stat?.failed || 0,
          lastActivityAt: stat?.lastActivityAt || auto.updatedAt
        }
      };
    });

    res.json(result);
  } catch (err) {
    console.error('❌ Get Automations List Error:', err);
    res.status(500).json({ message: err.message });
  }
});

// 5. GET /api/automations/:id/details - Detail view with enrolled leads and execution logs
router.get('/:id/details', auth, async (req, res) => {
  try {
    const automation = await Automation.findById(req.params.id);
    if (!automation) return res.status(404).json({ message: 'Automation not found' });

    const executions = await AutomationExecution.find({ automation: req.params.id })
      .populate('client', 'fullName email phone stage source')
      .sort({ updatedAt: -1 })
      .limit(100);

    const failures = executions.filter(e => e.status === 'failed' || e.failureReason);

    res.json({
      success: true,
      automation,
      executions,
      failures
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 6. GET /api/automations/:id - Get single automation
router.get('/:id', auth, async (req, res) => {
  try {
    const automation = await Automation.findById(req.params.id);
    if (!automation) return res.status(404).json({ message: 'Automation not found' });
    res.json(automation);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 7. POST /api/automations - Create automation
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, trigger, triggerConditions, stopConditions, settings, steps, isActive } = req.body;

    const automation = new Automation({
      name,
      description,
      trigger: trigger || 'new_lead',
      triggerConditions: triggerConditions || {},
      stopConditions: stopConditions || { stopOnReply: true, stopOnStage: ['contacted', 'converted'] },
      settings: settings || {},
      steps: steps || [],
      isActive: !!isActive,
      status: isActive ? 'active' : 'draft',
      createdBy: req.user?._id || req.user?.userId
    });

    const newAutomation = await automation.save();
    res.status(201).json(newAutomation);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 8. POST /api/automations/:id/duplicate - Clone automation as draft
router.post('/:id/duplicate', auth, async (req, res) => {
  try {
    const existing = await Automation.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Automation not found' });

    const copyData = existing.toObject();
    delete copyData._id;
    delete copyData.createdAt;
    delete copyData.updatedAt;

    copyData.name = `${existing.name} (Copy)`;
    copyData.isActive = false;
    copyData.status = 'draft';
    copyData.createdBy = req.user?._id || req.user?.userId;

    const newAutomation = await Automation.create(copyData);
    res.status(201).json({ success: true, automation: newAutomation });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 9. PUT /api/automations/:id - Update automation
router.put('/:id', auth, async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.isActive !== undefined) {
      updates.status = updates.isActive ? 'active' : 'paused';
    }

    const automation = await Automation.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!automation) return res.status(404).json({ message: 'Automation not found' });
    res.json(automation);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 10. DELETE /api/automations/:id - Delete automation and execution history
router.delete('/:id', auth, async (req, res) => {
  try {
    const automation = await Automation.findByIdAndDelete(req.params.id);
    if (!automation) return res.status(404).json({ message: 'Automation not found' });

    await AutomationExecution.deleteMany({ automation: req.params.id });

    res.json({ message: 'Automation deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 11. PATCH /api/automations/executions/:id/status - Update execution status
router.patch('/executions/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const execution = await AutomationExecution.findById(req.params.id);
    if (!execution) return res.status(404).json({ message: 'Execution not found' });

    execution.status = status;
    execution.history.push({
      stepIndex: execution.currentStepIndex,
      action: 'status_change',
      status: 'success',
      details: `Status manually updated to ${status}`
    });

    await execution.save();
    res.json(execution);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
