const axios = require('axios');

async function mockWebhook() {
  const url = 'http://localhost:8000/webhook/facebook';
  try {
    console.log('📡 Sending Mock Webhook request to localhost:8000...');
    const response = await axios.post(url, {
      object: 'page',
      entry: [{
        messaging: [{
          sender: { id: 'TEST_SENDER_ID' },
          recipient: { id: '116907654647174' },
          timestamp: Date.now(),
          message: { mid: 'MOCK_MID_' + Date.now(), text: 'Hello from Mock Webhook!' }
        }]
      }]
    });
    console.log('✅ Server responded:', response.status, response.data);
  } catch (error) {
    console.error('❌ Mock Webhook FAILED:', error.response?.data || error.message);
  }
}

mockWebhook();
