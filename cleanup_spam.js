const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Client = require('./src/models/Client');
const { Conversation, Message } = require('./src/models/Conversation');

dotenv.config();

const cleanSpam = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lead_crm', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('🔗 Connected to DB to clean spam...');

    const noReplyKeywords = ['no-reply', 'noreply', 'donotreply', 'updates', 'alerts', 'marketing', 'newsletter'];
    const spamDomains = ['linkedin.com', 'simplilearnmailer', 'foundit', 'bayt.com', 'unstop.com', 'naukri.com', 'mailer'];

    // Find spam clients
    const clients = await Client.find({});
    let spamClientIds = [];

    for (let c of clients) {
      if (!c.email) continue;
      const email = c.email.toLowerCase();

      const isSpam = noReplyKeywords.some(kw => email.includes(kw)) || spamDomains.some(dom => email.includes(dom));
      if (isSpam) {
        spamClientIds.push(c._id);
      }
    }

    console.log(`🧹 Found ${spamClientIds.length} spam/promotional clients to remove.`);

    if (spamClientIds.length > 0) {
      // Find conversations for these clients
      const conversations = await Conversation.find({ client: { $in: spamClientIds } });
      const convIds = conversations.map(c => c._id);

      // Delete messages
      if (convIds.length > 0) {
        await Message.deleteMany({ conversationId: { $in: convIds } });
        console.log(`🗑️ Deleted messages from ${convIds.length} spam conversations.`);
      }

      // Delete conversations
      await Conversation.deleteMany({ _id: { $in: convIds } });
      console.log('🗑️ Deleted spam conversations.');

      // Delete clients
      await Client.deleteMany({ _id: { $in: spamClientIds } });
      console.log('🗑️ Deleted spam clients.');
    }

    console.log('✅ Spam cleanup complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

cleanSpam();
