const mongoose = require('mongoose');
const Automation = require('../src/models/Automation');
const Reminder = require('../src/models/Reminder');
require('dotenv').config({ path: './server/.env' });

async function checkAutomations() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const automations = await Automation.find({});
    console.log('Automations count:', automations.length);
    console.log(JSON.stringify(automations, null, 2));

    const reminders = await Reminder.find({}).limit(10);
    console.log('Reminders count:', reminders.length);

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkAutomations();
