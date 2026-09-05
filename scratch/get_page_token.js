require('dotenv').config();
const axios = require('axios');
const token = process.env.META_ACCESS_TOKEN;
const pageId = process.env.FB_PAGE_ID;

axios.get(`https://graph.facebook.com/v18.0/${pageId}?fields=access_token&access_token=${token}`)
  .then(res => console.log('PAGE_TOKEN=' + res.data.access_token))
  .catch(err => console.error(err.response ? err.response.data : err.message));
