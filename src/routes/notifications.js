const express = require('express');
const router = express.Router();
const { protect: auth } = require('../middleware/auth');
const Notification = require('../models/Notification');

// GET /api/notifications - List notifications for logged-in user with filters & unread count
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    const { type = 'all', page = 1, limit = 30 } = req.query;

    const filter = { userId, dismissedAt: null };
    if (type !== 'all') {
      filter.type = type;
    }

    const totalUnread = await Notification.countDocuments({ userId, readAt: null, dismissedAt: null });

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({
      success: true,
      unreadCount: totalUnread,
      notifications,
      page: Number(page)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/:id/read - Mark single notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const unreadCount = await Notification.countDocuments({ userId, readAt: null, dismissedAt: null });
    res.json({ success: true, notification, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/read-all - Mark all notifications as read for current user
router.put('/read-all', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    await Notification.updateMany(
      { userId, readAt: null },
      { $set: { readAt: new Date() } }
    );

    res.json({ success: true, message: 'All notifications marked as read', unreadCount: 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/notifications/:id - Dismiss notification
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user._id || req.user.userId;
    await Notification.findOneAndUpdate(
      { _id: req.params.id, userId },
      { dismissedAt: new Date() }
    );

    const unreadCount = await Notification.countDocuments({ userId, readAt: null, dismissedAt: null });
    res.json({ success: true, message: 'Notification dismissed', unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
