const mongoose = require('mongoose');
const User = require('../models/User');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Auto-seed default admin account if it does not exist
    const adminEmail = 'mortgagewithmanpreet@gmail.com';
    const adminExists = await User.findOne({ email: adminEmail });
    if (!adminExists) {
      await User.create({
        name: 'Manpreet Singh',
        email: adminEmail,
        password: 'password123',
        role: 'admin'
      });
      console.log('✅ Default admin account seeded successfully');
    }
  } catch (error) {
    console.error(`❌ MongoDB Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
