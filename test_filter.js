const axios = require('axios');

async function testApi() {
  try {
    // We don't have a token easily here without logging in, but we can check the backend code for any logic errors.
    // Let's instead check if we can simulate the request logic in a script using the models.
    const mongoose = require('mongoose');
    const { Conversation } = require('./src/models/Conversation');
    require('dotenv').config();

    await mongoose.connect(process.env.MONGO_URI);
    
    console.log('Testing filter: { platform: "whatsapp" }');
    const whatsapp = await Conversation.find({ platform: 'whatsapp' });
    console.log(`Results: ${whatsapp.length}`);
    whatsapp.forEach(c => console.log(`- ${c.platform}: ${c.lastMessage.substring(0, 30)}`));

    console.log('\nTesting filter: { platform: "email" }');
    const email = await Conversation.find({ platform: 'email' });
    console.log(`Results: ${email.length}`);
    // email.forEach(c => console.log(`- ${c.platform}: ${c.lastMessage.substring(0, 30)}`));

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

testApi();
