const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Client = require(path.join(__dirname, '..', 'src', 'models', 'Client'));
const { Conversation, Message } = require(path.join(__dirname, '..', 'src', 'models', 'Conversation'));

async function findAshish() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB Atlas');
    
    const ashish = await Client.findOne({ fullName: /Ashish Nuri/i });
    if (!ashish) {
      console.log('❌ Ashish Nuri not found in Clients');
    } else {
      console.log('👤 Client found:', ashish.fullName);
      console.log('🆔 PSID:', ashish.platformContactId);
      console.log('📍 Source:', ashish.source);
      
      const conv = await Conversation.findOne({ client: ashish._id });
      if (conv) {
        console.log('💬 Conversation ID:', conv._id);
        console.log('🆔 Platform ID:', conv.platformContactId);
        console.log('✅ Window Check: Last Message at', conv.lastMessageAt);
      }
    }
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

findAshish();
