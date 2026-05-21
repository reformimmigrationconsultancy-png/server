const mongoose = require('mongoose');
const Client = require('../src/models/Client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function createLead() {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const mockLeadId = `leadgen_mock_${Date.now()}`;

    const lead = await Client.create({
      fullName: 'Navdeep Singh Dhillon',
      email: 'navdeep.dhillon@example.com',
      phone: '+1 (647) 555-0192',
      source: 'facebook',
      externalId: mockLeadId,
      stage: 'new_lead',
      loanAmount: 680000,
      propertyValue: 850000,
      address: 'Brampton, ON, Canada',
      metaData: {
        campaignName: 'CAD_Mortgage_FirstTimeBuyers_2026',
        adSetName: 'Ontario_25-45_HighIncome',
        adName: 'Ad_Image_ZeroDownPayment',
        pageName: 'Manpreet Singh - Mortgage Specialist',
        formName: 'Ontario First Time Home Buyer Questionnaire',
        customFields: {
          'Mortgage Purpose': 'First-Time Home Purchase',
          'Requested Loan Amount': '$680,000 CAD',
          'Down Payment Saved': '$85,000 CAD (10%)',
          'Estimated Credit Score': '740+ (Excellent)',
          'Annual Household Income': '$160,000 CAD',
          'Employment Status': 'Full-Time Salaried Permanent',
          'Preferred Pre-Approval Timeline': 'Within 30 Days'
        },
        webhookTimestamp: new Date()
      },
      notes: [{
        content: '🔥 High-value prospect from Meta Lead Form: First-Time Buyers 2026. Excellent credit score, down payment is ready. Call immediately to issue pre-approval details.'
      }]
    });

    console.log(`\n🎉 Mock Meta Lead successfully registered in CRM!`);
    console.log(`Lead Name: ${lead.fullName}`);
    console.log(`Database ID: ${lead._id}`);
    console.log(`Source: ${lead.source}`);
    console.log(`Open your browser and navigate to: http://localhost:5174/lead/clients/${lead._id} to see the newly fixed Ad Data!`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error creating mock lead:', err.message);
  }
}

createLead();
