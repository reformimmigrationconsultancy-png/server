const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  source: {
    type: String,
    enum: ['whatsapp', 'facebook', 'instagram', 'email', 'website', 'call', 'manual', 'google'],
    default: 'manual'
  },
  platformContactId: { type: String }, // PSID for Facebook, Phone for WhatsApp
  externalId: { type: String, unique: true, sparse: true, index: true },

  stage: {
    type: String,
    enum: ['new_lead', 'contacted', 'interested', 'documents_received', 'approved', 'closed'],
    default: 'new_lead'
  },
  metaData: {
    campaignName: String,
    adSetName: String,
    adName: String,
    pageName: String,
    formName: String,
    customFields: mongoose.Schema.Types.Mixed,
    rawData: mongoose.Schema.Types.Mixed,
    webhookTimestamp: Date
  },
  tags: [{ type: String }],
  notes: [{
    content: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }],
  documents: [{
    filename: String,
    originalName: String,
    mimetype: String,
    size: Number,
    uploadedAt: { type: Date, default: Date.now }
  }],
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  loanAmount: { type: Number },
  propertyValue: { type: Number },
  address: { type: String },
  isArchived: { type: Boolean, default: false },
}, { timestamps: true });

clientSchema.pre('save', function(next) {
  this.wasNew = this.isNew;
  next();
});

clientSchema.post('save', async function(doc) {
  if (doc.wasNew) {
    try {
      const { sendNotificationEmail } = require('../utils/notifications');
      let sourceLabel = doc.source ? doc.source.charAt(0).toUpperCase() + doc.source.slice(1) : 'Unknown';
      if (doc.source === 'facebook') sourceLabel = 'Meta Ads';
      if (doc.source === 'google') sourceLabel = 'Google Ads';
      if (doc.source === 'whatsapp') sourceLabel = 'WhatsApp';

      const subject = `🎉 New Lead via ${sourceLabel}: ${doc.fullName}`;
      
      // Build custom fields HTML if metaData has customFields
      let customFieldsHtml = '';
      if (doc.metaData && doc.metaData.customFields) {
        const fields = doc.metaData.customFields;
        const keys = Object.keys(fields);
        if (keys.length > 0) {
          customFieldsHtml = '<h4>Custom Fields:</h4><ul>';
          keys.forEach(key => {
            customFieldsHtml += `<li><strong>${key}:</strong> ${fields[key]}</li>`;
          });
          customFieldsHtml += '</ul>';
        }
      }

      const html = `
        <h3>New Lead Details</h3>
        <p><strong>Name:</strong> ${doc.fullName}</p>
        <p><strong>Email:</strong> ${doc.email || 'N/A'}</p>
        <p><strong>Phone:</strong> ${doc.phone || 'N/A'}</p>
        <p><strong>Source:</strong> ${sourceLabel}</p>
        ${doc.metaData?.campaignName ? `<p><strong>Campaign:</strong> ${doc.metaData.campaignName}</p>` : ''}
        ${doc.metaData?.formName ? `<p><strong>Form Name:</strong> ${doc.metaData.formName}</p>` : ''}
        ${customFieldsHtml}
        <p>Login to CRM to view more details.</p>
      `;
      
      await sendNotificationEmail(subject, `New lead created via ${sourceLabel}.`, html);
    } catch (err) {
      console.error('❌ [ClientModel] Error in post-save notification email:', err.message);
    }
  }
});

module.exports = mongoose.model('Client', clientSchema);
