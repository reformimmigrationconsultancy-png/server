const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });
const Client = require('../src/models/Client');
const { Conversation, Message } = require('../src/models/Conversation');

async function clean() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    const clients = await Client.find({ source: 'email' });
    console.log(`Found ${clients.length} email clients to delete.`);

    for (const c of clients) {
      const convos = await Conversation.find({ client: c._id });
      const convoIds = convos.map(cv => cv._id);
      
      if (convoIds.length > 0) {
        await Message.deleteMany({ conversationId: { $in: convoIds } });
        await Conversation.deleteMany({ client: c._id });
      }
      
      await Client.deleteOne({ _id: c._id });
      console.log('Deleted client and convos for:', c.email);
    }

    console.log('Done cleaning spam emails.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

clean();
