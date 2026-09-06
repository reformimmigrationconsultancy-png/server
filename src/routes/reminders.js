const express = require('express');
const Reminder = require('../models/Reminder');
const Client = require('../models/Client');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const calendar = require('../services/calendar');

const router = express.Router();

// Helper to populate client and user fields
const populateReminderQuery = (query) => {
  return query
    .populate('client', 'fullName email phone source stage')
    .populate('assignedTo', 'name email role')
    .populate('createdBy', 'name email')
    .populate('completedBy', 'name email')
    .populate('history.performedBy', 'name email');
};

// GET /api/reminders/stats - Calculate live CRM follow-up metrics
router.get('/stats', protect, async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // Build filter based on role (Admin sees all unless filtered, agent sees assigned)
    const baseFilter = req.user.role === 'admin' ? {} : { assignedTo: req.user._id };

    const allReminders = await Reminder.find(baseFilter).lean();

    let overdueCount = 0;
    let todayCount = 0;
    let upcomingCount = 0;
    let completedCount = 0;

    let totalCompletionMs = 0;
    let completedWithTimeCount = 0;

    const byUser = {};
    const byType = {};

    allReminders.forEach(r => {
      const due = new Date(r.dueDate);
      const isDone = r.isCompleted || r.status === 'completed';
      const isSnoozedActive = r.status === 'snoozed' && r.snoozedUntil && new Date(r.snoozedUntil) > now;

      // Stats breakdown by Type
      byType[r.type] = (byType[r.type] || 0) + 1;

      if (isDone) {
        completedCount += 1;
        if (r.createdAt && r.completedAt) {
          totalCompletionMs += (new Date(r.completedAt) - new Date(r.createdAt));
          completedWithTimeCount += 1;
        }
      } else if (!isSnoozedActive) {
        if (due < startOfToday) {
          overdueCount += 1;
        } else if (due >= startOfToday && due <= endOfToday) {
          todayCount += 1;
        } else if (due > endOfToday) {
          upcomingCount += 1;
        }
      } else {
        // Active snoozed items can be categorized under upcoming or snoozed
        upcomingCount += 1;
      }

      // Stats breakdown by user
      const assignedId = r.assignedTo ? r.assignedTo.toString() : 'unassigned';
      if (!byUser[assignedId]) {
        byUser[assignedId] = { completed: 0, overdue: 0, pending: 0 };
      }
      if (isDone) {
        byUser[assignedId].completed += 1;
      } else if (due < startOfToday && !isSnoozedActive) {
        byUser[assignedId].overdue += 1;
      } else {
        byUser[assignedId].pending += 1;
      }
    });

    const totalTasks = allReminders.length;
    const completionRate = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;
    const avgCompletionHours = completedWithTimeCount > 0 
      ? (totalCompletionMs / completedWithTimeCount / (1000 * 60 * 60)).toFixed(1) 
      : '0.0';

    res.json({
      success: true,
      stats: {
        overdue: overdueCount,
        today: todayCount,
        upcoming: upcomingCount,
        completed: completedCount,
        total: totalTasks,
        completionRate,
        avgCompletionHours,
        byType,
        byUser
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reminders - List follow-ups with search, filtering, and population
router.get('/', protect, async (req, res) => {
  try {
    const { 
      search, 
      status, 
      priority, 
      type, 
      assignedTo, 
      client, 
      isAutomated, 
      view, 
      from, 
      to 
    } = req.query;

    const filter = {};

    // Scope by role: Normal user sees assigned tasks unless admin
    if (req.user.role !== 'admin') {
      filter.assignedTo = req.user._id;
    } else if (assignedTo && assignedTo !== 'all') {
      filter.assignedTo = assignedTo;
    }

    if (client) {
      filter.client = client;
    }

    if (priority && priority !== 'all') {
      filter.priority = priority;
    }

    if (type && type !== 'all') {
      filter.type = type;
    }

    if (isAutomated !== undefined && isAutomated !== 'all') {
      filter.isAutomated = isAutomated === 'true';
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // Filter by CRM Status / Category
    if (status) {
      if (status === 'completed') {
        filter.$or = [{ isCompleted: true }, { status: 'completed' }];
      } else if (status === 'overdue') {
        filter.isCompleted = false;
        filter.status = { $ne: 'completed' };
        filter.dueDate = { $lt: startOfToday };
        // Exclude active snoozed
        filter.$or = [
          { snoozedUntil: { $exists: false } },
          { snoozedUntil: null },
          { snoozedUntil: { $lte: now } }
        ];
      } else if (status === 'today') {
        filter.isCompleted = false;
        filter.status = { $ne: 'completed' };
        filter.dueDate = { $gte: startOfToday, $lte: endOfToday };
      } else if (status === 'upcoming') {
        filter.isCompleted = false;
        filter.status = { $ne: 'completed' };
        filter.dueDate = { $gt: endOfToday };
      } else if (status === 'snoozed') {
        filter.status = 'snoozed';
        filter.snoozedUntil = { $gt: now };
      } else if (status === 'pending') {
        filter.isCompleted = false;
        filter.status = { $ne: 'completed' };
      }
    }

    if (from || to) {
      filter.dueDate = filter.dueDate || {};
      if (from) filter.dueDate.$gte = new Date(from);
      if (to) filter.dueDate.$lte = new Date(to);
    }

    let remindersQuery = Reminder.find(filter);

    // If search term is present, find matching clients first then filter
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      const matchingClients = await Client.find({
        $or: [
          { fullName: searchRegex },
          { email: searchRegex },
          { phone: searchRegex }
        ]
      }).select('_id');

      const clientIds = matchingClients.map(c => c._id);

      remindersQuery = Reminder.find({
        ...filter,
        $or: [
          { title: searchRegex },
          { description: searchRegex },
          { notes: searchRegex },
          { client: { $in: clientIds } }
        ]
      });
    }

    const reminders = await populateReminderQuery(remindersQuery.sort({ dueDate: 1 }));

    res.json({ success: true, count: reminders.length, reminders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reminders - Create a new follow-up
router.post('/', protect, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      client, 
      type, 
      dueDate, 
      priority, 
      notes, 
      assignedTo, 
      reminderOption, 
      repeat,
      idempotencyKey 
    } = req.body;

    if (!title || !dueDate) {
      return res.status(400).json({ success: false, message: 'Title and due date are required' });
    }

    // Idempotency check
    if (idempotencyKey) {
      const existing = await Reminder.findOne({ idempotencyKey });
      if (existing) {
        const populatedExisting = await populateReminderQuery(Reminder.findById(existing._id));
        return res.json({ success: true, reminder: populatedExisting, duplicateSkipped: true });
      }
    }

    // Calculate reminder time if requested
    let reminderTime = null;
    if (reminderOption && reminderOption !== 'none') {
      const dueMs = new Date(dueDate).getTime();
      let offsetMs = 0;
      if (reminderOption === '15m') offsetMs = 15 * 60 * 1000;
      if (reminderOption === '30m') offsetMs = 30 * 60 * 1000;
      if (reminderOption === '1h') offsetMs = 60 * 60 * 1000;
      if (reminderOption === '1d') offsetMs = 24 * 60 * 60 * 1000;
      reminderTime = new Date(dueMs - offsetMs);
    }

    const reminderData = {
      title,
      description,
      client: client || null,
      type: type || 'call',
      dueDate: new Date(dueDate),
      priority: priority || 'medium',
      notes,
      assignedTo: assignedTo || req.user._id,
      createdBy: req.user._id,
      reminderOption: reminderOption || 'none',
      reminderTime,
      repeat: repeat || 'none',
      idempotencyKey,
      history: [{
        action: 'created',
        performedBy: req.user._id,
        timestamp: new Date(),
        details: 'Follow-up created'
      }]
    };

    const reminder = await Reminder.create(reminderData);

    // Sync with External Calendar if configured
    try {
      await calendar.syncToExternal(reminder);
    } catch (err) {
      console.warn('⚠️ Calendar sync skipped/failed:', err.message);
    }

    const populated = await populateReminderQuery(Reminder.findById(reminder._id));
    res.status(201).json({ success: true, reminder: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reminders/:id - Get single follow-up detail
router.get('/:id', protect, async (req, res) => {
  try {
    const reminder = await populateReminderQuery(Reminder.findById(req.params.id));
    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Follow-up not found' });
    }
    res.json({ success: true, reminder });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/reminders/:id - Update follow-up details
router.put('/:id', protect, async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Follow-up not found' });
    }

    const updates = { ...req.body };
    const historyEntries = [];

    if (updates.dueDate && new Date(updates.dueDate).getTime() !== new Date(reminder.dueDate).getTime()) {
      historyEntries.push({
        action: 'rescheduled',
        performedBy: req.user._id,
        timestamp: new Date(),
        details: `Due date changed to ${new Date(updates.dueDate).toLocaleString()}`
      });
    }

    if (updates.assignedTo && updates.assignedTo.toString() !== reminder.assignedTo.toString()) {
      historyEntries.push({
        action: 'reassigned',
        performedBy: req.user._id,
        timestamp: new Date(),
        details: `Reassigned`
      });
    }

    if (updates.isCompleted && !reminder.isCompleted) {
      updates.status = 'completed';
      updates.completedAt = new Date();
      updates.completedBy = req.user._id;
      historyEntries.push({
        action: 'completed',
        performedBy: req.user._id,
        timestamp: new Date(),
        details: 'Marked as completed'
      });
    }

    if (historyEntries.length > 0) {
      updates.$push = { history: { $each: historyEntries } };
    }

    const updated = await populateReminderQuery(
      Reminder.findByIdAndUpdate(req.params.id, updates, { new: true })
    );

    res.json({ success: true, reminder: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reminders/:id/complete - Complete task with explicit log
router.post('/:id/complete', protect, async (req, res) => {
  try {
    const reminder = await Reminder.findById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Follow-up not found' });
    }

    const updated = await populateReminderQuery(
      Reminder.findByIdAndUpdate(
        req.params.id,
        {
          isCompleted: true,
          status: 'completed',
          completedAt: new Date(),
          completedBy: req.user._id,
          $push: {
            history: {
              action: 'completed',
              performedBy: req.user._id,
              timestamp: new Date(),
              details: 'Follow-up completed'
            }
          }
        },
        { new: true }
      )
    );

    res.json({ success: true, reminder: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reminders/:id/reschedule - Reschedule task
router.post('/:id/reschedule', protect, async (req, res) => {
  try {
    const { dueDate } = req.body;
    if (!dueDate) {
      return res.status(400).json({ success: false, message: 'New due date is required' });
    }

    const reminder = await Reminder.findById(req.params.id);
    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Follow-up not found' });
    }

    const newDate = new Date(dueDate);

    const updated = await populateReminderQuery(
      Reminder.findByIdAndUpdate(
        req.params.id,
        {
          dueDate: newDate,
          isCompleted: false,
          status: 'pending',
          snoozedUntil: null,
          reminderSent: false,
          $push: {
            history: {
              action: 'rescheduled',
              performedBy: req.user._id,
              timestamp: new Date(),
              details: `Rescheduled to ${newDate.toLocaleString()}`
            }
          }
        },
        { new: true }
      )
    );

    res.json({ success: true, reminder: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reminders/:id/snooze - Snooze task
router.post('/:id/snooze', protect, async (req, res) => {
  try {
    const { snoozeMinutes, snoozedUntil } = req.body;
    let untilDate = snoozedUntil ? new Date(snoozedUntil) : null;
    
    if (!untilDate && snoozeMinutes) {
      untilDate = new Date(Date.now() + parseInt(snoozeMinutes) * 60 * 1000);
    }

    if (!untilDate) {
      return res.status(400).json({ success: false, message: 'Valid snooze time required' });
    }

    const updated = await populateReminderQuery(
      Reminder.findByIdAndUpdate(
        req.params.id,
        {
          status: 'snoozed',
          snoozedUntil: untilDate,
          $push: {
            history: {
              action: 'snoozed',
              performedBy: req.user._id,
              timestamp: new Date(),
              details: `Snoozed until ${untilDate.toLocaleString()}`
            }
          }
        },
        { new: true }
      )
    );

    res.json({ success: true, reminder: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reminders/bulk - Perform bulk actions on selected follow-ups
router.post('/bulk', protect, async (req, res) => {
  try {
    const { action, ids, payload } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one follow-up' });
    }

    if (action === 'complete') {
      await Reminder.updateMany(
        { _id: { $in: ids } },
        {
          isCompleted: true,
          status: 'completed',
          completedAt: new Date(),
          completedBy: req.user._id,
          $push: {
            history: {
              action: 'completed',
              performedBy: req.user._id,
              timestamp: new Date(),
              details: 'Bulk completed'
            }
          }
        }
      );
    } else if (action === 'reschedule' && payload?.dueDate) {
      const newDate = new Date(payload.dueDate);
      await Reminder.updateMany(
        { _id: { $in: ids } },
        {
          dueDate: newDate,
          isCompleted: false,
          status: 'pending',
          snoozedUntil: null,
          $push: {
            history: {
              action: 'rescheduled',
              performedBy: req.user._id,
              timestamp: new Date(),
              details: `Bulk rescheduled to ${newDate.toLocaleString()}`
            }
          }
        }
      );
    } else if (action === 'assign' && payload?.assignedTo) {
      await Reminder.updateMany(
        { _id: { $in: ids } },
        {
          assignedTo: payload.assignedTo,
          $push: {
            history: {
              action: 'reassigned',
              performedBy: req.user._id,
              timestamp: new Date(),
              details: 'Bulk reassigned'
            }
          }
        }
      );
    } else if (action === 'delete') {
      await Reminder.deleteMany({ _id: { $in: ids } });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid bulk action' });
    }

    res.json({ success: true, message: `Bulk action '${action}' completed successfully` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/reminders/:id - Delete follow-up
router.delete('/:id', protect, async (req, res) => {
  try {
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Follow-up deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
