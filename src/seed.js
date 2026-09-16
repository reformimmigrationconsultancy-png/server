require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Client = require('./models/Client');
const { Conversation, Message } = require('./models/Conversation');
const Call = require('./models/Call');
const Reminder = require('./models/Reminder');

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lead_crm');
    console.log('MongoDB Connected for Seeding');

    // Clean existing data except users (we just update the admin)
    await Client.deleteMany({});
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    await Call.deleteMany({});
    await Reminder.deleteMany({});

    // 1. Ensure Admin User
    const adminEmail = 'admin@crm.com';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      admin = await User.create({
        name: 'Maninder Pal Singh',
        email: adminEmail,
        password: '123456',
        role: 'admin'
      });
    }
    const adminId = admin._id;

    // 2. Create Professional Leads (Clients)
    const clients = await Client.create([
      {
        fullName: 'Arjun Sharma',
        email: 'arjun.sharma@example.com',
        phone: '+91 98765 43210',
        source: 'whatsapp',
        stage: 'interested',
        loanAmount: 8500000,
        propertyValue: 12000000,
        address: 'Sector 44, Gurgaon',
        assignedTo: adminId,
        notes: [{ content: 'High intent buyer. Looking for 20-year term.', createdBy: adminId }]
      },
      {
        fullName: 'Priya Patel',
        email: 'ppatel@outlook.com',
        phone: '+91 91234 56789',
        source: 'facebook',
        stage: 'new_lead',
        loanAmount: 4500000,
        propertyValue: 6000000,
        address: 'Whitefield, Bangalore',
        assignedTo: adminId
      },
      {
        fullName: 'Rajesh Kumar',
        email: 'rajesh.k@gmail.com',
        phone: '+91 88888 77777',
        source: 'email',
        stage: 'documents_received',
        loanAmount: 12000000,
        propertyValue: 15000000,
        address: 'Hauz Khas Village, Delhi',
        assignedTo: adminId,
        notes: [{ content: 'Documents for income verification uploaded. Need to check payslips.', createdBy: adminId }]
      },
      {
        fullName: 'Sonia Malhotra',
        email: 'sonia.m@yahoo.com',
        phone: '+91 77777 66666',
        source: 'instagram',
        stage: 'closed',
        loanAmount: 6000000,
        propertyValue: 8000000,
        address: 'Bandra West, Mumbai',
        assignedTo: adminId
      },
      {
        fullName: 'Vikram Singh',
        email: 'v.singh@corporate.com',
        phone: '+91 99999 00000',
        source: 'website',
        stage: 'approved',
        loanAmount: 25000000,
        propertyValue: 32000000,
        address: 'Jubilee Hills, Hyderabad',
        assignedTo: adminId
      }
    ]);

    // 3. Create Conversations & Messages
    for (const client of clients) {
      if (client.source === 'manual' || client.source === 'website') continue;

      const conv = await Conversation.create({
        client: client._id,
        platform: client.source,
        lastMessage: 'Looking forward to hearing from you.',
        lastMessageAt: new Date(),
        status: client.stage === 'closed' ? 'resolved' : 'open',
        assignedTo: adminId
      });

      // Add dummy messages
      await Message.create([
        {
          conversationId: conv._id,
          sender: 'client',
          content: `Hi, I saw your post about mortgage rates. Can you help me with a quote?`,
          messageType: 'text',
          createdAt: new Date(Date.now() - 86400000)
        },
        {
          conversationId: conv._id,
          sender: 'agent',
          content: `Hello ${client.fullName}! Of course. I'd be happy to help. Are you looking for a new purchase or refinancing?`,
          messageType: 'text',
          sentBy: adminId,
          createdAt: new Date(Date.now() - 43200000)
        },
        {
          conversationId: conv._id,
          sender: 'client',
          content: `I'm looking to buy my first home. My budget is around ${client.loanAmount / 100000} Lakhs.`,
          messageType: 'text',
          createdAt: new Date(Date.now() - 36000000)
        }
      ]);
    }

    // 4. Create Call Logs
    await Call.create([
      {
        client: clients[0]._id,
        direction: 'outbound',
        status: 'answered',
        duration: 345,
        notes: 'Discussed ROI and processing fees. Client is happy with 8.4%.',
        loggedBy: adminId
      },
      {
        client: clients[1]._id,
        direction: 'inbound',
        status: 'missed',
        duration: 0,
        loggedBy: adminId,
        callTime: new Date(Date.now() - 7200000)
      }
    ]);

    // 5. Create Reminders
    await Reminder.create([
      {
        title: 'Review Arjun\'s Bank Statements',
        description: 'Verify the last 6 months of transactions for credit score check.',
        client: clients[0]._id,
        type: 'document',
        dueDate: new Date(Date.now() + 86400000),
        assignedTo: adminId,
        createdBy: adminId
      },
      {
        title: 'Follow up call with Priya',
        description: 'Missed her call earlier. Need to discuss the property requirements.',
        client: clients[1]._id,
        type: 'call',
        dueDate: new Date(Date.now() + 3600000),
        assignedTo: adminId,
        createdBy: adminId
      }
    ]);

    console.log('✅ Professional Dummy Data seeded successfully!');
    process.exit();
  } catch (error) {
    console.error('❌ Error seeding professional data:', error);
    process.exit(1);
  }
};

seedDB();
