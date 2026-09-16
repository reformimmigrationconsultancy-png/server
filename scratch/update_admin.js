const mongoose = require('mongoose');
const User = require('../src/models/User');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function resetAdmin() {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Remove all existing users
    await User.deleteMany({});
    console.log('🗑️ All existing users have been removed.');

    const adminEmail = 'admin@crm.com';
    await User.create({
      name: 'Maninder Pal Singh',
      email: adminEmail,
      password: '123456',
      role: 'admin'
    });
    console.log('✅ Default admin account seeded successfully with admin@crm.com and 123456');

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error resetting admin:', err.message);
    process.exit(1);
  }
}

resetAdmin();
