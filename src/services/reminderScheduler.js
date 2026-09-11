const Reminder = require('../models/Reminder');
const Notification = require('../models/Notification');
const Client = require('../models/Client');

/**
 * Server-Side Persistent Reminder Scheduler
 * Runs periodically to evaluate upcoming, due-now, and overdue follow-up reminders.
 * Idempotently creates Notifications and broadcasts real-time Socket.io events.
 */

let appInstance = null;

const processReminders = async () => {
  try {
    const now = new Date();
    const io = appInstance ? appInstance.get('io') : null;

    // ------------------------------------------------------------------
    // 1. PROCESS UPCOMING REMINDERS (e.g. 30m / 10m before due date)
    // ------------------------------------------------------------------
    const upcomingReminders = await Reminder.find({
      isCompleted: false,
      status: { $nin: ['completed', 'cancelled'] },
      reminderSent: false,
      reminderTime: { $lte: now },
      $or: [
        { snoozedUntil: { $exists: false } },
        { snoozedUntil: null },
        { snoozedUntil: { $lte: now } }
      ]
    }).populate('client').populate('assignedTo');

    for (const item of upcomingReminders) {
      const lead = item.client;
      const userId = item.assignedTo?._id || item.assignedTo;
      if (!userId) continue;

      const leadName = lead?.fullName || lead?.name || 'Client';
      const timeRemaining = Math.max(0, Math.round((new Date(item.dueDate) - now) / 60000));
      const timeStr = timeRemaining > 0 ? `Due in ${timeRemaining} min` : 'Due soon';

      const idempotencyKey = `upcoming_${item._id}_${item.reminderTime ? new Date(item.reminderTime).getTime() : Date.now()}`;

      try {
        const notif = await Notification.create({
          userId,
          type: 'followup',
          title: `🔔 Upcoming Follow-up: ${item.title}`,
          message: `${item.title} for ${leadName} (${timeStr})`,
          priority: 'medium',
          entityType: 'reminder',
          entityId: item._id,
          leadName,
          leadEmail: lead?.email,
          leadPhone: lead?.phone,
          idempotencyKey
        });

        // Mark as sent
        item.reminderSent = true;
        await item.save();

        // Broadcast to user via Socket.io
        if (io) {
          io.emit('new_notification', notif);
          io.emit('due_reminder', {
            type: 'upcoming',
            notification: notif,
            reminder: item,
            lead
          });
        }
      } catch (dupErr) {
        // Idempotency duplicate key error - mark sent to prevent tight loop
        if (dupErr.code === 11000) {
          item.reminderSent = true;
          await item.save();
        }
      }
    }

    // ------------------------------------------------------------------
    // 2. PROCESS DUE NOW REMINDERS (Exact Due Time Reached)
    // ------------------------------------------------------------------
    const dueNowReminders = await Reminder.find({
      isCompleted: false,
      status: { $nin: ['completed', 'cancelled'] },
      dueNowSent: false,
      dueDate: { $lte: now },
      $or: [
        { snoozedUntil: { $exists: false } },
        { snoozedUntil: null },
        { snoozedUntil: { $lte: now } }
      ]
    }).populate('client').populate('assignedTo');

    for (const item of dueNowReminders) {
      const lead = item.client;
      const userId = item.assignedTo?._id || item.assignedTo;
      if (!userId) continue;

      const leadName = lead?.fullName || lead?.name || 'Client';
      const idempotencyKey = `duenow_${item._id}_${new Date(item.dueDate).getTime()}`;

      try {
        const notif = await Notification.create({
          userId,
          type: 'followup',
          title: `🔴 Follow-up Due Now: ${item.title}`,
          message: `${item.title} for ${leadName} is due now!`,
          priority: 'high',
          entityType: 'reminder',
          entityId: item._id,
          leadName,
          leadEmail: lead?.email,
          leadPhone: lead?.phone,
          idempotencyKey
        });

        item.dueNowSent = true;
        await item.save();

        if (io) {
          io.emit('new_notification', notif);
          io.emit('due_reminder', {
            type: 'duenow',
            notification: notif,
            reminder: item,
            lead
          });
        }
      } catch (dupErr) {
        if (dupErr.code === 11000) {
          item.dueNowSent = true;
          await item.save();
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. PROCESS OVERDUE REMINDERS (15+ Minutes Past Due Time & Incomplete)
    // ------------------------------------------------------------------
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const overdueReminders = await Reminder.find({
      isCompleted: false,
      status: { $nin: ['completed', 'cancelled'] },
      overdueSent: false,
      dueDate: { $lte: fifteenMinsAgo },
      $or: [
        { snoozedUntil: { $exists: false } },
        { snoozedUntil: null },
        { snoozedUntil: { $lte: now } }
      ]
    }).populate('client').populate('assignedTo');

    for (const item of overdueReminders) {
      const lead = item.client;
      const userId = item.assignedTo?._id || item.assignedTo;
      if (!userId) continue;

      const leadName = lead?.fullName || lead?.name || 'Client';
      const overdueMins = Math.round((now - new Date(item.dueDate)) / 60000);
      const idempotencyKey = `overdue_${item._id}_${new Date(item.dueDate).getTime()}`;

      try {
        const notif = await Notification.create({
          userId,
          type: 'followup',
          title: `⚠️ Follow-up Overdue: ${item.title}`,
          message: `${item.title} for ${leadName} is ${overdueMins} min overdue!`,
          priority: 'critical',
          entityType: 'reminder',
          entityId: item._id,
          leadName,
          leadEmail: lead?.email,
          leadPhone: lead?.phone,
          idempotencyKey
        });

        item.overdueSent = true;
        await item.save();

        if (io) {
          io.emit('new_notification', notif);
          io.emit('due_reminder', {
            type: 'overdue',
            notification: notif,
            reminder: item,
            lead
          });
        }
      } catch (dupErr) {
        if (dupErr.code === 11000) {
          item.overdueSent = true;
          await item.save();
        }
      }
    }

  } catch (err) {
    console.error('❌ [Reminder Scheduler] Error processing reminders:', err.message);
  }
};

const startScheduler = (app) => {
  appInstance = app;
  console.log('⏰ [Reminder Scheduler] Starting persistent 1-minute server-side reminder scheduler...');
  
  // Run every 1 minute (60,000 ms)
  setInterval(processReminders, 60 * 1000);

  // Initial check on server boot after 3 seconds
  setTimeout(processReminders, 3000);
};

module.exports = {
  startScheduler,
  processReminders
};
