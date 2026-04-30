const axios = require('axios');
require('dotenv').config({ path: './server/.env' });

async function testFbImage() {
  const metaAccessToken = process.env.META_ACCESS_TOKEN;
  const recipientId = '27613807168206932'; 
  const imageUrl = 'https://composer-reorder-neon.ngrok-free.dev/uploads/1777112411844-jonatan-pie-h8nxGssjQXs-unsplash.jpg';

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: 'image',
            payload: { url: imageUrl, is_reusable: true }
          }
        }
      },
      {
        params: { access_token: metaAccessToken },
      }
    );
    console.log('✅ Success:', response.data);
  } catch (error) {
    console.error('❌ Failed!');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('Message:', error.message);
    }
  }
}

testFbImage();
