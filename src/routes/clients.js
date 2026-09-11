const express = require('express');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { enrollLead } = require('../services/automationEngine');

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
    // Strictly restrict to Meta Lead Ads (Facebook & Instagram) and manual deals. Exclude direct message contacts completely.
    const filter = { 
      isArchived: { $ne: true }, 
      source: { $in: ['facebook', 'instagram', 'manual'] },
      platformContactId: { $exists: false }
    };
    if (stage) filter.stage = stage;
    if (source && ['facebook', 'instagram', 'manual'].includes(source)) filter.source = source;
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
    if (req.body.source === 'email') {
      return res.status(400).json({ success: false, message: 'Email leads are disabled. Only Ads are supported.' });
    }
    const client = await Client.create({ ...req.body });
    const io = req.app.get('io');
    if (io) {
      io.emit('new_lead', client);
      io.emit('new_client', client);
    }
    
    // Enroll in automation workflows
    await enrollLead(client);

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
    const io = req.app.get('io');
    if (io) {
      io.emit('update_lead', client);
      io.emit('update_client', client);
    }
    res.json({ success: true, client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/clients/:id (Permanent Delete with cascade cleanup)
router.delete('/:id', protect, async (req, res) => {
  try {
    const clientId = req.params.id;
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const { Conversation, Message } = require('../models/Conversation');
    const Reminder = require('../models/Reminder');
    const AutomationExecution = require('../models/AutomationExecution');

    // 1. Delete associated messages & conversations
    const conversations = await Conversation.find({ client: clientId });
    const convIds = conversations.map(c => c._id);
    if (convIds.length > 0) {
      await Message.deleteMany({ conversationId: { $in: convIds } });
      await Conversation.deleteMany({ _id: { $in: convIds } });
    }

    // 2. Delete associated follow-ups/reminders
    await Reminder.deleteMany({ client: clientId });

    // 3. Delete automation executions
    await AutomationExecution.deleteMany({ client: clientId });

    // 4. Delete the client record
    await Client.findByIdAndDelete(clientId);

    // Broadcast socket update
    const io = req.app.get('io');
    if (io) {
      io.emit('update_lead', null);
    }

    res.json({ success: true, message: `Lead '${client.fullName}' deleted successfully` });
  } catch (err) {
    console.error('❌ Lead delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/clients/bulk-delete (Bulk Delete multiple selected leads)
router.post('/bulk-delete', protect, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No lead IDs provided for deletion' });
    }

    const { Conversation, Message } = require('../models/Conversation');
    const Reminder = require('../models/Reminder');
    const AutomationExecution = require('../models/AutomationExecution');

    // 1. Delete conversations & messages
    const conversations = await Conversation.find({ client: { $in: ids } });
    const convIds = conversations.map(c => c._id);
    if (convIds.length > 0) {
      await Message.deleteMany({ conversationId: { $in: convIds } });
      await Conversation.deleteMany({ _id: { $in: convIds } });
    }

    // 2. Delete follow-ups & automation executions
    await Reminder.deleteMany({ client: { $in: ids } });
    await AutomationExecution.deleteMany({ client: { $in: ids } });

    // 3. Delete clients
    const result = await Client.deleteMany({ _id: { $in: ids } });

    // Broadcast socket update
    const io = req.app.get('io');
    if (io) {
      io.emit('update_lead', null);
    }

    res.json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} selected lead(s)`,
      count: result.deletedCount
    });
  } catch (err) {
    console.error('❌ Bulk lead delete error:', err.message);
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
    const syncedCount = await messenger.syncHistoricalLeads(req.app);
    res.json({ success: true, count: syncedCount });
  } catch (err) {
    console.error('❌ Meta Sync Endpoint Error:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error during Meta Sync' });
  }
});

// POST /api/clients/clear-all-leads (Wipes all old leads, conversations, messages, and logs)
router.post('/clear-all-leads', protect, async (req, res) => {
  try {
    const { Conversation, Message } = require('../models/Conversation');
    const WebhookLog = require('../models/WebhookLog');

    const clientCount = await Client.countDocuments();
    
    // 1. Delete all messages
    await Message.deleteMany({});
    // 2. Delete all conversations
    await Conversation.deleteMany({});
    // 3. Delete all clients
    await Client.deleteMany({});
    // 4. Clear webhook logs
    await WebhookLog.deleteMany({});

    console.log(`🧹 [Pipeline Reset] Wiped ${clientCount} old leads, conversations, and webhook logs.`);

    // Broadcast clear event via socket.io
    const io = req.app.get('io');
    if (io) {
      io.emit('new_lead', null);
      io.emit('new_client', null);
      io.emit('update_lead', null);
    }

    res.json({
      success: true,
      message: `Successfully wiped ${clientCount} old leads and conversations. Your CRM is now brand new and fresh!`,
      deletedCount: clientCount
    });
  } catch (err) {
    console.error('❌ Error clearing all leads:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
