const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function testLeadsApi() {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;

  console.log('Token length:', token ? token.length : 'undefined');
  console.log('Page ID:', pageId);

  try {
    const url = `https://graph.facebook.com/v18.0/${pageId}/leadgen_forms`;
    const res = await axios.get(url, {
      params: { access_token: token, limit: 100 }
    });
    console.log('✅ Leadgen forms fetched successfully!');
    console.log('Forms:', res.data.data);
  } catch (err) {
    console.error('❌ Leadgen forms fetch failed:');
    if (err.response) {
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
  }
}

testLeadsApi();
