const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const Client = require('../models/Client');
const { Conversation, Message } = require('../models/Conversation');

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
      connectionTimeout: 60000,
      greetingTimeout: 60000,
      socketTimeout: 60000
    });
  }

  start() {
    console.log('📬 Email Polling Service Started...');
    this.sync();
    // Poll every 5 minutes (reduced frequency for stability)
    this.timer = setInterval(() => this.sync(), 300000);
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
        
        const startSeq = Math.max(1, totalMessages - 500);
        const range = `${startSeq}:*`;
        
        console.log(`🔍 Scanning range ${range} for new data...`);
        
        const missingUids = [];
        
        // Step 1: Collect UIDs that are not in DB
        for await (let message of currentClient.fetch(range, { uid: true })) {
          const messageUid = `email_${message.uid}`;
          const exists = await Message.exists({ externalId: messageUid });
          if (!exists) {
            missingUids.push(message.uid);
          }
        }
        
        console.log(`ℹ️ Found ${missingUids.length} new emails to process.`);
        
        let messagesProcessed = 0;
        
        // Step 2: Fetch full sources for missing UIDs in batches of 10 to avoid timeouts
        if (missingUids.length > 0) {
          // Process in smaller batches to be safe
          const batchSize = 20;
          for (let i = 0; i < missingUids.length; i += batchSize) {
            const batch = missingUids.slice(i, i + batchSize);
            for await (let message of currentClient.fetch(batch, { source: true, uid: true }, { uid: true })) {
              try {
                const parsed = await simpleParser(message.source);
                await this.processIncomingEmail(parsed, message.uid);
                messagesProcessed++;
              } catch (msgErr) {
                console.error('❌ Error parsing message UID:', message.uid, msgErr.message);
              }
            }
          }
        }
        
        if (messagesProcessed > 0) {
            console.log(`✅ Successfully synced ${messagesProcessed} new emails.`);
        }
        
      } finally {
        lock.release();
      }

      await currentClient.logout();
    } catch (err) {
      console.error('❌ IMAP Sync Cycle Error:', err.message);
      
      if (err.message.includes('AUTHENTICATE failed')) {
         console.error('⚠️ CRITICAL: Authentication failed. Please check your credentials in .env.');
      }
    } finally {
      this.isSyncing = false;
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

      // === SPAM FILTERS DISABLED BY USER REQUEST TO SHOW ALL DATA ===
      /*
      const noReplyKeywords = ['no-reply', 'noreply', 'donotreply', 'updates', 'alerts', 'marketing', 'newsletter', 'hello@', 'info@'];
      if (noReplyKeywords.some(keyword => fromEmail.includes(keyword))) {
        console.log(`⏩ Filtered out system/automated email from ${fromEmail}`);
        return;
      }

      const spamDomains = ['linkedin.com', 'simplilearnmailer.com', 'foundit', 'bayt.com', 'unstop.com', 'naukri.com', 'mailer'];
      if (spamDomains.some(domain => fromEmail.includes(domain))) {
        console.log(`⏩ Filtered out promotional domain email from ${fromEmail}`);
        return;
      }
      */
      // === END SPAM/PROMOTIONAL EMAIL FILTER ===

      let client = await Client.findOne({ email: fromEmail });
      if (!client) {
        client = await Client.create({
          fullName: email.from.value[0].name || fromEmail.split('@')[0],
          email: fromEmail,
          source: 'email',
          stage: 'new_lead'
        });
        console.log(`✨ Created new lead from inbound email: ${fromEmail}`);
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

      const newMessage = await Message.create({
        conversationId: conv._id,
        sender: 'client',
        content: cleanedText,
        messageType: 'email',
        externalId: messageUid
      });

      await Conversation.findByIdAndUpdate(conv._id, {
        lastMessage: cleanedText.substring(0, 100),
        lastMessageAt: new Date(),
        $inc: { unreadCount: 1 }
      });

      const io = this.app.get('io');
      if (io) {
        io.emit('new_message', newMessage); 
        io.to(conv._id.toString()).emit('new_message', newMessage); 
      }

      console.log(`📩 Synced Inbound Email from ${fromEmail}`);
    } catch (err) {
      console.error('❌ Error processing incoming email:', err.message);
    }
  }
}

module.exports = EmailSyncService;
