const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Conversation, Message } = require('./src/models/Conversation');
const Client = require('./src/models/Client');

dotenv.config();

const wipeAllEmails = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lead_crm', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('🔗 Connected to DB. Wiping ALL old email data...');

    // Find all email conversations
    const convs = await Conversation.find({ platform: 'email' });
    const convIds = convs.map(c => c._id);
    
    if (convIds.length > 0) {
        // Delete messages from these conversations
        await Message.deleteMany({ conversationId: { $in: convIds } });
        // Delete the conversations
        await Conversation.deleteMany({ _id: { $in: convIds } });
        console.log(`✅ Deleted ${convIds.length} old email conversations and their messages!`);
    } else {
        console.log(`⚠️ No email conversations found to delete.`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

wipeAllEmails();
