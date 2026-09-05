require('dotenv').config({ path: 'c:/react project/lead/server/.env' });
const mongoose = require('mongoose');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  const messenger = require('c:/react project/lead/server/src/services/messenger');
  try {
    const res = await messenger.syncHistoricalLeads();
    console.log('Success:', res);
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
  process.exit(0);
}
test();
