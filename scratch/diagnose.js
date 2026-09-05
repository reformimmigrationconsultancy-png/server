const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Client = require('../src/models/Client');
const WebhookLog = require('../src/models/WebhookLog');

async function diagnose() {
  console.log('=== 🔍 CRM DIAGNOSTIC TOOL ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Environment variables:');
  console.log('- MONGO_URI:', process.env.MONGO_URI ? 'Defined' : 'MISSING');
  console.log('- META_ACCESS_TOKEN:', process.env.META_ACCESS_TOKEN ? `${process.env.META_ACCESS_TOKEN.substring(0, 15)}...` : 'MISSING');
  console.log('- META_PAGE_ACCESS_TOKEN:', process.env.META_PAGE_ACCESS_TOKEN ? `${process.env.META_PAGE_ACCESS_TOKEN.substring(0, 15)}...` : 'MISSING');
  console.log('- FB_PAGE_ID:', process.env.FB_PAGE_ID);
  console.log('- META_APP_ID:', process.env.META_APP_ID);
  console.log('- META_APP_SECRET:', process.env.META_APP_SECRET ? 'Defined' : 'MISSING');
  console.log('- META_VERIFY_TOKEN:', process.env.META_VERIFY_TOKEN);
  console.log('- PUBLIC_URL:', process.env.PUBLIC_URL);

  // 1. Connect MongoDB
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected successfully');

    const totalClients = await Client.countDocuments();
    const clientsBySource = await Client.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);
    console.log(`📊 Total Clients in DB: ${totalClients}`);
    console.log('📊 Clients by Source:', clientsBySource);

    const latestClients = await Client.find().sort({ createdAt: -1 }).limit(5);
    console.log('📋 Latest 5 Leads:');
    latestClients.forEach((c, idx) => {
      console.log(`  ${idx + 1}. [${c.source}] ${c.fullName} (${c.email || 'no-email'}, ${c.phone || 'no-phone'}) - Created: ${c.createdAt?.toISOString()}`);
    });

    const recentLogs = await WebhookLog.find().sort({ createdAt: -1 }).limit(10);
    console.log(`\n📋 Recent Webhook Logs (${recentLogs.length} found):`);
    recentLogs.forEach((log, idx) => {
      console.log(`  ${idx + 1}. [${log.platform}] ${log.eventType} - Status: ${log.status} - Error: ${log.errorMessage || 'None'} - Date: ${log.createdAt?.toISOString()}`);
    });

  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
  }

  // 2. Test Meta Token
  const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (token) {
    console.log('\n--- 🌐 Testing Meta Graph API Token ---');
    try {
      const debugRes = await axios.get('https://graph.facebook.com/debug_token', {
        params: {
          input_token: token,
          access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
        }
      });
      const data = debugRes.data.data;
      console.log('✅ Meta Token Debug Info:');
      console.log('- Is Valid:', data.is_valid);
      console.log('- Type:', data.type);
      console.log('- App ID:', data.app_id);
      console.log('- Expires At:', data.expires_at === 0 ? 'Never (Permanent)' : new Date(data.expires_at * 1000).toISOString());
      console.log('- Scopes:', data.scopes);
    } catch (err) {
      console.error('❌ Meta Token Debug Failed:', err.response?.data || err.message);
    }

    // Test Page Info
    try {
      const pageRes = await axios.get(`https://graph.facebook.com/v18.0/${process.env.FB_PAGE_ID}`, {
        params: { access_token: token, fields: 'id,name,access_token' }
      });
      console.log('✅ Page Info:', pageRes.data.name, `(ID: ${pageRes.data.id})`);
    } catch (err) {
      console.error('❌ Meta Page Fetch Failed:', err.response?.data || err.message);
    }

    // Test Leadgen Forms
    try {
      const formsRes = await axios.get(`https://graph.facebook.com/v18.0/${process.env.FB_PAGE_ID}/leadgen_forms`, {
        params: { access_token: token }
      });
      console.log(`✅ Meta Leadgen Forms (${formsRes.data.data?.length || 0} forms):`);
      for (const form of formsRes.data.data || []) {
        console.log(`  - Form: "${form.name}" (ID: ${form.id}, Status: ${form.status})`);
        // Check form leads count
        try {
          const leadsRes = await axios.get(`https://graph.facebook.com/v18.0/${form.id}/leads`, {
            params: { access_token: token, limit: 5 }
          });
          console.log(`    Total leads in form (sample fetched): ${leadsRes.data.data?.length || 0}`);
          if (leadsRes.data.data?.length > 0) {
            leadsRes.data.data.forEach(l => {
              const fields = {};
              l.field_data?.forEach(f => { fields[f.name] = f.values?.[0]; });
              console.log(`    -> Lead ID: ${l.id}, Created: ${l.created_time}, Fields:`, fields);
            });
          }
        } catch (leadErr) {
          console.error(`    ❌ Failed to fetch leads for form ${form.id}:`, leadErr.response?.data || leadErr.message);
        }
      }
    } catch (err) {
      console.error('❌ Meta Leadgen Forms Fetch Failed:', err.response?.data || err.message);
    }
  }

  // 3. Test Subscribed Apps for Page (Meta Webhook Subscription)
  if (token) {
    try {
      console.log('\n--- 📡 Testing Page Subscribed Apps (Webhooks) ---');
      const subRes = await axios.get(`https://graph.facebook.com/v18.0/${process.env.FB_PAGE_ID}/subscribed_apps`, {
        params: { access_token: token }
      });
      console.log('✅ Subscribed Apps for Page:', JSON.stringify(subRes.data, null, 2));
    } catch (err) {
      console.error('❌ Subscribed Apps Check Failed:', err.response?.data || err.message);
    }
  }

  process.exit(0);
}

diagnose();
