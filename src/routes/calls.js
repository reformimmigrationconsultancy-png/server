const express = require('express');
const Call = require('../models/Call');
const { protect } = require('../middleware/auth');

const router = express.Router();

// GET /api/calls
router.get('/', protect, async (req, res) => {
  try {
    const { clientId, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (clientId) filter.client = clientId;
    const calls = await Call.find(filter)
      .populate('client', 'fullName phone')
      .populate('loggedBy', 'name')
      .sort({ callTime: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Call.countDocuments(filter);
    res.json({ success: true, calls, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/calls
router.post('/', protect, async (req, res) => {
  try {
    const call = await Call.create({ ...req.body, loggedBy: req.user._id });
    const populated = await call.populate([
      { path: 'client', select: 'fullName phone' },
      { path: 'loggedBy', select: 'name' },
    ]);
    res.status(201).json({ success: true, call: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/calls/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const call = await Call.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, call });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/calls/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    await Call.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Call deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
