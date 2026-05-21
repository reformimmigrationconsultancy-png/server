require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./src/models/Client');
const { Conversation, Message } = require('./src/models/Conversation');

async function fixUrls() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const oldDomains = [
      'journalist-vacation-killing-playstation.trycloudflare.com',
      'iso-brook-markers-almost.trycloudflare.com'
    ];
    const newDomain = new URL(process.env.PUBLIC_URL).host;

    console.log(`Fixing URLs: Replacing ${oldDomains.join(', ')} with ${newDomain}`);

    // 1. Fix Client documents
    const clients = await Client.find({ 'documents.filename': { $exists: true } });
    let clientCount = 0;
    for (const client of clients) {
      let modified = false;
      client.documents = client.documents.map(doc => {
        if (doc.filename) {
          oldDomains.forEach(old => {
            if (doc.filename.includes(old)) {
              doc.filename = doc.filename.replace(old, newDomain);
              modified = true;
            }
          });
        }
        return doc;
      });
      if (modified) {
        await client.save();
        clientCount++;
      }
    }
    console.log(`Updated ${clientCount} clients`);

    // 2. Fix Messages
    const messages = await Message.find({ 'attachments.url': { $exists: true } });
    let messageCount = 0;
    for (const msg of messages) {
      let modified = false;
      msg.attachments = msg.attachments.map(att => {
        if (att.url) {
          oldDomains.forEach(old => {
            if (att.url.includes(old)) {
              att.url = att.url.replace(old, newDomain);
              modified = true;
            }
          });
        }
        return att;
      });
      if (modified) {
        await msg.save();
        messageCount++;
      }
    }
    console.log(`Updated ${messageCount} messages`);

    console.log('✅ All URLs updated successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error fixing URLs:', err);
    process.exit(1);
  }
}

fixUrls();
