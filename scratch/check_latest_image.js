const mongoose = require('mongoose');
require('dotenv').config();
const { Message } = require('../src/models/Conversation');

async function check() {
  await mongoose.connect(process.env.MONGO_URI);
  const msg = await Message.findOne({ 
    $or: [{ content: '[Image]' }, { messageType: 'image' }]
  }).sort({ createdAt: -1 });
  
  console.log('--- LATEST IMAGE MESSAGE ---');
  console.log(JSON.stringify(msg, null, 2));
  
  process.exit();
}

check();
