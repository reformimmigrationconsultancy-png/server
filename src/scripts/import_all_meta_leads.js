require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const Client = require('../models/Client');

const token = process.argv[2] || process.env.META_ACCESS_TOKEN;
const adAccountId = 'act_836740425703894';

async function importAllLeads() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB.');

  console.log(`Fetching all ads from ad account ${adAccountId}...`);
  const adsRes = await axios.get(`https://graph.facebook.com/v18.0/${adAccountId}/ads?fields=id,name,status,campaign{name}`, {
    params: { access_token: token, limit: 100 }
  });
  const ads = adsRes.data.data || [];
  console.log(`Found ${ads.length} ads in account.`);

  let added = 0;
  let skipped = 0;

  for (const ad of ads) {
    let url = `https://graph.facebook.com/v18.0/${ad.id}/leads`;
    let params = { access_token: token, fields: 'id,created_time,field_data', limit: 100 };
    
    while (url) {
      try {
        const res = await axios.get(url, { params: url.includes('?') ? {} : params });
        const leads = res.data.data || [];
        for (const rawLead of leads) {
          const externalId = rawLead.id;
          const existing = await Client.findOne({ externalId });
          if (existing) {
            skipped++;
            continue;
          }

          let fullName = '';
          let email = '';
          let phone = '';
          const customFields = {};
          let statusInCanada = '';
          let maritalStatus = '';

          (rawLead.field_data || []).forEach(f => {
            const name = (f.name || '').toLowerCase();
            const val = f.values && f.values.length > 0 ? String(f.values[0]).trim() : '';
            if (!val) return;

            if (name === 'full_name' || name === 'fullname' || name === 'name' || name === 'your_name') {
              fullName = val;
            } else if (name === 'first_name') {
              if (!fullName) fullName = val;
            } else if (name === 'last_name') {
              if (fullName) fullName += ` ${val}`;
            } else if (name.includes('email')) {
              email = val.toLowerCase();
            } else if (name.includes('phone') || name.includes('number') || name.includes('contact') || name.includes('mobile')) {
              phone = val;
            } else {
              customFields[f.name] = val;
              if (name.includes('status_in_canada') || name.includes('status')) {
                statusInCanada = val;
              } else if (name.includes('marital')) {
                maritalStatus = val;
              }
            }
          });

          if (!fullName && (email || phone)) {
            fullName = email ? email.split('@')[0] : 'Meta Prospect';
          }
          if (!fullName) {
            fullName = `Lead ${externalId.slice(-5)}`;
          }

          const notes = [];
          notes.push({ content: `Lead from Facebook Ad: "${ad.name}" (${ad.campaign?.name || 'Reform Campaign'})` });
          if (statusInCanada) notes.push({ content: `Status in Canada: ${statusInCanada}` });
          if (maritalStatus) notes.push({ content: `Marital Status: ${maritalStatus}` });

          await Client.create({
            fullName,
            email: email || undefined,
            phone: phone || undefined,
            source: 'facebook',
            externalId,
            stage: 'new_lead',
            createdAt: new Date(rawLead.created_time),
            metaData: {
              adName: ad.name,
              adId: ad.id,
              campaignName: ad.campaign?.name || 'Reform Immigration Campaign',
              customFields,
              statusInCanada,
              maritalStatus
            },
            notes
          });
          added++;
        }
        url = res.data.paging?.next || null;
      } catch (err) {
        console.error(`Error fetching leads for ad ${ad.name} (${ad.id}):`, err.response?.data?.error?.message || err.message);
        url = null;
      }
    }
  }

  console.log(`\n🎉 IMPORT COMPLETED!`);
  console.log(`✅ Newly Added: ${added}`);
  console.log(`⏩ Skipped Existing: ${skipped}`);
  const total = await Client.countDocuments();
  console.log(`📊 Total Leads in CRM Database: ${total}`);

  await mongoose.disconnect();
}

importAllLeads().catch(err => {
  console.error('Fatal import error:', err);
  process.exit(1);
});
