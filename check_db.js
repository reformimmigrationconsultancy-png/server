const mongoose = require('mongoose');
require('dotenv').config();
const Client = require('./src/models/Client');
const { Conversation, Message } = require('./src/models/Conversation');

async function checkDb() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');
    
    const clientCount = await Client.countDocuments();
    const msgCount = await Message.countDocuments();
    
    console.log('Total Clients:', clientCount);
    console.log('Total Messages:', msgCount);
    
    const latestMsgs = await Message.find().sort({ createdAt: -1 }).limit(5);
    console.log('Latest Messages:');
    latestMsgs.forEach(m => console.log(`- ${m.sender}: ${m.content.substring(0, 50)}`));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkDb();
