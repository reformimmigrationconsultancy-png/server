const express = require('express');
const router = express.Router();
const { protect: auth } = require('../middleware/auth');
const Automation = require('../models/Automation');
const AutomationExecution = require('../models/AutomationExecution');

// Get all automations with basic stats
router.get('/', auth, async (req, res) => {
  try {
    const automations = await Automation.find().sort({ createdAt: -1 });
    
    // Get enrollment stats
    const stats = await AutomationExecution.aggregate([
      { $group: { _id: '$automation', enrolled: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } }
    ]);

    const automationsWithStats = automations.map(auto => {
      const stat = stats.find(s => s._id.toString() === auto._id.toString());
      return {
        ...auto.toObject(),
        stats: stat ? { enrolled: stat.enrolled, active: stat.active } : { enrolled: 0, active: 0 }
      };
    });

    res.json(automationsWithStats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single automation
router.get('/:id', auth, async (req, res) => {
  try {
    const automation = await Automation.findById(req.params.id);
    if (!automation) return res.status(404).json({ message: 'Automation not found' });
    res.json(automation);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create automation
router.post('/', auth, async (req, res) => {
  try {
    const automation = new Automation({
      ...req.body,
      createdBy: req.user.userId
    });
    const newAutomation = await automation.save();
    res.status(201).json(newAutomation);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update automation
router.put('/:id', auth, async (req, res) => {
  try {
    const automation = await Automation.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!automation) return res.status(404).json({ message: 'Automation not found' });
    res.json(automation);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete automation
router.delete('/:id', auth, async (req, res) => {
  try {
    const automation = await Automation.findByIdAndDelete(req.params.id);
    if (!automation) return res.status(404).json({ message: 'Automation not found' });
    
    // Also delete executions
    await AutomationExecution.deleteMany({ automation: req.params.id });
    
    res.json({ message: 'Automation deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get executions for a specific client
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

// Update execution status (pause/resume/stop)
router.patch('/executions/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const execution = await AutomationExecution.findById(req.params.id);
    if (!execution) return res.status(404).json({ message: 'Execution not found' });

    execution.status = status;
    
    // Log the change
    execution.history.push({
      stepIndex: execution.currentStepIndex,
      action: 'status_change',
      status: 'success',
      details: `Status manually changed to ${status}`
    });

    await execution.save();
    res.json(execution);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
