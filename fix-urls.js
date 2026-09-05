require('dotenv').config();
const mongoose = require('mongoose');
const { Conversation, Message } = require('./src/models/Conversation');

async function fixUrls() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI is missing from .env');
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    const targetBase = 'https://manpreetcrm.com';
    console.log(`Normalizing attachment URLs to use: ${targetBase}`);

    // Fetch all messages that have uploads in attachments or content
    const messages = await Message.find({
      $or: [
        { 'attachments.url': { $regex: '/uploads/' } },
        { content: { $regex: '/uploads/' } }
      ]
    });

    console.log(`Found ${messages.length} messages to process...`);
    let updatedCount = 0;

    for (const msg of messages) {
      let modified = false;

      // 1. Fix attachments array
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments = msg.attachments.map(att => {
          if (att.url && att.url.includes('/uploads/')) {
            const filename = att.url.split('/uploads/').pop();
            const newUrl = `${targetBase}/uploads/${filename}`;
            if (att.url !== newUrl) {
              console.log(`🔄 Attachment: ${att.url} ➡️ ${newUrl}`);
              att.url = newUrl;
              modified = true;
            }
          }
          return att;
        });
      }

      // 2. Fix content (if it's an image/media URL)
      if (msg.content && msg.content.includes('/uploads/')) {
        const filename = msg.content.split('/uploads/').pop();
        const newUrl = `${targetBase}/uploads/${filename}`;
        if (msg.content !== newUrl) {
          console.log(`🔄 Content URL: ${msg.content} ➡️ ${newUrl}`);
          msg.content = newUrl;
          modified = true;
        }
      }

      if (modified) {
        // Use markModified for mixed types/subdocuments
        msg.markModified('attachments');
        await msg.save();
        updatedCount++;
      }
    }

    console.log(`✅ URL migration complete! Updated ${updatedCount} messages.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during URL migration:', err.message);
    process.exit(1);
  }
}

fixUrls();
