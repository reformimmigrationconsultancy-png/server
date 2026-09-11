const express = require('express');
const Client = require('../models/Client');
const Call = require('../models/Call');
const { Conversation } = require('../models/Conversation');
const { protect } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', protect, async (req, res) => {
  try {
    const Reminder = require('../models/Reminder');
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [
      totalLeads,
      newLeads,
      contacted,
      interested,
      docsReceived,
      approved,
      closed,
      bySource,
      recentCalls,
      openConversations,
      overdueFollowUps,
      dueTodayFollowUps,
    ] = await Promise.all([
      Client.countDocuments({ isArchived: false }),
      Client.countDocuments({ isArchived: false, stage: 'new_lead' }),
      Client.countDocuments({ isArchived: false, stage: 'contacted' }),
      Client.countDocuments({ isArchived: false, stage: 'interested' }),
      Client.countDocuments({ isArchived: false, stage: 'documents_received' }),
      Client.countDocuments({ isArchived: false, stage: 'approved' }),
      Client.countDocuments({ isArchived: false, stage: 'closed' }),
      Client.aggregate([
        { $match: { isArchived: false } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
      Call.find({}).populate('client', 'fullName').sort({ callTime: -1 }).limit(5),
      Conversation.countDocuments({ status: 'open' }),
      Reminder.countDocuments({
        isCompleted: false,
        status: { $ne: 'completed' },
        dueDate: { $lt: startOfToday },
        $or: [{ snoozedUntil: { $exists: false } }, { snoozedUntil: null }, { snoozedUntil: { $lte: now } }]
      }),
      Reminder.countDocuments({
        isCompleted: false,
        status: { $ne: 'completed' },
        dueDate: { $gte: startOfToday, $lte: endOfToday }
      })
    ]);

    const conversionRate = totalLeads > 0 ? ((closed / totalLeads) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      stats: {
        totalLeads,
        activeLeads: totalLeads - closed,
        closedDeals: closed,
        conversionRate: parseFloat(conversionRate),
        pipeline: { newLeads, contacted, interested, docsReceived, approved, closed },
        bySource,
        recentCalls,
        openConversations,
        overdueFollowUps,
        dueTodayFollowUps,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
