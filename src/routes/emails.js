const express = require('express');
const nodemailer = require('nodemailer');
const { Conversation, Message } = require('../models/Conversation');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Create a robust, pooled transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for port 465, false for 587 (STARTTLS)
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  auth: { 
    user: process.env.SMTP_USER, 
    pass: process.env.SMTP_PASS 
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

// POST /api/emails/send
router.post('/send', protect, async (req, res) => {
  try {
    const { clientId, to, subject, body, conversationId, templateKey } = req.body;

    let finalSubject = subject;
    let finalBody = body;

    // Fetch client for template variables
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    if (templateKey && TEMPLATES[templateKey]) {
      const name = client ? client.fullName : 'Valued Customer';
      finalSubject = finalSubject || TEMPLATES[templateKey].subject;
      finalBody = finalBody || TEMPLATES[templateKey].body.replace('{{name}}', name);
    }

    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"Lead CRM" <${process.env.SMTP_USER}>`,
      to,
      subject: finalSubject,
      text: finalBody,
    });

    // 1. Ensure Conversation exists for logging
    let activeConvId = conversationId;
    if (!activeConvId) {
      let conv = await Conversation.findOne({ client: clientId, platform: 'email' });
      if (!conv) {
        conv = await Conversation.create({
           client: clientId,
           platform: 'email',
           lastMessage: finalBody.substring(0, 50),
           lastMessageAt: new Date()
        });
      }
      activeConvId = conv._id;
    }

    // 2. Log as message in conversation history
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


module.exports = router;
