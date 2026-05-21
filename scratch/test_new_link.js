const axios = require('axios');

async function testNewLink() {
  const baseUrl = 'https://journalist-vacation-killing-playstation.trycloudflare.com/webhook/facebook';
  const testUrl = `${baseUrl}?hub.mode=subscribe&hub.verify_token=manpreet&hub.challenge=CHECK_123`;
  
  try {
    console.log(`📡 Testing NEW link: ${testUrl}`);
    const response = await axios.get(testUrl);
    console.log('✅ LINK IS WORKING! Response:', response.data);
  } catch (error) {
    console.error('❌ LINK IS NOT WORKING:', error.response?.status, error.message);
  }
}

testNewLink();
