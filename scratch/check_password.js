const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

dotenv.config({ path: '../.env' });

const checkOrResetPassword = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lead_crm');
    console.log('MongoDB Connected');

    const adminEmails = [
      'mortgagewithmanpreet@gmail.com',
      'manpreet.primemortgages@outlook.com'
    ];

    for (const email of adminEmails) {
      let user = await User.findOne({ email });
      if (!user) {
        console.log(`User ${email} not found.`);
      } else {
        const isMatch = await bcrypt.compare('password123', user.password);
        if (isMatch) {
          console.log(`User ${email} already has password 'password123'`);
        } else {
          console.log(`User ${email} exists but password is NOT 'password123'. Resetting...`);
          user.password = 'password123';
          await user.save();
          console.log(`Password for ${email} reset to 'password123' successfully!`);
        }
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
};

checkOrResetPassword();
