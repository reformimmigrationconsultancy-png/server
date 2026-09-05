require('dotenv').config();
const axios = require('axios');

const token = process.env.META_ACCESS_TOKEN;
const pageId = process.env.FB_PAGE_ID;

async function subscribeWebhook() {
  console.log('🔑 Token length:', token ? token.length : 'undefined');
  console.log('📄 Page ID:', pageId);

  if (!token) {
    console.error('❌ Error: META_ACCESS_TOKEN is not defined in .env file.');
    return;
  }
  if (!pageId) {
    console.error('❌ Error: FB_PAGE_ID is not defined in .env file.');
    return;
  }

  async function performSubscription(pageToken) {
    console.log(`📡 Sending Page Webhook Subscription request for Page: ${pageId}...`);
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps`,
      {
        subscribed_fields: ['messages', 'messaging_postbacks', 'leadgen']
      },
      {
        params: { access_token: pageToken }
      }
    );
    return response.data;
  }

  try {
    console.log('🔄 Attempting direct Page subscription (assuming token is a Page Access Token)...');
    const directResult = await performSubscription(token);
    console.log('✅ Webhook Subscription Success (Direct):', directResult);
  } catch (directError) {
    console.error('❌ Direct Page subscription failed! Error detail:', directError.response ? directError.response.data : directError.message);
    console.log('⚠️ Falling back to fetching page accounts via User Token...');
    try {
      const accountsRes = await axios.get(
        `https://graph.facebook.com/v18.0/me/accounts?access_token=${token}`
      );
      
      const page = accountsRes.data.data.find(p => p.id === pageId);
      if (!page) {
        console.error(`❌ Page with ID ${pageId} was not found in your Facebook accounts.`);
        return;
      }
      
      console.log(`💡 Exchanged User Token for Page Token of "${page.name}"`);
      const pageToken = page.access_token;
      
      const result = await performSubscription(pageToken);
      console.log('✅ Webhook Subscription Success (Exchanged):', result);
    } catch (exchangeError) {
      console.error('❌ Webhook Subscription Failed completely!');
      console.error('Error detail:', exchangeError.response ? exchangeError.response.data : exchangeError.message);
    }
  }
}

subscribeWebhook();
