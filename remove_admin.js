const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./src/models/User');

dotenv.config();

const removeAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lead_crm', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('🔗 Connected to DB to remove admin...');

    const result = await User.deleteOne({ email: 'vikasrajput1620@gmail.com' });
    
    if (result.deletedCount > 0) {
        console.log('✅ Successfully removed admin user: vikasrajput1620@gmail.com');
    } else {
        console.log('⚠️ Could not find user: vikasrajput1620@gmail.com in the database.');
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

removeAdmin();
