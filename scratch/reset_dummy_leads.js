const mongoose = require('mongoose');
const Client = require('../src/models/Client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function resetLeads() {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Remove all existing leads
    await Client.deleteMany({});
    console.log('🗑️ All existing leads have been removed.');

    const dummyLeads = [
      {
        fullName: 'Navdeep Singh Dhillon',
        email: 'navdeep.dhillon@example.com',
        phone: '+1 (647) 555-0192',
        source: 'facebook',
        stage: 'new_lead',
        loanAmount: 680000,
        propertyValue: 850000,
        address: 'Brampton, ON, Canada',
        metaData: {
          campaignName: 'CAD_Mortgage_FirstTimeBuyers',
          pageName: 'Maninder Pal Singh - Mortgage Specialist',
          formName: 'Ontario First Time Home Buyer Questionnaire',
          customFields: {
            'Mortgage Purpose': 'First-Time Home Purchase',
            'Requested Loan Amount': '$680,000 CAD',
          }
        },
        notes: [{ content: 'High-value prospect from Meta Lead Form.' }]
      },
      {
        fullName: 'Jane Doe',
        email: 'jane.doe@example.com',
        phone: '+1 (416) 555-1122',
        source: 'website',
        stage: 'contacted',
        loanAmount: 400000,
        propertyValue: 550000,
        address: 'Toronto, ON, Canada',
        notes: [{ content: 'Called and left a voicemail.' }]
      },
      {
        fullName: 'Michael Smith',
        email: 'msmith@example.com',
        phone: '+1 (905) 555-3344',
        source: 'instagram',
        stage: 'interested',
        loanAmount: 850000,
        propertyValue: 1200000,
        address: 'Mississauga, ON, Canada',
        metaData: {
          campaignName: 'IG_Mortgage_Refinance',
          customFields: {
            'Mortgage Purpose': 'Refinance',
          }
        }
      },
      {
        fullName: 'Emily Wong',
        email: 'emily.w@example.com',
        phone: '+1 (437) 555-9988',
        source: 'whatsapp',
        stage: 'documents_received',
        loanAmount: 550000,
        propertyValue: 700000,
        address: 'Markham, ON, Canada',
        notes: [{ content: 'Received T4 and Notice of Assessment.' }]
      },
      {
        fullName: 'Robert Chen',
        email: 'rchen22@example.com',
        phone: '+1 (647) 555-7777',
        source: 'google',
        stage: 'approved',
        loanAmount: 1100000,
        propertyValue: 1500000,
        address: 'Richmond Hill, ON, Canada',
        notes: [{ content: 'Mortgage approved at 5.49% fixed.' }]
      }
    ];

    // Insert dummy leads
    for (const leadData of dummyLeads) {
        leadData.externalId = `mock_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }
    
    await Client.insertMany(dummyLeads);
    console.log(`✅ ${dummyLeads.length} dummy leads inserted successfully.`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error resetting leads:', err.message);
    process.exit(1);
  }
}

resetLeads();
