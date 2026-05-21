const mongoose = require('mongoose');
const Client = require('../src/models/Client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function cleanNonMeta() {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB successfully.');

    // Find leads whose source is NOT 'facebook' and NOT 'instagram'
    const query = {
      source: { $nin: ['facebook', 'instagram'] }
    };

    const targetLeads = await Client.find(query);
    console.log(`\n🔍 Found ${targetLeads.length} non-Meta leads (automated emails, website seed data, etc.).`);

    if (targetLeads.length > 0) {
      targetLeads.forEach((lead, i) => {
        console.log(`${i + 1}. Removing: "${lead.fullName}" | Source: [${lead.source}] | Email: ${lead.email}`);
      });

      const deleteResult = await Client.deleteMany(query);
      console.log(`\n🗑️ Successfully deleted all ${deleteResult.deletedCount} non-Meta leads from the CRM database!`);
    } else {
      console.log('\nℹ️ No non-Meta leads found. Database contains only Facebook and Instagram leads.');
    }

    console.log('\n✨ Database is now 100% clean and optimized for Meta Ads leads only!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during non-Meta cleanup:', err.message);
    process.exit(1);
  }
}

cleanNonMeta();
