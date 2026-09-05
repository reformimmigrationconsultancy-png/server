require('dotenv').config();
const metaTokenManager = require('../utils/metaTokenManager');

/**
 * Script to initialize Meta Token
 * Usage: node src/scripts/init_meta_token.js <short_lived_token>
 */
async function init() {
  const token = process.argv[2] || process.env.META_ACCESS_TOKEN;
  
  if (!token) {
    console.error('❌ Error: No token provided. Please provide a short-lived token as an argument or in .env');
    process.exit(1);
  }

  console.log('🚀 Starting Meta Token Permanent Conversion...');
  try {
    const permanentToken = await metaTokenManager.convertAndSave(token);
    console.log('\n--- SUCCESS ---');
    console.log('Your Page Access Token is now PERMANENT (it will not expire).');
    console.log('The token has been automatically saved to your server/.env file.');
    console.log('You can now restart your server to use the permanent token.');
    console.log('----------------\n');
  } catch (error) {
    console.error('\n--- FAILED ---');
    console.error('Check your META_APP_ID, META_APP_SECRET, and FB_PAGE_ID in .env');
    console.error('Make sure the short-lived token has the required permissions:');
    console.error('pages_show_list, pages_messaging, pages_read_engagement, pages_manage_metadata');
    console.error('----------------\n');
    process.exit(1);
  }
}

init();
