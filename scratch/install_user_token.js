const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const manager = require('../src/utils/metaTokenManager');

async function run() {
  // New token with pages_manage_ads scope included
  const token = 'EAAfxrZAOI5cUBRbfNI9XhAjM7I4CAfaat6IxSLvATZAAgvfSEMwRg0ZBlfQAzerujZBksKNztZB4R3hz1FHeRMN8Nyj0WT443TM4bABuYgEehcmUOB1Pay0SZBYUinsGganhkxqZBbfidFJahOaK9Qmk3LLzfcWTOQEsIG0Vl3VYO54qxYUem9vYSQQYoAbMb8r14pqGy6g3L4mMVrUnzHUhZAHyZBUdjONKFZA3CDaVvKpnEV36Ob40ZBieIzkysLGiBwTcnWtTq1ppkLTZC7UZD';
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
