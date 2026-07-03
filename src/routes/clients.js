const express = require('express');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Setup multer for document uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = `uploads/documents/${req.params.id}`;
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

let lastLeadSyncTime = 0;
const SYNC_COOLDOWN = 2 * 60 * 1000; // 2 minutes

function triggerBackgroundLeadSync(app) {
  const now = Date.now();
  if (now - lastLeadSyncTime < SYNC_COOLDOWN) {
    return;
  }
  lastLeadSyncTime = now;

  console.log('🔄 [Auto-Sync] Triggering background Meta Lead Sync on clients request...');
  const messenger = require('../services/messenger');
  messenger.syncHistoricalLeads(app)
    .then(count => {
      if (count > 0) {
        console.log(`✅ [Auto-Sync] Background Meta Lead Sync finished. Synced ${count} new leads.`);
      }
    })
    .catch(err => {
      console.error('❌ [Auto-Sync] Background Meta Lead Sync failed:', err.message);
    });
}

// GET /api/clients
router.get('/', protect, async (req, res) => {
  try {
    // Trigger background sync in a non-blocking way
    triggerBackgroundLeadSync(req.app);

    const { stage, source, search, page = 1, limit = 20 } = req.query;
    const filter = { isArchived: false };
    if (stage) filter.stage = stage;
    if (source) filter.source = source;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    const total = await Client.countDocuments(filter);
    const clients = await Client.find(filter)
      .populate('assignedTo', 'name email')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ success: true, clients, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/clients
router.post('/', protect, async (req, res) => {
  try {
    const client = await Client.create({ ...req.body });
    req.app.get('io')?.emit('new_lead', client);

    // Email notifications (both admin alert & client auto-responder) 
    // are now centrally handled by the Client model's post-save hook.

    res.status(201).json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/clients/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id)
      .populate('assignedTo', 'name email')
      .populate('notes.createdBy', 'name');
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/clients/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    req.app.get('io')?.emit('update_lead', client);
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/clients/:id (archive)
router.delete('/:id', protect, async (req, res) => {
  try {
    await Client.findByIdAndUpdate(req.params.id, { isArchived: true });
    res.json({ success: true, message: 'Client archived' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/clients/:id/notes
router.post('/:id/notes', protect, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    client.notes.push({ content: req.body.content, createdBy: req.user._id });
    await client.save();
    const updated = await Client.findById(req.params.id).populate('notes.createdBy', 'name');
    res.json({ success: true, notes: updated.notes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/clients/:id/documents
router.post('/:id/documents', protect, upload.single('file'), async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    client.documents.push({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
    await client.save();
    res.json({ success: true, documents: client.documents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/clients/sync-meta-leads
router.post('/sync-meta-leads', protect, async (req, res) => {
  try {
    const messenger = require('../services/messenger');
    const syncedCount = await messenger.syncHistoricalLeads();
    res.json({ success: true, count: syncedCount });
  } catch (err) {
    console.error('❌ Meta Sync Endpoint Error:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error during Meta Sync' });
  }
});

module.exports = router;
