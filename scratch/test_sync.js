const axios = require('axios');
require('dotenv').config({ path: './server/.env' });

async function testSync() {
  const metaAccessToken = process.env.META_ACCESS_TOKEN;
  console.log('Using Token:', metaAccessToken ? metaAccessToken.substring(0, 10) + '...' : 'MISSING');

  try {
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/me/conversations`,
      {
        params: {
          access_token: metaAccessToken,
          fields: 'id,updated_time,participants,messages.limit(1){message,from,created_time}'
        },
      }
    );
    console.log('✅ Success! Found conversations:', response.data.data.length);
    if (response.data.data.length > 0) {
      const sample = response.data.data[0];
      console.log('Sample Conversation ID:', sample.id);
      console.log('Participants:');
      sample.participants.data.forEach(p => console.log(` - Name: ${p.name}, ID: ${p.id}`));
      console.log('FB_PAGE_ID in .env:', process.env.FB_PAGE_ID);
    }
  } catch (error) {
    console.error('❌ Sync Failed!');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Message:', error.message);
    }
  }
}

testSync();
