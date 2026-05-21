const axios = require('axios');
require('dotenv').config();

async function checkPages() {
  const token = process.env.META_ACCESS_TOKEN;
  try {
    console.log('📡 Fetching pages for the provided token...');
    const response = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
      params: { access_token: token }
    });

    if (response.data.data && response.data.data.length > 0) {
      console.log('✅ Found the following pages:');
      response.data.data.forEach(page => {
        console.log(`- Name: ${page.name}, ID: ${page.id}`);
      });
    } else {
      console.log('⚠️ No pages found for this token. Make sure you selected the pages in the Facebook popup.');
    }
  } catch (error) {
    console.error('❌ Error fetching pages:', error.response?.data || error.message);
  }
}

checkPages();
