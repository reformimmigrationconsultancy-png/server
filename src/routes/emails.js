const express = require('express');
const nodemailer = require('nodemailer');
const { Conversation, Message } = require('../models/Conversation');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Create a robust, pooled transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  auth: { 
    user: process.env.SMTP_USER || process.env.IMAP_USER || 'mortgagewithmanpreet@gmail.com', 
    pass: process.env.SMTP_PASS || process.env.IMAP_PASS || 'swnamaxjdsfsygkz' 
  },
  tls: {
    // Force modern TLS configurations
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2'
  },
  connectionTimeout: 30000,
  socketTimeout: 30000
});

const getTransporter = () => transporter;

// Email templates
const TEMPLATES = {
  mortgage_info: {
    subject: 'Your Mortgage Enquiry – Information & Next Steps',
    body: `Dear {{name}},\n\nThank you for your enquiry about mortgage options. We are here to help you find the best solution.\n\nPlease feel free to reach out with any questions.\n\nBest regards,\nYour Mortgage Broker Team`,
  },
  follow_up: {
    subject: 'Following Up on Your Mortgage Application',
    body: `Dear {{name}},\n\nI wanted to follow up on our recent conversation regarding your mortgage application.\n\nIf you have any questions or need any additional information, please don't hesitate to contact us.\n\nBest regards,\nYour Mortgage Broker Team`,
  },
  documents_request: {
    subject: 'Documents Required for Your Mortgage Application',
    body: `Dear {{name}},\n\nTo proceed with your mortgage application, we require the following documents:\n- Proof of identity (Passport/Driving License)\n- Last 3 months payslips\n- Last 3 months bank statements\n- Proof of address\n\nPlease send these at your earliest convenience.\n\nBest regards,\nYour Mortgage Broker Team`,
  },
  approval: {
    subject: 'Great News – Your Mortgage Has Been Approved!',
    body: `Dear {{name}},\n\nWe are delighted to inform you that your mortgage application has been approved!\n\nWe will be in touch shortly with the next steps.\n\nBest regards,\nYour Mortgage Broker Team`,
  },
};

// GET /api/emails/templates
router.get('/templates', protect, (req, res) => {
  res.json({ success: true, templates: Object.keys(TEMPLATES).map(key => ({ key, ...TEMPLATES[key] })) });
});

// GET /api/emails/all
router.get('/all', protect, async (req, res) => {
  try {
    const messages = await Message.find({ messageType: 'email' })
      .populate({
        path: 'conversationId',
        populate: { path: 'client' }
      })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/emails/send
router.post('/send', protect, async (req, res) => {
  try {
    const { clientId, to, subject, body, conversationId, templateKey } = req.body;

    let finalSubject = subject;
    let finalBody = body;

    // Fetch client for template variables
    let client;
    if (clientId) {
      client = await Client.findById(clientId);
    } else if (to) {
      client = await Client.findOne({ email: to.toLowerCase() });
    }

    if (!client && !to) {
      return res.status(400).json({ success: false, message: 'Recipient email or Client ID is required' });
    }

    const recipientEmail = to || client?.email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: 'Recipient email not found' });
    }

    if (templateKey && TEMPLATES[templateKey]) {
      finalSubject = finalSubject || TEMPLATES[templateKey].subject;
      finalBody = finalBody || TEMPLATES[templateKey].body;
    }

    // Replace all template variables if client exists
    if (client) {
      const clientFullName = client.fullName || 'Valued Customer';
      const firstName = clientFullName.split(' ')[0] || 'there';
      const lastName = clientFullName.split(' ').slice(1).join(' ') || '';
      
      const replaceVars = (txt) => {
        if (!txt) return '';
        return txt
          .replace(/\{\{fullName\}\}/g, clientFullName)
          .replace(/\{\{full_name\}\}/g, clientFullName)
          .replace(/\{\{name\}\}/g, clientFullName)
          .replace(/\{\{firstName\}\}/g, firstName)
          .replace(/\{\{first_name\}\}/g, firstName)
          .replace(/\{\{lastName\}\}/g, lastName)
          .replace(/\{\{last_name\}\}/g, lastName)
          .replace(/\{\{email\}\}/g, client.email || '')
          .replace(/\{\{phone\}\}/g, client.phone || '')
          .replace(/\{\{source\}\}/g, client.source || '')
          .replace(/\{\{stage\}\}/g, client.stage || '');
      };

      finalSubject = replaceVars(finalSubject);
      finalBody = replaceVars(finalBody);
    }

    // Use PHP Mailer if configured
    if (process.env.PHP_MAILER_URL) {
      console.log(`📡 Sending outbound email via PHP Mailer to ${recipientEmail}...`);
      const axios = require('axios');
      const response = await axios.post(process.env.PHP_MAILER_URL, {
        to: recipientEmail,
        subject: finalSubject,
        html: finalBody.replace(/\n/g, '<br>'),
        text: finalBody,
        from: process.env.SMTP_USER || process.env.IMAP_USER || 'mortgagewithmanpreet@gmail.com',
        fromName: 'Lead CRM'
      });
      
      if (!response.data || !response.data.success) {
         console.error('❌ PHP Mailer failed:', response.data);
         throw new Error('PHP Mailer failed to send email');
      }
    } else {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: `"Lead CRM" <${process.env.SMTP_USER || process.env.IMAP_USER || 'mortgagewithmanpreet@gmail.com'}>`,
        to: recipientEmail,
        subject: finalSubject,
        text: finalBody,
      });
    }

    // 1. Ensure Client exists (create if missing)
    if (!client) {
      client = await Client.create({
        fullName: recipientEmail.split('@')[0],
        email: recipientEmail,
        source: 'manual',
        stage: 'contacted'
      });
    }

    // 2. Ensure Conversation exists for logging
    let activeConvId = conversationId;
    if (!activeConvId) {
      let conv = await Conversation.findOne({ client: client._id, platform: 'email' });
      if (!conv) {
        conv = await Conversation.create({
           client: client._id,
           platform: 'email',
           lastMessage: finalBody.substring(0, 50),
           lastMessageAt: new Date()
        });
      }
      activeConvId = conv._id;
    }

    // 3. Log as message in conversation history
    const msg = await Message.create({
      conversationId: activeConvId,
      sender: 'agent',
      content: `[SUBJECT: ${finalSubject}]\n\n${finalBody}`,
      messageType: 'email',
      sentBy: req.user._id,
    });

    await Conversation.findByIdAndUpdate(activeConvId, {
      lastMessage: finalBody.substring(0, 100),
      lastMessageAt: new Date(),
    });

    // 3. Emit real-time update to UI
    req.app.get('io')?.to(activeConvId.toString()).emit('new_message', msg);

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (err) {
    console.error('❌ Email Outbound Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/emails/sync
router.get('/sync', protect, async (req, res) => {
  try {
    const EmailSyncService = require('../services/emailSync');
    // Instead of instantiating anew, it's better to just call sync on a temporary instance 
    // or trigger a background sync.
    const tempSync = new EmailSyncService(req.app);
    // Don't await the whole sync if it takes too long, but we can await it for immediate feedback.
    await tempSync.sync();
    
    // After sync, return the latest emails
    const messages = await Message.find({ messageType: 'email' })
      .populate({
        path: 'conversationId',
        populate: { path: 'client' }
      })
      .sort({ createdAt: -1 })
      .limit(200);
      
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/emails/read/:id
router.put('/read/:id', protect, async (req, res) => {
  try {
    const msgId = req.params.id;
    const msg = await Message.findByIdAndUpdate(msgId, { read: true }, { new: true });
    
    // Also update conversation unreadCount if needed
    if (msg && msg.conversationId) {
       const conv = await Conversation.findById(msg.conversationId);
       if (conv && conv.unreadCount > 0) {
         conv.unreadCount -= 1;
         await conv.save();
       }
    }

    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/emails/trash/:id
router.put('/trash/:id', protect, async (req, res) => {
  try {
    const msgId = req.params.id;
    const msg = await Message.findByIdAndUpdate(msgId, { isTrash: true }, { new: true });
    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/emails/untrash/:id
router.put('/untrash/:id', protect, async (req, res) => {
  try {
    const msgId = req.params.id;
    const msg = await Message.findByIdAndUpdate(msgId, { isTrash: false }, { new: true });
    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/emails/:id (Permanent Delete)
router.delete('/:id', protect, async (req, res) => {
  try {
    const msgId = req.params.id;
    await Message.findByIdAndDelete(msgId);
    res.json({ success: true, message: 'Email deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Check live server environment variables
router.get('/test-config', (req, res) => {
  res.json({
    hasSmtpUser: !!process.env.SMTP_USER,
    hasSmtpPass: !!process.env.SMTP_PASS,
    hasImapUser: !!process.env.IMAP_USER,
    hasImapPass: !!process.env.IMAP_PASS,
    smtpUserValue: process.env.SMTP_USER ? process.env.SMTP_USER.substring(0, 3) + '***' : null,
    imapUserValue: process.env.IMAP_USER ? process.env.IMAP_USER.substring(0, 3) + '***' : null,
  });
});

module.exports = router;
