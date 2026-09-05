const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const manager = require('../src/utils/metaTokenManager');

async function run() {
  // New token with pages_manage_ads scope included
  const token = process.argv[2] || process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error('❌ Error: Please provide the token as an argument: node scratch/install_user_token.js <YOUR_TOKEN>');
    return;
  }
  const newAppId = '2236052643833285';

  try {
    console.log('🔄 Setting Meta App ID in .env...');
    manager.writeEnv('META_APP_ID', newAppId);
    manager.appId = newAppId; // Update runtime reference

    console.log('🔄 Starting token conversion and integration update...');
    const result = await manager.convertAndSave(token);
    console.log('\n🎉 SUCCESS: Meta Token Successfully Processed!');
    console.log(`Connected Facebook Page: "${result.pageName}"`);
    console.log(`Page Access Token length: ${result.token.length} chars`);
    console.log('This is a Permanent Page Token and will NEVER expire!');
  } catch (err) {
    console.error('\n❌ ERROR converting token:', err.message);
  }
}

run();
