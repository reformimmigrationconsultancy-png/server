const express = require('express');
const { Conversation, Message } = require('../models/Conversation');
const { protect } = require('../middleware/auth');
const messenger = require('../services/messenger');

const router = express.Router();

/**
 * @route   GET /api/messages
 * @desc    Get all messages across all conversations
 * @access  Private
 */
router.get('/messages', protect, async (req, res) => {
  try {
    const messages = await Message.find()
      .populate({
        path: 'conversationId',
        populate: { path: 'client' }
      })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @route   GET /api/messages/:senderId
 * @desc    Get conversation thread by senderId (platformContactId)
 * @access  Private
 */
router.get('/messages/:senderId', protect, async (req, res) => {
  try {
    const { senderId } = req.params;
    
    // Find conversation by platformContactId
    const conversation = await Conversation.findOne({ platformContactId: senderId })
      .populate('client');
    
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found for this sender' });
    }

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 });

    res.json({ success: true, messages, conversation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * @route   POST /api/send-message
 * @desc    Send a message to a Facebook user
 * @access  Private
 */
router.post('/send-message', protect, async (req, res) => {
  try {
    const { senderId, message } = req.body;

    if (!senderId || !message) {
      return res.status(400).json({ success: false, message: 'senderId and message are required' });
    }

    console.log(`📤 Sending FB Message to ${senderId}: ${message}`);

    // 1. Send via Facebook API
    const fbResponse = await messenger.sendFacebookMessage(senderId, message);

    // 2. Find or create conversation to log the message
    let conv = await Conversation.findOne({ platformContactId: senderId, platform: 'facebook' });
    if (!conv) {
       const Client = require('../models/Client');
       let client = await Client.findOne({ platformContactId: senderId });
       if (!client) {
          client = await Client.create({
             fullName: `Facebook User ${senderId.substring(0, 5)}`,
             platformContactId: senderId,
             source: 'facebook'
          });
       }
       conv = await Conversation.create({
          client: client._id,
          platform: 'facebook',
          platformContactId: senderId,
          lastMessage: message,
          lastMessageAt: new Date()
       });
    }

    // 3. Save internal log
    const newMessage = await Message.create({
      conversationId: conv._id,
      sender: 'agent',
      content: message,
      sentBy: req.user._id,
    });

    // 4. Update conversation
    await Conversation.findByIdAndUpdate(conv._id, {
      lastMessage: message,
      lastMessageAt: new Date(),
    });

    // 5. Emit via socket
    const io = req.app.get('io');
    io?.emit('new_message', newMessage); // Global
    io?.to(conv._id.toString()).emit('new_message', newMessage); // Room

    res.json({ success: true, message: newMessage, fbResponse });
  } catch (err) {
    console.error('❌ Send Message Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
