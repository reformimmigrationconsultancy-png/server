const axios = require('axios');

async function testExternalAccess() {
  const baseUrl = 'https://september-victorian-rim-lewis.trycloudflare.com/webhook/facebook';
  const testUrl = `${baseUrl}?hub.mode=subscribe&hub.verify_token=manpreet&hub.challenge=SUCCESS_CONNECTION`;
  
  try {
    console.log(`📡 Attempting to verify server from outside: ${testUrl}`);
    const response = await axios.get(testUrl);
    console.log('✅ Success! Server responded with:', response.data);
  } catch (error) {
    console.error('❌ External Access FAILED:', error.response?.status, error.response?.data || error.message);
  }
}

testExternalAccess();
