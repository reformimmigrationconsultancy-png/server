const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const connectDB = require('../src/config/db');
const messenger = require('../src/services/messenger');

async function syncNow() {
  console.log('🔄 Connecting to MongoDB...');
  await connectDB();
  console.log('✅ Connected to MongoDB successfully.');
  
  console.log('🔄 Triggering live Meta Ads lead synchronization...');
  try {
    const syncedCount = await messenger.syncHistoricalLeads();
    console.log(`\n🎉 SUCCESS! Sync completed successfully.`);
    console.log(`Total leads newly imported/synchronized: ${syncedCount}`);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Sync Failed!');
    console.error(error.message);
    process.exit(1);
  }
}

syncNow();
