const express = require('express');
const { Conversation, Message } = require('../models/Conversation');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');
const messenger = require('../services/messenger');
const nodemailer = require('nodemailer');

const router = express.Router();

// GET /api/conversations
router.get('/', protect, async (req, res) => {
  try {
    const { platform, status, search, unread, page = 1, limit = 30 } = req.query;
    
    console.log(`🔍 SERVER LOG | GET /api/conversations | Query:`, req.query);
    let filter = {};
    if (platform && platform !== 'all') filter.platform = platform;
    if (status) {
       filter.status = status;
    } else {
       // Hide archived by default
       filter.status = { $ne: 'archived' };
    }

    if (unread === 'true') {
       filter.unreadCount = { $gt: 0 };
    }

    if (search) {
       const clients = await Client.find({
          $or: [
             { fullName: { $regex: search, $options: 'i' } },
             { email: { $regex: search, $options: 'i' } },
             { phone: { $regex: search, $options: 'i' } }
          ]
       }).select('_id');
       const clientIds = clients.map(c => c._id);
       
       filter.$or = [
          { client: { $in: clientIds } },
          { lastMessage: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } }
       ];
    }

    const conversations = await Conversation.find(filter)
      .populate('client', 'fullName phone email source')
      .populate('assignedTo', 'name')
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Conversation.countDocuments(filter);
    res.json({ success: true, conversations, total });
  } catch (err) {
    console.error('Fetch Conversations Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/conversations
router.post('/', protect, async (req, res) => {
  try {
    const conv = await Conversation.create(req.body);
    const populated = await conv.populate('client', 'fullName phone email');
    res.status(201).json({ success: true, conversation: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/conversations/:id/messages
router.get('/:id/messages', protect, async (req, res) => {
  try {
    const messages = await Message.find({ conversationId: req.params.id })
      .populate('sentBy', 'name')
      .sort({ createdAt: 1 });
    // Mark messages as read
    await Message.updateMany({ conversationId: req.params.id, read: false, sender: 'client' }, { read: true });
    await Conversation.findByIdAndUpdate(req.params.id, { unreadCount: 0 });
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/conversations/:id/messages (AGENT SENDING MESSAGE)
router.post('/:id/messages', protect, async (req, res) => {
  try {
    let { content, messageType = 'text' } = req.body;
    const conv = await Conversation.findById(req.params.id).populate('client');
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });

    // 1. External Relay (Send to actual WhatsApp/Facebook)
    if (conv.platform === 'whatsapp' && conv.client?.phone) {
       if (process.env.MOCK_META_SEND === 'true') {
          console.log(`[MOCK SEND] Simulating WhatsApp send to ${conv.client.phone}: "${content}"`);
       } else {
          await messenger.sendWhatsAppMessage(conv.client.phone, content);
          console.log(`✅ WhatsApp outbound message sent to ${conv.client.phone}`);
       }
    } else if (conv.platform === 'facebook' || conv.platform === 'instagram') {
       const recipientId = conv.platformContactId || conv.client?.platformContactId;
       if (process.env.MOCK_META_SEND === 'true') {
          console.log(`[MOCK SEND] Simulating ${conv.platform} send to ${recipientId}: "${content}"`);
        } else if (recipientId && !recipientId.includes('user_')) {
          const imageUrl = req.body.imageUrl || (req.body.attachments && req.body.attachments[0]?.url);
          let localFilePath = null;
          
          if (imageUrl && imageUrl.includes('/uploads/')) {
            const filename = imageUrl.split('/uploads/').pop();
            const path = require('path');
            localFilePath = path.join(__dirname, '..', '..', 'uploads', filename);
          }

          try {
            await messenger.sendFacebookMessage(recipientId, content, imageUrl, localFilePath);
            console.log(`✅ ${conv.platform} outbound message relay successful for ${recipientId}`);
          } catch (fbErr) {
            const errString = fbErr.message || '';
            const is24h = errString.includes('outside of allowed window') || errString.includes('24 hour') || errString.includes('24-hour') || errString.includes('131047');
            
            if (is24h && conv.client?.email) {
              console.log('⚠️ 24h window closed. Falling back to email for Meta lead...');
              
              const transporter = nodemailer.createTransport({
                 host: process.env.SMTP_HOST || 'smtp.gmail.com',
                 port: Number(process.env.SMTP_PORT) || 587,
                 secure: false,
                 auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                 tls: { rejectUnauthorized: false }
              });
              
              await transporter.sendMail({
                 from: `"Manpreet Singh" <${process.env.SMTP_USER}>`,
                 to: conv.client.email,
                 subject: `Following up on your inquiry`,
                 text: content
              });
              
              // Append a note so the agent knows how it was delivered
              content = `[Delivered via Email: Facebook 24h window closed]\n\n` + content;
            } else if (is24h) {
              console.warn('⚠️ 24h window closed and no email. Saving as internal note only.');
              content = `[Not Delivered to FB: 24h window closed]\n\n` + content;
            } else {
              throw fbErr; // Different error, rethrow to show popup
            }
          }
       } else {
          console.warn(`⚠️ Cannot relay to ${conv.platform}: ${!recipientId ? 'Missing ID' : 'Simulated/Invalid ID (' + recipientId + ')'}`);
          // We still allow it to be saved internally as a log
       }
    } else if (conv.platform === 'email' && conv.client?.email) {

       // === EMAIL RELAY FOR INBOX REPLIES ===
       const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(process.env.SMTP_PORT) || 587,
          secure: false,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          tls: { rejectUnauthorized: false }
       });
       
       await transporter.sendMail({
          from: `"Manpreet Singh" <${process.env.SMTP_USER}>`,
          to: conv.client.email,
          subject: `Re: Follow-up regarding your inquiry`,
          text: content
       });
       console.log(`✅ Email outbound message sent to ${conv.client.email}`);
    }

    // 2. Save Internal Log
    const message = await Message.create({
      conversationId: req.params.id,
      sender: 'agent',
      content,
      messageType: req.body.messageType || 'text',
      attachments: req.body.attachments || [],
      sentBy: req.user._id,
    });

    await Conversation.findByIdAndUpdate(req.params.id, {
      lastMessage: content,
      lastMessageAt: new Date(),
    });

    const populated = await message.populate('sentBy', 'name');
    
    // 3. Emit via socket for real-time dashboard updates
    req.app.get('io')?.to(req.params.id).emit('new_message', populated);
    
    res.status(201).json({ success: true, message: populated });
  } catch (err) {
    const errorDetail = err.response?.data?.error?.message || err.message;
    console.error('❌ Message Relay Error:', errorDetail);
    
    // Check if it's a 24h window error
    const is24hError = errorDetail.includes('outside of allowed window') || 
                       errorDetail.includes('24 hour messaging window') || 
                       errorDetail.includes('24-hour') || 
                       errorDetail.includes('131047');
    if (is24hError) {
      return res.status(403).json({ 
        success: false, 
        message: 'Meta Policy: You can only reply within 24 hours of the customer\'s last message. To bypass this in the future, please apply for the "Human Agent" permission in your Meta Developer App Dashboard.' 
      });
    }

    res.status(400).json({ success: false, message: errorDetail });
  }
});

// PUT /api/conversations/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const conv = await Conversation.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('client', 'fullName phone email')
      .populate('assignedTo', 'name');
    res.json({ success: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/conversations/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const convId = req.params.id;
    // 1. Delete all messages first
    await Message.deleteMany({ conversationId: convId });
    // 2. Delete conversation
    await Conversation.findByIdAndDelete(convId);
    
    // 3. Emit deletion to UI
    req.app.get('io')?.emit('conversation_deleted', convId);
    
    res.json({ success: true, message: 'Conversation deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Proxy Media from Meta (to handle CORS and expired URLs)
router.get('/proxy-media', async (req, res) => {
  let { url } = req.query;
  if (!url) return res.status(400).send('URL is required');

  // Handle protocol-relative URLs
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }

  // Security check: Only proxy media from Meta/Facebook/Instagram domains to prevent open proxy abuse
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const isAllowedDomain = host.endsWith('fbcdn.net') || 
                            host.endsWith('facebook.com') || 
                            host.endsWith('instagram.com') || 
                            host.endsWith('whatsapp.net') ||
                            host.endsWith('cdninstagram.com') ||
                            host.endsWith('fbsbx.com');
    if (!isAllowedDomain) {
      return res.status(403).send('Access denied: Unauthorized proxy domain');
    }
  } catch (urlErr) {
    return res.status(400).send('Invalid URL format');
  }

  try {
    const axios = require('axios');
    const MessengerService = require('../services/messenger');
    
    // Dynamically get the latest valid Page Access Token
    const token = await MessengerService.getPageAccessToken();
    
    console.log(`📡 PROXY | Fetching: ${url.substring(0, 60)}...`);

    const response = await axios.get(url, {
      params: { access_token: token },
      responseType: 'stream',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    res.set('Content-Type', response.headers['content-type'] || 'audio/ogg');
    response.data.pipe(res);
  } catch (err) {
    console.error('❌ PROXY ERROR:', err.message);
    // Fallback: If it's a 404 or unauthorized, the URL is likely dead.
    res.status(404).send('Media not found or token expired');
  }
});

// POST /api/conversations/sync/facebook
router.post('/sync/facebook', protect, async (req, res) => {
  try {
    const count = await messenger.syncPlatform('facebook', req.app);
    res.json({ success: true, count, message: `Successfully synced ${count} new Facebook conversations.` });
  } catch (err) {
    console.error('Facebook Sync Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/conversations/sync/instagram
router.post('/sync/instagram', protect, async (req, res) => {
  try {
    const count = await messenger.syncPlatform('instagram', req.app);
    res.json({ success: true, count, message: `Successfully synced ${count} new Instagram conversations.` });
  } catch (err) {
    console.error('Instagram Sync Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;



