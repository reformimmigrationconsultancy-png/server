const express = require('express');
const Reminder = require('../models/Reminder');
const { protect } = require('../middleware/auth');
const calendar = require('../services/calendar');

const router = express.Router();

// GET /api/reminders
router.get('/', protect, async (req, res) => {
  try {
    const { completed, from, to } = req.query;
    const filter = { assignedTo: req.user._id };
    if (completed !== undefined) filter.isCompleted = completed === 'true';
    if (from || to) {
      filter.dueDate = {};
      if (from) filter.dueDate.$gte = new Date(from);
      if (to) filter.dueDate.$lte = new Date(to);
    }
    const reminders = await Reminder.find(filter)
      .populate('client', 'fullName phone')
      .sort({ dueDate: 1 });
    res.json({ success: true, reminders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reminders
router.post('/', protect, async (req, res) => {
  try {
    const reminder = await Reminder.create({
      ...req.body,
      assignedTo: req.body.assignedTo || req.user._id,
      createdBy: req.user._id,
    });

    // Sync with External Calendar
    try {
       await calendar.syncToExternal(reminder);
       console.log('✅ Synchronized with external calendar');
    } catch(err) {
       console.warn('⚠️ Calendar sync skipped/failed:', err.message);
    }

    const populated = await reminder.populate('client', 'fullName phone');
    res.status(201).json({ success: true, reminder: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/reminders/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const reminder = await Reminder.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('client', 'fullName phone');
    res.json({ success: true, reminder });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/reminders/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Reminder deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

