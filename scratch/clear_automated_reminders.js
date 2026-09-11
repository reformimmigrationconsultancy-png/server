const mongoose = require('mongoose');
const Reminder = require('../src/models/Reminder');
require('dotenv').config({ path: './server/.env' });

async function clearAutomatedReminders() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const result = await Reminder.deleteMany({ isAutomated: true });
    console.log(`✅ Deleted ${result.deletedCount} automated follow-up reminders!`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error clearing automated reminders:', err.message);
  }
}

clearAutomatedReminders();
