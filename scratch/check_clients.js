const mongoose = require('mongoose');
const Client = require('../src/models/Client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function checkClients() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is undefined in .env file!');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const totalClients = await Client.countDocuments({});
    console.log(`📊 Total Clients in DB: ${totalClients}`);

    const facebookClients = await Client.find({ source: 'facebook' });
    console.log(`🔵 Facebook Leads in DB: ${facebookClients.length}`);

    if (facebookClients.length > 0) {
      facebookClients.forEach((client, i) => {
        console.log(`\n--- Facebook Lead #${i + 1} ---`);
        console.log(`Name: ${client.fullName}`);
        console.log(`Email: ${client.email}`);
        console.log(`Phone: ${client.phone}`);
        console.log(`Stage: ${client.stage}`);
        console.log(`External ID: ${client.externalId}`);
        console.log(`Metadata:`, JSON.stringify(client.metaData, null, 2));
      });
    } else {
      console.log('⚠️ No Facebook Leads found in the database.');
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error checking clients:', err.message);
  }
}

checkClients();
