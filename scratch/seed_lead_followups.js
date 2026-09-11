const mongoose = require('mongoose');
const Client = require('../src/models/Client');
const Reminder = require('../src/models/Reminder');
const User = require('../src/models/User');
require('dotenv').config({ path: './server/.env' });

async function seedLeadFollowups() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      console.error('No admin user found!');
      await mongoose.disconnect();
      return;
    }

    const clients = await Client.find({});
    console.log(`Found ${clients.length} total clients.`);

    let createdCount = 0;
    for (const client of clients) {
      const existingTask = await Reminder.findOne({ client: client._id });
      if (!existingTask) {
        const sourceLabel = client.source ? client.source.toUpperCase() : 'CRM';
        await Reminder.create({
          title: `⚡ Initial Contact: ${client.fullName}`,
          description: `Automated follow-up task for lead intake (${sourceLabel}). Reach out to qualify requirements.`,
          client: client._id,
          type: 'call',
          dueDate: new Date(Date.now() + 15 * 60 * 1000), // 15 mins from now
          priority: 'high',
          status: 'pending',
          isAutomated: true,
          assignedTo: admin._id,
          createdBy: admin._id,
          history: [{
            action: 'created',
            performedBy: admin._id,
            timestamp: new Date(),
            details: 'Automated follow-up generated for lead'
          }]
        });
        createdCount++;
      }
    }

    console.log(`✅ Generated ${createdCount} follow-up tasks for existing leads!`);
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

seedLeadFollowups();
