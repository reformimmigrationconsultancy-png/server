const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function checkForms() {
  const token = process.env.META_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;

  console.log('📄 Querying leadgen_forms for Page:', pageId);
  try {
    const res = await axios.get(`https://graph.facebook.com/v18.0/${pageId}/leadgen_forms`, {
      params: { access_token: token, limit: 100 }
    });
    console.log('✅ Success! Found leadgen forms:', res.data);
  } catch (error) {
    console.error('❌ Query failed!');
    if (error.response) {
      console.error('Error Code:', error.response.status);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error Message:', error.message);
    }
  }
}

checkForms();
