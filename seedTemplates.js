require('dotenv').config();
const mongoose = require('mongoose');
const EmailTemplate = require('./src/models/EmailTemplate');

const seedTemplates = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB Connected');

    // Default Templates
    const templates = [
      {
        name: 'Initial Welcome (New Lead)',
        subject: 'Welcome {{first_name}} — We received your inquiry!',
        body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <h2 style="color: #4f46e5;">Hello {{first_name}},</h2>
  <p>Thank you for reaching out to us! We have received your inquiry from <strong>{{lead_source}}</strong> and our team is currently reviewing your details.</p>
  <p>We pride ourselves on quick responses. You can expect a call from us at <strong>{{phone}}</strong> shortly.</p>
  <p>In the meantime, feel free to reply to this email if you have any immediate questions.</p>
  <br />
  <p>Best regards,<br/><strong>{{admin_name}}</strong></p>
</div>`,
        category: 'Welcome',
        status: 'active'
      },
      {
        name: 'Follow-up (No Answer)',
        subject: 'Sorry we missed you, {{first_name}}!',
        body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <p>Hi {{first_name}},</p>
  <p>I tried giving you a quick call today regarding your recent inquiry, but it seems I missed you.</p>
  <p>Are you still looking for assistance? If so, please let me know a good time to reach you, or feel free to call me back directly.</p>
  <p>Looking forward to connecting!</p>
  <br />
  <p>Best,<br/><strong>{{admin_name}}</strong></p>
</div>`,
        category: 'Follow-up',
        status: 'active'
      },
      {
        name: 'Meeting Reminder',
        subject: 'Reminder: Upcoming Appointment with {{assigned_to}}',
        body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <p>Hi {{first_name}},</p>
  <p>Just a quick reminder that we have a meeting scheduled soon.</p>
  <p>If you need to reschedule or have any questions beforehand, please let me know.</p>
  <p>Speak to you soon!</p>
  <br />
  <p>Thanks,<br/><strong>{{assigned_to}}</strong></p>
</div>`,
        category: 'Reminder',
        status: 'active'
      },
      {
        name: 'Long-term Nurture (Check-in)',
        subject: 'Checking in - How are things, {{first_name}}?',
        body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <p>Hi {{first_name}},</p>
  <p>It's been a little while since we last spoke. I just wanted to check in and see if you had any updates on your situation, or if there is anything I can help you with right now.</p>
  <p>Even if you're not ready to move forward yet, I'm always here to answer questions.</p>
  <p>Hope you are doing well!</p>
  <br />
  <p>Best regards,<br/><strong>{{admin_name}}</strong></p>
</div>`,
        category: 'Follow-up',
        status: 'active'
      }
    ];

    await EmailTemplate.deleteMany({});
    console.log('Cleared existing templates');

    await EmailTemplate.insertMany(templates);
    console.log('Successfully seeded 4 professional email templates!');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding templates:', error);
    process.exit(1);
  }
};

seedTemplates();
