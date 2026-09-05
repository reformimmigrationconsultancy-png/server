const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testEmail() {
  const smtpUser = process.env.SMTP_USER || process.env.IMAP_USER || 'mortgagewithmanpreet@gmail.com';
  const smtpPass = process.env.SMTP_PASS || process.env.IMAP_PASS || 'swnamaxjdsfsygkz';

  console.log(`Testing SMTP with user: ${smtpUser}`);

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
    to: smtpUser, // sending to self
    subject: "Test Email from CRM",
    text: "This is a test email.",
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully:", info.messageId);
  } catch (error) {
    console.error("❌ Error sending email:", error);
  }
}

testEmail();
