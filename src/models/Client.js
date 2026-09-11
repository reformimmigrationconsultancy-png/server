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
  if (this.fullName && typeof this.fullName === 'string') {
    this.fullName = this.fullName.trim().replace(/\s+/g, ' ');
  }
  next();
});

clientSchema.post('save', function(doc) {
  if (doc.wasNew) {
    // Run asynchronously without blocking
    (async () => {
      try {
        const { sendNotificationEmail } = require('../utils/notifications');

        // Clean & validate email & phone
        const cleanEmail = doc.email && typeof doc.email === 'string' ? doc.email.trim().toLowerCase() : '';
        const cleanPhone = doc.phone && typeof doc.phone === 'string' ? doc.phone.trim() : '';
        const cleanName = doc.fullName && typeof doc.fullName === 'string' ? doc.fullName.trim().toLowerCase() : '';

        const hasValidEmail = cleanEmail !== '' && cleanEmail !== 'n/a' && cleanEmail.includes('@') && !cleanEmail.includes('example.com') && !cleanEmail.includes('@fb.com');
        const hasValidPhone = cleanPhone !== '' && cleanPhone !== 'n/a' && cleanPhone.length >= 5;

        const isDummyName = cleanName === 'facebook user' || 
                            cleanName === 'facebook user test' || 
                            cleanName === 'test lead' || 
                            cleanName === 'google user' || 
                            cleanName === 'website visitor' || 
                            cleanName.startsWith('meta lead ') || 
                            cleanName.startsWith('facebook user ');

        // STRICT GUARD: Do NOT send notification email if lead has neither valid email nor valid phone, or if it's a dummy test lead without real contact info
        if (!hasValidEmail && !hasValidPhone) {
          console.log(`⚠️ [ClientModel] Skipping email alert: Lead '${doc.fullName}' has no valid email or phone number.`);
          return;
        }

        if (isDummyName && !hasValidEmail && !hasValidPhone) {
          console.log(`⚠️ [ClientModel] Skipping email alert: Lead '${doc.fullName}' is a test/dummy lead.`);
          return;
        }


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
        
        // Send email to Admin
        await sendNotificationEmail(subject, `New lead created via ${sourceLabel}.`, html);

        // Send auto-responder email to Client (if email is valid)
        if (hasValidEmail) {
          const clientSubject = `Thank you for your interest, ${doc.fullName}!`;
          const clientHtml = `
            <h3>Hi ${doc.fullName},</h3>
            <p>Thank you for reaching out to us.</p>
            <p>We have successfully received your details. One of our representatives will contact you shortly.</p>
            <br/>
            <p>Best regards,</p>
            <p><strong>Manpreet Singh</strong><br/>Business Funding & Mortgage Specialist</p>
          `;
          await sendNotificationEmail(clientSubject, 'Thank you for your interest.', clientHtml, doc.email);
        }
      } catch (err) {
        console.error('❌ [ClientModel] Error in post-save notification email:', err.message);
      }
    })();
  }
});

module.exports = mongoose.model('Client', clientSchema);
