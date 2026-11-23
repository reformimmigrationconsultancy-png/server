const mongoose = require('mongoose');
const User = require('../models/User');

const FALLBACK_MONGO_URI = 'mongodb+srv://mpmanpreet5:aIPPIDUpCFU7ZZx8@cluster0.becrk0j.mongodb.net/lead_crm?retryWrites=true&w=majority&appName=Cluster0';

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || FALLBACK_MONGO_URI;
    const conn = await mongoose.connect(mongoUri);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Auto-seed default admin account if it does not exist
    const adminEmail = 'admin@crm.com';
    const adminExists = await User.findOne({ email: adminEmail });
    if (!adminExists) {
      await User.create({
        name: 'Maninder Pal Singh',
        email: adminEmail,
        password: '123456',
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
