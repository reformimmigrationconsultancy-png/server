const mongoose = require('mongoose');
const Client = require('../src/models/Client');
require('dotenv').config({ path: './server/.env' });

async function fixNames() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const clients = await Client.find({});
    let count = 0;

    for (const client of clients) {
      if (client.fullName) {
        const cleaned = client.fullName.trim().replace(/\s+/g, ' ');
        if (cleaned !== client.fullName) {
          console.log(`Fixing name: "${client.fullName}" -> "${cleaned}"`);
          client.fullName = cleaned;
          await client.save();
          count++;
        }
      }
    }

    console.log(`✅ Cleaned ${count} client names with double/multiple spaces.`);
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

fixNames();
