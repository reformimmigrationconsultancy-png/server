const mongoose = require('mongoose');
const Client = require('../src/models/Client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function analyze() {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB successfully.');

    const totalLeads = await Client.countDocuments();
    console.log(`📊 Total leads in database: ${totalLeads}`);

    // Group by source
    const sources = await Client.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);
    console.log('\n📈 Leads grouped by Source:');
    console.log(sources);

    // List all leads
    const allLeads = await Client.find({}, 'fullName email source externalId createdAt').sort({ source: 1, createdAt: -1 });
    console.log('\n📄 Complete Lead Registry:');
    allLeads.forEach((lead, index) => {
      console.log(`${index + 1}. [Source: ${lead.source}] "${lead.fullName}" | Email: ${lead.email} | ExtID: ${lead.externalId || 'None'} | Created: ${lead.createdAt}`);
    });

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error analyzing database:', err.message);
    process.exit(1);
  }
}

analyze();
