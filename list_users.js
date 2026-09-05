const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./src/models/User');

dotenv.config();

const listUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lead_crm', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    const users = await User.find({}, 'email name role');
    console.log('Current users in DB:', users);
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

listUsers();
