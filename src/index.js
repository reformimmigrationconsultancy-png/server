const fs = require('fs');
const path = require('path');

const rootEnvPath = path.join(__dirname, '..', '..', '.env');
const serverEnvPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(rootEnvPath)) {
  require('dotenv').config({ path: rootEnvPath });
} else if (fs.existsSync(serverEnvPath)) {
  require('dotenv').config({ path: serverEnvPath });
} else {
  require('dotenv').config();
}

// Sanitize environment variables to prevent copy-paste errors from Render dashboard configurations
Object.keys(process.env).forEach(key => {
  let value = process.env[key];
  if (value && typeof value === 'string') {
    value = value.trim();
    const prefix = `${key}=`;
    if (value.startsWith(prefix)) {
      process.env[key] = value.substring(prefix.length).trim();
      console.log(`🧹 [Env Sanitizer] Cleaned copy-paste prefix from environment variable: ${key}`);
    }
  }
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const conversationRoutes = require('./routes/conversations');
const callRoutes = require('./routes/calls');
const reminderRoutes = require('./routes/reminders');
const dashboardRoutes = require('./routes/dashboard');
const emailRoutes = require('./routes/emails');
const messageRoutes = require('./routes/messages');
const settingsRoutes = require('./routes/settings');


// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);

// Middleware to log requests and strip /lead prefix if present
app.use((req, res, next) => {
  console.log(`🔍 [REQUEST] ${req.method} ${req.url}`);

  // Strip /lead prefix for internal routing if it exists
  if (req.url.startsWith('/lead')) {
    req.url = req.url.replace(/^\/lead/, '') || '/';
  }
  next();
});

// Socket.io setup
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:8000',
  'https://manpreetcrm.com',
  'https://www.manpreetcrm.com',
  process.env.CLIENT_URL,
  process.env.PUBLIC_URL
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

app.set('io', io);

// Middleware
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Serve React static frontend assets
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Image Upload Logic (Simple)
const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
  
  // Always derive base URL from request to avoid using an unresolvable PUBLIC_URL
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;
  
  res.json({ success: true, url: fileUrl });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api', messageRoutes);
app.use('/api/settings', settingsRoutes);



// Webhook — WhatsApp (verify)
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ✅ FACEBOOK WEBHOOK VERIFY
app.get('/webhook/facebook', (req, res) => {
  console.log('📡 [Webhook] Incoming verification request:', req.query);
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "manpreet";

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ [Webhook] Verified successfully!');
    return res.status(200).send(challenge);
  } else {
    console.error(`❌ [Webhook] Verification failed. Expected: ${VERIFY_TOKEN}, Received: ${token}`);
    return res.sendStatus(403);
  }
});

// Meta Signature Verification
const crypto = require('crypto');
function verifyMetaSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET || '')
    .update(req.rawBody)
    .digest('hex');
    
  try {
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch (err) {
    return false;
  }
}

// Log and check webhook event to prevent duplicates
async function logWebhookEvent(eventId, eventType, platform, payload, status = 'success', errorMessage = null) {
  try {
    const WebhookLog = require('./models/WebhookLog');
    if (eventId) {
      const existing = await WebhookLog.findOne({ eventId });
      if (existing) {
        console.log(`ℹ️ [Webhook] Duplicate event skipped: ${eventId}`);
        return { isDuplicate: true };
      }
    }
    await WebhookLog.create({
      eventId,
      eventType,
      platform,
      payload,
      status,
      errorMessage
    });
    return { isDuplicate: false };
  } catch (err) {
    console.error('❌ [WebhookLog] Failed to log webhook event:', err.message);
    return { isDuplicate: false };
  }
}

async function processFacebookWebhook(body, app) {
  const WebhookLog = require('./models/WebhookLog');
  
  // Check if this is an event from a page or instagram subscription
  if (body.object === 'page' || body.object === 'instagram') {
    for (const entry of body.entry) {
      // --- 1. HANDLE LEAD ADS ---
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'leadgen') {
            const leadgenId = change.value.leadgen_id;
            console.log(`✨ [Webhook] New Meta Lead detected! ID: ${leadgenId}`);

            const eventId = `leadgen_${leadgenId}`;
            const logResult = await logWebhookEvent(eventId, 'leadgen', 'facebook', change.value);
            
            if (logResult.isDuplicate) {
              // Log the duplicate skip separately
              await WebhookLog.create({
                eventId: `${eventId}_dup_${Date.now()}`,
                eventType: 'leadgen',
                platform: 'facebook',
                payload: change.value,
                status: 'duplicate',
                errorMessage: 'Skipped processing: duplicate webhook leadgen ID'
              });
              continue;
            }

            try {
              const messenger = require('./services/messenger');
              const leadDetails = await messenger.getLeadDetails(leadgenId);

              const Client = require('./models/Client');
              
              // Check if lead already exists by externalId
              let client = await Client.findOne({ externalId: leadgenId });
              
              if (!client) {
                // Fallback: check by email if provided
                if (leadDetails.email && leadDetails.email !== '') {
                  client = await Client.findOne({ email: leadDetails.email });
                }
              }

              if (!client) {
                 client = await Client.create({
                    fullName: leadDetails.fullName || `Meta Lead ${leadgenId.substring(0, 5)}`,
                    email: leadDetails.email,
                    phone: leadDetails.phone,
                    source: 'facebook',
                    externalId: leadgenId,
                    stage: 'new_lead',
                    metaData: {
                      campaignName: leadDetails.campaignName,
                      adSetName: leadDetails.adSetName,
                      adName: leadDetails.adName,
                      pageName: leadDetails.pageName || 'Facebook Page',
                      formName: leadDetails.formName || 'Lead Ad',
                      customFields: leadDetails.customFields || {},
                      rawData: leadDetails.rawData,
                      webhookTimestamp: new Date()
                    },
                    notes: [{ content: `Lead generated from Meta Ad (Campaign: ${leadDetails.campaignName || 'Unknown'}, Ad: ${leadDetails.adName || 'Unknown'})` }]
                 });
                 console.log(`✅ [Webhook] Created new client from Meta Ads: ${client.fullName}`);
              } else {
                 console.log(`ℹ️ [Webhook] Lead already exists: ${client.fullName}`);
                 let updated = false;
                 if (!client.externalId) {
                   client.externalId = leadgenId;
                   updated = true;
                 }
                 if (!client.metaData?.customFields && leadDetails.customFields) {
                   if (!client.metaData) client.metaData = {};
                   client.metaData.customFields = leadDetails.customFields;
                   updated = true;
                 }
                 if (updated) {
                   await client.save();
                 }
              }

              // Emit to Socket.io to notify UI
              const io = app.get('io');
              if (io) io.emit('new_lead', client);

            } catch (err) {
              console.error('❌ [Webhook] Error processing Lead Ad:', err.message);
              await WebhookLog.findOneAndUpdate({ eventId }, { status: 'failed', errorMessage: err.message });
            }
          }
        }
      }

      // --- 2. HANDLE MESSAGES (Messaging) ---
      if (entry.messaging) {
        for (const webhook_event of entry.messaging) {
          const senderId = webhook_event.sender.id;
          const recipientId = webhook_event.recipient.id;
          const message = webhook_event.message;
          const timestamp = webhook_event.timestamp;

          // Determine platform and page ID
          const platform = body.object === 'instagram' ? 'instagram' : 'facebook';
          const pageId = platform === 'instagram' 
            ? (process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || recipientId) 
            : (process.env.FB_PAGE_ID || recipientId);

          // Skip if sender is the page itself (outbound message echo)
          if (senderId === pageId) {
            console.log(`ℹ️ [Webhook] Skipping echo message from ${platform} Page ${senderId}`);
            continue;
          }

          console.log(`📩 [Webhook] ${platform.toUpperCase()} Incoming from ${senderId}:`, message?.text);

          if (message) {
            const messageId = message.mid;
            const eventId = `msg_${messageId}`;

            const logResult = await logWebhookEvent(eventId, 'messaging', platform, webhook_event);
            if (logResult.isDuplicate) {
              await WebhookLog.create({
                eventId: `${eventId}_dup_${Date.now()}`,
                eventType: 'messaging',
                platform,
                payload: webhook_event,
                status: 'duplicate',
                errorMessage: 'Skipped processing: duplicate message ID'
              });
              continue;
            }

            try {
              const text = message.text || (message.attachments ? `[${message.attachments[0].type.toUpperCase()}]` : '');
              const attachments = message.attachments?.map(att => ({
                url: att.payload?.url || att.url,
                mimetype: att.type === 'image' ? 'image/jpeg' : 'application/octet-stream',
                filename: `fb_attachment_${Date.now()}`
              })) || [];

              const Client = require('./models/Client');
              const { Conversation, Message: MessageModel } = require('./models/Conversation');

              // 1. Find or create client
              let client = await Client.findOne({ platformContactId: senderId });
              if (!client) {
                 client = await Client.create({
                    fullName: `${platform === 'instagram' ? 'IG' : 'FB'} User ${senderId.substring(0, 5)}`,
                    platformContactId: senderId,
                    source: platform,
                    stage: 'new_lead'
                 });
              }

              // 2. Find or create conversation
              let conv = await Conversation.findOne({ 
                platformContactId: senderId, 
                platform: platform, 
                status: { $ne: 'archived' } 
              });
              
              if (!conv) {
                 conv = await Conversation.create({
                    client: client._id,
                    platform: platform,
                    platformContactId: senderId,
                    lastMessage: text,
                    lastMessageAt: new Date(timestamp)
                 });
              }

              // 3. Save message (with deduplication)
              let newMessage = await MessageModel.findOne({ externalId: message.mid });
              
              if (!newMessage) {
                newMessage = await MessageModel.create({
                   conversationId: conv._id,
                   sender: 'client',
                   content: text,
                   messageType: attachments.length > 0 ? (message.attachments[0].type === 'image' ? 'image' : 'document') : 'text',
                   attachments: attachments,
                   externalId: message.mid,
                   createdAt: new Date(timestamp)
                });

                // 4. Update conversation
                await Conversation.findByIdAndUpdate(conv._id, {
                   lastMessage: text,
                   lastMessageAt: new Date(timestamp),
                   status: 'open',
                   $inc: { unreadCount: 1 }
                });

                // 5. Emit to Socket.io
                const io = app.get('io');
                if (io) {
                  const populated = await newMessage.populate({
                    path: 'conversationId',
                    populate: { path: 'client' }
                  });
                  io.emit('new_message', populated); 
                  io.to(conv._id.toString()).emit('new_message', populated);
                }
                
                console.log(`✅ [Webhook] Processed message from ${senderId}`);
              }
            } catch (err) {
              console.error('❌ [Webhook] Error processing Messaging:', err.message);
              await WebhookLog.findOneAndUpdate({ eventId }, { status: 'failed', errorMessage: err.message });
            }
          }
        }
      }
    }
  }
}

// ✅ GOOGLE ADS WEBHOOK RECEIVER
app.post('/webhook/google', async (req, res) => {
  const WebhookLog = require('./models/WebhookLog');
  const Client = require('./models/Client');

  try {
    console.log('📡 [Google Webhook] Incoming lead from Google Ads:', JSON.stringify(req.body, null, 2));

    const { lead_id, google_key, user_column_data, campaign_id, form_id, is_test } = req.body;

    // Security check: Match Google Webhook Key
    const expectedKey = process.env.GOOGLE_WEBHOOK_KEY || 'manpreet_google_key';
    if (google_key !== expectedKey) {
      console.error(`❌ [Google Webhook] Security Key mismatch. Expected: ${expectedKey}, Received: ${google_key}`);
      return res.status(403).json({ error: 'Security Key mismatch' });
    }

    if (!lead_id) {
      console.error('❌ [Google Webhook] Missing lead_id in payload');
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    // Avoid duplicates
    const eventId = `google_${lead_id}`;
    const existing = await WebhookLog.findOne({ eventId });
    if (existing) {
      console.log(`ℹ️ [Google Webhook] Duplicate lead event skipped: ${eventId}`);
      return res.status(200).json({ status: 'success', message: 'Duplicate lead skipped' });
    }

    // Parse Google User Column Data
    let fullName = 'Google User';
    let email = '';
    let phone = '';
    const customFields = {};

    if (Array.isArray(user_column_data)) {
      user_column_data.forEach(item => {
        const name = item.column_name || '';
        const value = item.string_value || '';
        const id = item.column_id || '';

        const normId = id.toUpperCase();
        const normName = name.toLowerCase();

        if (normId === 'FULL_NAME' || normId === 'NAME' || normId === 'FIRST_NAME' || normName.includes('name')) {
          fullName = value;
        } else if (normId === 'EMAIL' || normName.includes('email')) {
          email = value;
        } else if (normId === 'PHONE_NUMBER' || normName.includes('phone')) {
          phone = value;
        } else {
          customFields[name] = value;
        }
      });
    }

    // Map loan details if present in custom fields
    let loanAmount = undefined;
    let propertyValue = undefined;

    Object.keys(customFields).forEach(k => {
      const val = String(customFields[k]).replace(/[^0-9]/g, '');
      const num = parseInt(val, 10);
      if (!isNaN(num)) {
        if (k.toLowerCase().includes('loan') || k.toLowerCase().includes('amount')) {
          loanAmount = num;
        } else if (k.toLowerCase().includes('property') || k.toLowerCase().includes('value') || k.toLowerCase().includes('purchase')) {
          propertyValue = num;
        }
      }
    });

    if (is_test) {
      fullName = `Google User TEST_${fullName === 'Google User' ? '' : fullName}`;
    }

    // Create new Client
    const clientData = {
      fullName,
      email: email || `google_lead_${lead_id}@example.com`,
      phone: phone || '',
      source: 'google',
      externalId: lead_id,
      stage: 'new_lead',
      loanAmount,
      propertyValue,
      metaData: {
        campaignName: `Google Campaign (ID: ${campaign_id || 'Unknown'})`,
        formName: `Google Form (ID: ${form_id || 'Unknown'})`,
        customFields,
        rawData: req.body,
        webhookTimestamp: new Date()
      },
      notes: [{
        content: `📈 Live Lead generated from Google Ads Form.\nCampaign ID: ${campaign_id || 'N/A'}\nForm ID: ${form_id || 'N/A'}`
      }]
    };

    const client = await Client.create(clientData);
    console.log(`✅ [Google Webhook] Successfully created new Google Ads lead: ${client.fullName} (ID: ${client._id})`);

    // Log the webhook log event
    await WebhookLog.create({
      eventId,
      eventType: 'leadgen',
      platform: 'google',
      payload: req.body,
      status: 'success'
    });

    // Broadcast via socket.io
    if (typeof io !== 'undefined') {
      io.emit('new_client', client);
    }

    return res.status(200).json({ status: 'success', clientId: client._id });
  } catch (error) {
    console.error('❌ [Google Webhook] Error processing Google Ads webhook:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ✅ FACEBOOK WEBHOOK RECEIVE MESSAGE
app.post('/webhook/facebook', (req, res) => {
  // 1. Instantly return 200 OK to prevent Meta from timing out and resending
  res.status(200).send('EVENT_RECEIVED');

  // 2. Validate Signature if SECRET is available
  if (process.env.META_APP_SECRET && req.headers['x-hub-signature-256']) {
    if (!verifyMetaSignature(req)) {
      console.error('❌ [Webhook] Invalid Meta Signature');
      return; // Stop processing
    }
  }

  // 3. Process payload asynchronously
  const body = req.body;
  console.log('📡 [Webhook] Received Facebook/Instagram POST request asynchronously');
  
  processFacebookWebhook(body, app).catch(err => {
    console.error('❌ [Webhook] Facebook Webhook Async Error:', err.message);
  });
});

// Incoming Webhook (Actual WhatsApp Messages)
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from; // Phone number
      const text = message.text?.body;
      const userName = value?.contacts?.[0]?.profile?.name || 'New WhatsApp Lead';

      // 1. Find or create client
      const Client = require('./models/Client');
      const { Conversation, Message } = require('./models/Conversation');

      let client = await Client.findOne({ phone: { $regex: from } });
      if (!client) {
         client = await Client.create({
            fullName: userName,
            phone: from,
            source: 'whatsapp',
            stage: 'new_lead'
         });
         console.log(`✨ Created new client from WhatsApp: ${userName}`);
      }

      // 2. Find or create conversation
      let conv = await Conversation.findOne({ client: client._id, platform: 'whatsapp', status: 'open' });
      if (!conv) {
         conv = await Conversation.create({
            client: client._id,
            platform: 'whatsapp',
            lastMessage: text,
            lastMessageAt: new Date()
         });
      }

      // 3. Save message
      const newMessage = await Message.create({
         conversationId: conv._id,
         sender: 'client',
         content: text,
         messageType: 'text'
      });

      // 4. Update conversation unread count and last message
      await Conversation.findByIdAndUpdate(conv._id, {
         lastMessage: text,
         lastMessageAt: new Date(),
         $inc: { unreadCount: 1 }
      });

      // 5. Emit to agent via Socket.io
      const io = app.get('io');
      io.emit('new_message', newMessage); // Broadcast to global feed
      io.to(conv._id.toString()).emit('new_message', newMessage); // Specific room
      
      console.log(`📩 Incoming WhatsApp from ${from}: ${text}`);
    }

    res.sendStatus(200);
  } catch(err) {
    console.error('❌ WhatsApp Webhook Error:', err.message);
    res.sendStatus(500);
  }
});



// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));


// --- PRODUCTION SETUP ---
// Serve static files from the React app build
app.use(express.static(path.join(__dirname, '../../client/dist')));

// API Routes (already defined above)

// Catch-all route to serve the React index.html for SPA routing
app.get('*', (req, res) => {
  // Only serve index.html if it's not an API route (which start with /api)
  if (!req.url.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  } else {
    res.status(404).json({ success: false, message: 'API Route not found' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' });
});

// Socket.io events
io.on('connection', (socket) => {
  console.log(`⚡ Socket connected: ${socket.id}`);

  socket.on('join_conversation', (conversationId) => {
    socket.join(conversationId);
  });

  socket.on('leave_conversation', (conversationId) => {
    socket.leave(conversationId);
  });

  socket.on('typing', ({ conversationId, userId }) => {
    socket.to(conversationId).emit('typing', { userId });
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// IMAP Sync (Incoming Email Service)
const EmailSyncService = require('./services/emailSync');
const emailSync = new EmailSyncService(app);
emailSync.start();


const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  
  // Background Auto-Sync (Every 15 seconds for real-time delivery)
  // This keeps the CRM updated in near real-time even without webhooks or manual sync clicks
  setInterval(async () => {
    try {
      const messenger = require('./services/messenger');
      await messenger.syncAll(app);
    } catch (err) {
      console.error('❌ [Background Sync] Error:', err.message);
    }
  }, 5000); // 5 seconds
});
// Trigger nodemon restart: Meta Ads fully configured and active with permanent page token.




