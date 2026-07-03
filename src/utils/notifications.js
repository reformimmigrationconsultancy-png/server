const nodemailer = require('nodemailer');

const sendNotificationEmail = async (subject, text, html, toEmail = null) => {
  try {
    // Default to the admin email (mortgagewithmanpreet@gmail.com) if no specific toEmail is provided
    const to = toEmail || process.env.ADMIN_EMAIL || process.env.IMAP_USER || process.env.SMTP_USER || 'mortgagewithmanpreet@gmail.com';
    const finalHtml = html || text;

    // Use PHP Mailer if configured
    if (process.env.PHP_MAILER_URL) {
      console.log(`📡 Sending notification email via PHP Mailer to ${to}...`);
      const axios = require('axios');
      const response = await axios.post(process.env.PHP_MAILER_URL, {
        to: to,
        subject: subject,
        html: finalHtml,
        text: text,
        from: process.env.SMTP_USER || 'alerts@manpreetcrm.com',
        fromName: 'Lead CRM Alerts'
      });
      if (response.data && response.data.success) {
        console.log(`✅ PHP Mailer success: ${subject}`);
        return;
      } else {
        console.error(`❌ PHP Mailer failed:`, response.data);
        // Fallback to Nodemailer if PHP fails
      }
    }

    const smtpUser = process.env.SMTP_USER || process.env.IMAP_USER;
    const smtpPass = process.env.SMTP_PASS || process.env.IMAP_PASS;

    if (!smtpUser || !smtpPass) {
      console.log('⚠️ SMTP credentials missing, skipping notification email.');
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const mailOptions = {
      from: `"Lead CRM Alerts" <${smtpUser}>`,
      to: to,
      subject: subject,
      text: text,
      html: finalHtml,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Notification email sent: ${subject}`);
  } catch (error) {
    console.error('❌ Error sending notification email:', error.message);
  }
};

module.exports = { sendNotificationEmail };
