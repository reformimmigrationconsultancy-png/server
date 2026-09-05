const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const User = require('../src/models/User');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const resetPassword = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    console.log('Connecting to:', mongoUri);
    await mongoose.connect(mongoUri);
    console.log('🔗 Connected to DB...');

    const user = await User.findOne({ email: 'manpreet.primemortgages@outlook.com' });
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }

    user.password = 'manpreet123';
    await user.save();
    console.log('✅ Password successfully updated to "manpreet123" for manpreet.primemortgages@outlook.com');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

resetPassword();
