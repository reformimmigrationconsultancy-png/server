const { sendNotificationEmail } = require('./src/utils/notifications');
require('dotenv').config({ path: './server/.env' });

async function testEmail() {
  const subject = "Thank you for your interest, deepak!";
  const clientHtml = `
    <h3>Hi deepak,</h3>
    <p>Thank you for reaching out to us.</p>
    <p>We have successfully received your details. One of our representatives will contact you shortly.</p>
    <br/>
    <p>Best regards,</p>
    <p><strong>Manpreet Singh</strong><br/>Business Funding & Mortgage Specialist</p>
  `;

  console.log("Sending test email to mortgagewithmanpreet@gmail.com...");
  await sendNotificationEmail(subject, "Thank you for your interest.", clientHtml, "mortgagewithmanpreet@gmail.com");
  console.log("Test email sent!");
}

testEmail();
