const mongoose = require('mongoose');
const Client = require('../src/models/Client');
const WebhookLog = require('../src/models/WebhookLog');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function removeDummyLeads() {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB successfully.');

    // 1. Identify mock leads
    const query = {
      $or: [
        { fullName: 'Navdeep Singh Dhillon' },
        { email: /@example\.com$/i },
        { externalId: /^leadgen_mock_/i },
        { externalId: /^mock_/i }
      ]
    };

    const mockClients = await Client.find(query);
    console.log(`\n🔍 Found ${mockClients.length} dummy/mock leads in CRM database.`);

    if (mockClients.length > 0) {
      mockClients.forEach(c => {
        console.log(`- Removing: "${c.fullName}" | Email: ${c.email} | ID: ${c._id}`);
      });

      // Delete the mock clients
      const clientDeleteResult = await Client.deleteMany(query);
      console.log(`\n🗑️ Successfully deleted ${clientDeleteResult.deletedCount} dummy leads from CRM database.`);
    } else {
      console.log('ℹ️ No dummy leads found. Database is already clean.');
    }

    // 2. Also clean any mock webhook logs
    const webhookQuery = {
      $or: [
        { eventId: /^leadgen_mock_/i },
        { 'payload.leadgen_id': /^mock_/i }
      ]
    };
    const logDeleteResult = await WebhookLog.deleteMany(webhookQuery);
    if (logDeleteResult.deletedCount > 0) {
      console.log(`🗑️ Successfully cleared ${logDeleteResult.deletedCount} mock webhook event logs.`);
    }

    console.log('\n✨ Database cleanup complete! Only original real leads are remaining.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during cleanup:', err.message);
    process.exit(1);
  }
}

removeDummyLeads();
