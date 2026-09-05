const mongoose = require('mongoose');
require('dotenv').config();
const { Message } = require('../src/models/Conversation');

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const msgs = await Message.find({ 
    attachments: { $exists: true, $ne: [] } 
  }).sort({ createdAt: -1 }).limit(5);
  
  console.log('--- LATEST ATTACHMENTS ---');
  msgs.forEach(m => {
    console.log(`ID: ${m._id}`);
    console.log(`Content: ${m.content}`);
    console.log(`Attachments:`, JSON.stringify(m.attachments, null, 2));
    console.log('-------------------');
  });
  
  process.exit();
}

check();
