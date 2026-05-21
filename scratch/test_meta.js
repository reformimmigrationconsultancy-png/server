require('dotenv').config({ path: '../.env' });
const axios = require('axios');

async function debugToken() {
  const token = process.env.META_ACCESS_TOKEN;
  console.log('🔍 Debugging Token...');
  
  try {
    // 1. Check /me
    const me = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: { access_token: token, fields: 'id,name' }
    });
    console.log('✅ Token User/Page:', me.data);

    // 2. Check /me/accounts and look for Instagram
    console.log('🔍 Fetching accounts linked to this token...');
    const accounts = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
      params: { access_token: token, fields: 'name,id,instagram_business_account,category' }
    });
    
    if (accounts.data.data && accounts.data.data.length > 0) {
      console.log('✅ Found accounts:');
      for (const acc of accounts.data.data) {
        console.log(`   - Name: ${acc.name}, ID: ${acc.id}, Category: ${acc.category}`);
        if (acc.instagram_business_account) {
          console.log(`     📸 FOUND LINKED INSTAGRAM: ${acc.instagram_business_account.id}`);
        }
      }
    } else {
      console.log('⚠️ No accounts/pages found for this token.');
    }

    // 3. Check permissions
    console.log('🔍 Checking token permissions...');
    const perms = await axios.get('https://graph.facebook.com/v18.0/me/permissions', {
      params: { access_token: token }
    });
    console.log('✅ Permissions:', perms.data.data.filter(p => p.status === 'granted').map(p => p.permission).join(', '));

  } catch (error) {
    console.error('❌ API Error:', error.response?.data || error.message);
  }
}

debugToken();
