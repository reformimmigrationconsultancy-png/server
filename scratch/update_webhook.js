const axios = require('axios');
require('dotenv').config();

async function updateWebhook() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_VERIFY_TOKEN || 'mycrm123';
  const callbackUrl = `${process.env.PUBLIC_URL}/webhook/facebook`;
  console.log(`Setting Webhook URL to: ${callbackUrl}`);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${appId}/subscriptions`,
      {
        object: 'page',
        callback_url: callbackUrl,
        fields: 'messages,messaging_postbacks,leadgen',
        verify_token: verifyToken,
        include_values: true
      },
      {
        params: { access_token: `${appId}|${appSecret}` }
      }
    );
    console.log('✅ Webhook Update Success:', response.data);
  } catch (err) {
    console.error('❌ Webhook Update Error:', err.response ? err.response.data : err.message);
  }
}

updateWebhook();
