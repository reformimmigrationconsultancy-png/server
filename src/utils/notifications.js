const nodemailer = require('nodemailer');

const sendNotificationEmail = async (subject, text, html) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('⚠️ SMTP credentials missing, skipping notification email.');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"Lead CRM Alerts" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: subject,
      text: text,
      html: html || text,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Notification email sent: ${subject}`);
  } catch (error) {
    console.error('❌ Error sending notification email:', error.message);
  }
};

module.exports = { sendNotificationEmail };
