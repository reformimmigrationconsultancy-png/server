require('dotenv').config({ path: '../.env' });
const messenger = require('../src/services/messenger');

async function testSendMessage() {
  const recipientId = '27613807168206932';
  const message = 'Hello! This is a test message from the AI assistant to verify your Meta Access Token is working. ✅';

  console.log(`🚀 Attempting to send message to ${recipientId}...`);
  try {
    const response = await messenger.sendFacebookMessage(recipientId, message);
    console.log('✅ Success! Facebook API Response:', JSON.stringify(response, null, 2));
  } catch (error) {
    console.error('❌ Failed to send message:', error.message);
  }
}

testSendMessage();
