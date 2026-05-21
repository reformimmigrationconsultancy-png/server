const axios = require('axios');

async function testPublicUrl() {
  const url = 'https://september-victorian-rim-lewis.trycloudflare.com/health';
  try {
    console.log(`📡 Testing public URL: ${url}`);
    const response = await axios.get(url);
    console.log('✅ Public URL is accessible!');
    console.log('Response:', response.data);
  } catch (error) {
    console.error('❌ Public URL is NOT accessible:', error.message);
  }
}

testPublicUrl();
