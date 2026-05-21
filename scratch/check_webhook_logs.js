const mongoose = require('mongoose');
const WebhookLog = require('../src/models/WebhookLog');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function checkLogs() {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const totalLogs = await WebhookLog.countDocuments({});
    console.log(`📊 Total Webhook Logs: ${totalLogs}`);

    const failedLogs = await WebhookLog.find({ status: 'failed' }).sort({ createdAt: -1 }).limit(10);
    console.log(`❌ Failed Webhook Logs (Last 10): ${failedLogs.length}`);
    failedLogs.forEach((log, idx) => {
      console.log(`\n[Failed #${idx + 1}] Event ID: ${log.eventId}, Type: ${log.eventType}, Platform: ${log.platform}`);
      console.log(`Error: ${log.errorMessage}`);
      console.log(`Payload:`, JSON.stringify(log.payload, null, 2));
    });

    const recentLogs = await WebhookLog.find({}).sort({ createdAt: -1 }).limit(10);
    console.log(`\n📡 Recent Webhook Logs (Last 10):`);
    recentLogs.forEach((log, idx) => {
      console.log(`[Recent #${idx + 1}] Event ID: ${log.eventId}, Type: ${log.eventType}, Status: ${log.status}, Platform: ${log.platform}, Date: ${log.createdAt}`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error checking logs:', err.message);
  }
}

checkLogs();
