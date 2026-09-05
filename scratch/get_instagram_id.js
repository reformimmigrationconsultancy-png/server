const axios = require('axios');
const path = require('path');
const manager = require('../src/utils/metaTokenManager');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function getInstagramId() {
  const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;

  if (!token) {
    console.error('❌ No Meta Access Token found in .env');
    return;
  }

  console.log(`📡 Querying Meta Graph API for Instagram Account connected to Page ID: ${pageId}...`);
  try {
    const response = await axios.get(`https://graph.facebook.com/v18.0/${pageId}`, {
      params: {
        access_token: token,
        fields: 'instagram_business_account,name'
      }
    });

    console.log('\n📊 Meta Response:', response.data);

    const igAccount = response.data.instagram_business_account;
    if (igAccount && igAccount.id) {
      console.log(`\n🎉 SUCCESS! Connected Instagram Business Account ID Found: ${igAccount.id}`);
      
      // Update .env with the actual Instagram ID
      console.log('🔄 Saving INSTAGRAM_BUSINESS_ACCOUNT_ID in .env...');
      manager.writeEnv('INSTAGRAM_BUSINESS_ACCOUNT_ID', igAccount.id);
      
      console.log('✅ Connected successfully! Your CRM is now linked to Instagram!');
    } else {
      console.log('\n⚠️ No Instagram Business Account connected to this Facebook Page.');
      console.log('Note: To connect Instagram, make sure your Instagram Account is converted to a "Professional/Business Account" and is fully linked to your Facebook Page ("Manpreet Singh - Mortgage Specialist") under your Facebook Page settings.');
    }
  } catch (error) {
    console.error('\n❌ Graph API Request failed!');
    if (error.response) {
      console.error('Response Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error Message:', error.message);
    }
  }
}

getInstagramId();
