const nodemailer = require('nodemailer');
require('dotenv').config();

async function testSMTP() {
  console.log('Testing SMTP with:');
  console.log('Host:', process.env.SMTP_HOST);
  console.log('User:', process.env.SMTP_USER);
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false, // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    const info = await transporter.verify();
    console.log('✅ SMTP Connection verified successfully!');
  } catch (err) {
    console.error('❌ SMTP Connection failed:', err.message);
  }
}

testSMTP();
