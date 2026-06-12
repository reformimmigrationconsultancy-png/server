const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const Client = require('../models/Client');
const { Conversation, Message } = require('../models/Conversation');
const { sendNotificationEmail } = require('../utils/notifications');

/**
 * Service to poll Inbox for new replies and sync them to CRM Conversations
 * Refactored to use ImapFlow for production-ready robust IMAP sync 
 */
class EmailSyncService {
  constructor(app) {
    this.app = app;
    this.isSyncing = false;
  }

  createClient() {
    return new ImapFlow({
      host: process.env.IMAP_HOST || process.env.SMTP_HOST || 'imap.gmail.com',
      port: process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : 993,
      secure: true, // Gmail/Outlook usually require true for 993
      auth: {
        user: process.env.IMAP_USER || process.env.SMTP_USER,
        pass: process.env.IMAP_PASS || process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      },
      logger: false, 
      connectionTimeout: 120000,
      greetingTimeout: 120000,
      socketTimeout: 120000
    });
  }

  start() {
    if (this.timer) return; // Prevent multiple intervals
    console.log('📬 Email Polling Service Started...');
    this.sync();
    // Poll every 5 seconds for ultra-fast real-time inbox synchronization
    this.timer = setInterval(() => this.sync(), 5000);
  }

  async sync() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    
    let currentClient = this.createClient();
    
    currentClient.on('error', (err) => {
      // Ignore socket timeouts in background after logout
      if (err.message.includes('Socket timeout') && !this.isSyncing) return;
      console.error('⚠️ IMAP Background Error:', err.message);
    });

    try {
      await currentClient.connect();
      console.log('✅ IMAP Connected successfully.');
      
      const lock = await currentClient.getMailboxLock('INBOX');
      try {
        const status = await currentClient.status('INBOX', { messages: true });
        const totalMessages = status.messages;
        
        // Scan the last 500 messages for better performance and safety
        const startSeq = Math.max(1, totalMessages - 500);
        const range = `${startSeq}:*`;
        
        console.log(`🔍 Scanning range ${range} for new data...`);
        
        const missingUids = [];
        
        // Step 1: Collect UIDs that are not in DB
        // We fetch UIDs in the range to check which ones we don't have yet
        for await (let message of currentClient.fetch(range, { uid: true })) {
          const messageUid = `email_${message.uid}`;
          const exists = await Message.exists({ externalId: messageUid });
          if (!exists) {
            missingUids.push(message.uid);
          }
        }
        
        if (missingUids.length === 0) {
          console.log('ℹ️ No new emails found.');
        } else {
          console.log(`ℹ️ Found ${missingUids.length} new emails to process.`);
          
          let messagesProcessed = 0;
          const batchSize = 10; // Smaller batches for source fetching to prevent timeouts
          
          for (let i = 0; i < missingUids.length; i += batchSize) {
            const batch = missingUids.slice(i, i + batchSize);
            for await (let message of currentClient.fetch(batch, { source: true, uid: true }, { uid: true })) {
              try {
                const parsed = await simpleParser(message.source);
                await this.processIncomingEmail(parsed, message.uid);
                messagesProcessed++;
              } catch (msgErr) {
                console.error(`❌ Error parsing message UID ${message.uid}:`, msgErr.message);
              }
            }
          }
          
          if (messagesProcessed > 0) {
            console.log(`✅ Successfully synced ${messagesProcessed} new emails.`);
          }
        }
      } catch (err) {
        if (err.message.includes('Connection not available')) {
          console.error('⚠️ IMAP connection lost during sync, will retry next cycle.');
        } else {
          console.error('❌ Error during IMAP operation:', err.message);
        }
      } finally {
        if (lock) lock.release();
      }

      await currentClient.logout().catch(() => {});
    } catch (err) {
      if (err.message.includes('Socket timeout')) {
        console.log('ℹ️ IMAP Sync: Socket timed out (common with Gmail idle connections).');
      } else if (err.message.includes('AUTHENTICATE failed')) {
        console.error('⚠️ CRITICAL: Authentication failed. Please check your credentials in .env.');
      } else {
        console.error('❌ IMAP Sync Cycle Error:', err.message);
      }
    } finally {
      this.isSyncing = false;
      // Ensure the client is destroyed to free up resources
      if (currentClient && currentClient.connection && currentClient.connection.socket) {
        currentClient.connection.socket.destroy();
      }
    }
  }

  async processIncomingEmail(email, uid) {
    try {
      const messageUid = `email_${uid}`;
      
      // Avoid duplicate processing
      const existingMessage = await Message.findOne({ externalId: messageUid });
      if (existingMessage) return;
      if (!email.from || !email.from.value || email.from.value.length === 0) return;
      
      const fromEmail = email.from.value[0].address.toLowerCase();
      const text = email.text || email.textAsHtml || '';

      const noReplyKeywords = [
        'no-reply', 'noreply', 'donotreply', 'updates', 'alerts', 'marketing', 'newsletter', 
        'hello@', 'info@', 'notify', 'catch@', 'businessprofile', 'recommendations@', 'notification@', 'maccount@'
      ];
      if (noReplyKeywords.some(keyword => fromEmail.includes(keyword))) {
        console.log(`⏩ Filtered out system/automated email from ${fromEmail}`);
        return;
      }

      const spamDomains = [
        'linkedin.com', 'simplilearnmailer.com', 'foundit', 'bayt.com', 'unstop.com', 
        'naukri.com', 'mailer', 'tiktok.com', 'pinterest.com', 'ccsend.com', 'facebook.com', 
        'neofinancial.com', 'google.com', 'microsoft.com', 'metamail.com', 'interac.ca', 'openai.com'
      ];
      if (spamDomains.some(domain => fromEmail.includes(domain))) {
        console.log(`⏩ Filtered out promotional domain email from ${fromEmail}`);
        return;
      }

      let client = await Client.findOne({ email: fromEmail });
      if (!client) {
        client = await Client.create({
          fullName: email.from.value[0].name || fromEmail.split('@')[0],
          email: fromEmail,
          source: 'email',
          stage: 'new_lead'
        });
        console.log(`✨ Created new lead from inbound email: ${fromEmail}`);
        
        // Notify about new lead
        // const subject = `🎉 New Lead via Email: ${client.fullName}`;
        // const html = `
        //   <h3>New Lead Created from Inbound Email</h3>
        //   <p><strong>Name:</strong> ${client.fullName}</p>
        //   <p><strong>Email:</strong> ${client.email}</p>
        //   <p>Login to CRM to view more details.</p>
        // `;
        // sendNotificationEmail(subject, 'New lead created via Email.', html);
      }

      let cleanedText = text;
      if (cleanedText.includes('<') && cleanedText.includes('>')) {
        cleanedText = cleanedText.replace(/<[^>]*>?/gm, '');
      }
      cleanedText = cleanedText.split('\n').filter(line => !line.trim().startsWith('>')).join('\n');
      
      const threadMarkers = [
        /\nOn .+, .+, \d{4} at .+/g,
        /\nFrom: .+\nSent: .+/g,
        /\nDe: .+\nEnviado el:.+/g,
        /\n--------- Original Message ---------/g,
        /---+\s*Forwarded message\s*---+/g
      ];
      threadMarkers.forEach(regex => {
        cleanedText = cleanedText.split(regex)[0];
      });
      cleanedText = cleanedText.trim();
      if (!cleanedText) cleanedText = '(No content)';

      let conv = await Conversation.findOne({ client: client._id, platform: 'email', status: 'open' });
      if (!conv) {
        conv = await Conversation.create({
          client: client._id,
          platform: 'email',
          lastMessage: cleanedText.substring(0, 50),
          lastMessageAt: new Date()
        });
      }

      // Handle attachments
      const attachments = [];
      if (email.attachments && email.attachments.length > 0) {
        const uploadDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        for (const attachment of email.attachments) {
          try {
            const filename = `${Date.now()}-${attachment.filename}`;
            const filepath = path.join(uploadDir, filename);
            fs.writeFileSync(filepath, attachment.content);
            
            const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8000}`;
            attachments.push({
              url: `${baseUrl}/uploads/${filename}`,
              filename: attachment.filename,
              mimetype: attachment.contentType
            });
          } catch (attErr) {
            console.error('❌ Error saving attachment:', attErr.message);
          }
        }
      }

      const newMessage = await Message.create({
        conversationId: conv._id,
        sender: 'client',
        content: cleanedText,
        messageType: 'email',
        externalId: messageUid,
        attachments: attachments
      });

      await Conversation.findByIdAndUpdate(conv._id, {
        lastMessage: cleanedText.substring(0, 100),
        lastMessageAt: new Date(),
        $inc: { unreadCount: 1 }
      });

      const io = this.app.get('io');
      if (io) {
        const populatedMessage = await newMessage.populate({
          path: 'conversationId',
          populate: { path: 'client' }
        });
        io.emit('new_message', populatedMessage); 
        io.to(conv._id.toString()).emit('new_message', populatedMessage); 
      }

      console.log(`📩 Synced Inbound Email from ${fromEmail}`);

      // Notify about incoming email message
      // const subject = `📩 New Email from ${client.fullName}`;
      // const html = `
      //   <h3>New Email Message Received</h3>
      //   <p><strong>From:</strong> ${client.fullName} (${client.email})</p>
      //   <p><strong>Message:</strong></p>
      //   <blockquote style="border-left: 4px solid #ccc; padding-left: 10px; color: #555;">
      //     ${cleanedText.substring(0, 500)}${cleanedText.length > 500 ? '...' : ''}
      //   </blockquote>
      //   <p>Login to CRM to reply.</p>
      // `;
      // sendNotificationEmail(subject, 'New email received.', html);
      
    } catch (err) {
      console.error('❌ Error processing incoming email:', err.message);
    }
  }
}

module.exports = EmailSyncService;
