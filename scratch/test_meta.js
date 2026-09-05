const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');

async function debugToken() {
  const token = process.env.META_ACCESS_TOKEN;
  console.log('🔍 Debugging Token...');
  
  try {
  // 1. Check /me
  try {
    const me = await axios.get('https://graph.facebook.com/v18.0/me', {
      params: { access_token: token, fields: 'id,name' }
    });
    console.log('✅ Token User/Page:', me.data);
  } catch (error) {
    console.error('❌ /me query failed:', error.response?.data || error.message);
  }

  // 2. Check /me/accounts and look for Instagram
  console.log('\n🔍 Fetching accounts linked to this token...');
  try {
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
  } catch (error) {
    console.error('ℹ️ /me/accounts query failed (Expected for Page tokens):', error.response?.data?.error?.message || error.message);
  }

  // 3. Check permissions
  console.log('\n🔍 Checking token permissions...');
  try {
    const perms = await axios.get('https://graph.facebook.com/v18.0/me/permissions', {
      params: { access_token: token }
    });
    console.log('✅ Permissions:', perms.data.data.filter(p => p.status === 'granted').map(p => p.permission).join(', '));
  } catch (error) {
    console.error('❌ Permissions query failed:', error.response?.data || error.message);
  }
  } catch (outerError) {
    console.error('❌ Outer Error:', outerError.message);
  }
}

debugToken();
