const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function debugToken() {
  const token = process.env.META_ACCESS_TOKEN;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!token) {
    console.error('❌ META_ACCESS_TOKEN is not defined in .env');
    return;
  }

  console.log('📡 Debugging active token...');
  console.log('App ID:', appId);
  console.log('Token length:', token.length);

  try {
    // 1. Inspect the token properties using /debug_token
    const response = await axios.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: token,
        access_token: `${appId}|${appSecret}`
      }
    });

    console.log('\n📊 Token Debug Response:');
    console.log(JSON.stringify(response.data.data, null, 2));
  } catch (error) {
    console.error('❌ Debug failed:', error.response ? error.response.data : error.message);
    
    // Fallback: query /me to check what we can access
    console.log('\n🔄 Attempting basic /me check with token...');
    try {
      const meRes = await axios.get('https://graph.facebook.com/v18.0/me', {
        params: { access_token: token, fields: 'id,name' }
      });
      console.log('✅ Basic /me Success:', meRes.data);
    } catch (meError) {
      console.error('❌ Basic /me failed too:', meError.response ? meError.response.data : meError.message);
    }

    // Try basic /me/permissions
    console.log('\n🔄 Attempting basic permissions check with token...');
    try {
      const permRes = await axios.get('https://graph.facebook.com/v18.0/me/permissions', {
        params: { access_token: token }
      });
      console.log('✅ Token Permissions:', permRes.data.data);
    } catch (permError) {
      console.error('❌ Permissions query failed:', permError.response ? permError.response.data : permError.message);
    }
  }
}

debugToken();
