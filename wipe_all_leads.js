const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Client = require('./src/models/Client');
const { Conversation, Message } = require('./src/models/Conversation');
const WebhookLog = require('./src/models/WebhookLog');

async function wipeAll() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('❌ MONGO_URI not found in .env');
      process.exit(1);
    }

    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB.');

    const clientCount = await Client.countDocuments();
    const convCount = await Conversation.countDocuments();
    const msgCount = await Message.countDocuments();
    const logCount = await WebhookLog.countDocuments();

    console.log(`📊 Current DB Stats before wipe:`);
    console.log(`  - Clients: ${clientCount}`);
    console.log(`  - Conversations: ${convCount}`);
    console.log(`  - Messages: ${msgCount}`);
    console.log(`  - Webhook Logs: ${logCount}`);

    console.log('\n🧹 Wiping all old leads, conversations, messages, and webhook logs...');

    await Message.deleteMany({});
    await Conversation.deleteMany({});
    await Client.deleteMany({});
    await WebhookLog.deleteMany({});

    console.log('✨ All old leads, messages, conversations, and logs have been completely DELETED!');
    console.log('🎉 Your CRM is now completely brand new and fresh!');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error during database wipe:', err);
    process.exit(1);
  }
}

wipeAll();
