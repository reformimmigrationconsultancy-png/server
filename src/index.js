const fs = require('fs');
const path = require('path');

// FORCE SET META TOKEN FOR LIVE SERVER (Render) - Commented out to prevent overwriting .env values
// process.env.META_ACCESS_TOKEN = 'EAAfxrZAOI5cUBRtPAFBsNMtUG9NMn1AkvnuxHturfuNQ4JKWZBFSVmUcJ7pywRLSbRnGf2r0i785r6vLjZBw821xmZALflaPSRvCTBeE2j9M2c9DJIfdZAec0A1Y0r5FfU3kfFhV1P1YOQIAx6hanS9IBekCLzubZCcotpBvLc9kD98vFSy2B0fhScw0GN3IfEOdxnaOXZADU8bZBrAVFEQqlaTmZApeFSppxTUw2y6K8cbakkFyaEZAbs9e61JDOzZA6P9fcFXEpWFdKsTIxwZD';
// process.env.META_PAGE_ACCESS_TOKEN = '';

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
const emailTemplatesRoutes = require('./routes/emailTemplates');
const automationsRoutes = require('./routes/automations');
const notificationsRoutes = require('./routes/notifications');


// Connect to MongoDB
connectDB().then(async () => {
  try {
    const Client = require('./models/Client');
    const { Conversation, Message } = require('./models/Conversation');

    // Purge direct chat message contacts, dummy test leads ('Facebook user'), and blank leads with no contact info
    const nonMetaDeleted = await Client.deleteMany({
      $or: [
        { platformContactId: { $exists: true } },
        { fullName: { $regex: /^facebook user$/i } },
        { fullName: { $regex: /^facebook user /i } },
        { 
          $and: [
            { $or: [{ email: { $exists: false } }, { email: null }, { email: '' }, { email: 'N/A' }] },
            { $or: [{ phone: { $exists: false } }, { phone: null }, { phone: '' }, { phone: 'N/A' }] }
          ]
        }
      ]
    });
    // Purge chat messages and conversations
    await Message.deleteMany({});
    await Conversation.deleteMany({});

    if (nonMetaDeleted.deletedCount > 0) {
      console.log(`🧹 [Strict Meta Filter] Purged ${nonMetaDeleted.deletedCount} chat message / blank / test leads.`);
    }

    if (process.env.RESET_OLD_LEADS === 'true') {
      const { Conversation, Message } = require('./models/Conversation');
      const WebhookLog = require('./models/WebhookLog');
      
      const count = await Client.countDocuments();
      await Message.deleteMany({});
      await Conversation.deleteMany({});
      await Client.deleteMany({});
      await WebhookLog.deleteMany({});
      console.log(`🧹 [Startup Reset] Successfully wiped ${count} old leads & conversations for a fresh start!`);
      
      // Update .env to false so it only runs once
      const fs = require('fs');
      const path = require('path');
      const envFile = path.join(__dirname, '..', '.env');
      if (fs.existsSync(envFile)) {
        let content = fs.readFileSync(envFile, 'utf-8');
        content = content.replace(/^RESET_OLD_LEADS=.*$/m, 'RESET_OLD_LEADS=false');
        fs.writeFileSync(envFile, content, 'utf-8');
        process.env.RESET_OLD_LEADS = 'false';
      }
    }
  } catch (wipeErr) {
    console.error('⚠️ [Startup Reset] Wipe error:', wipeErr.message);
  }
});

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
  'http://localhost:5177',
  'http://localhost:5178',
  'http://localhost:5179',
  'http://localhost:5180',
  'http://localhost:5181',
  'http://localhost:5182',
  'http://localhost:8000',
  'https://manpreetcrm.com',
  'https://www.manpreetcrm.com',
  'https://client-16h2.onrender.com', // Explicitly allow new Render frontend domain
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

// Start Automation Engine
const { startEngine, enrollLead, stopAutomationsForLead } = require('./services/automationEngine');
startEngine();

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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
app.use('/api/email-templates', emailTemplatesRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api', messageRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Start Server-Side Reminder Scheduler
const { startScheduler: startReminderScheduler } = require('./services/reminderScheduler');
startReminderScheduler(app);



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
  if (!signature) {
    console.warn('⚠️ [Webhook] Missing x-hub-signature-256 header');
    return false;
  }
  
  if (!req.rawBody) {
    console.error('❌ [Webhook] req.rawBody is missing! Verify middleware might not be capturing raw body.');
    return false;
  }
  
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET || '')
    .update(req.rawBody)
    .digest('hex');
    
  try {
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expectedBuf.length) {
      console.error(`❌ [Webhook] Signature length mismatch. Received len: ${sigBuf.length}, Expected len: ${expectedBuf.length}`);
      return false;
    }
    const match = crypto.timingSafeEqual(sigBuf, expectedBuf);
    if (!match) {
      console.error('❌ [Webhook] Signature mismatch. Check META_APP_SECRET in your .env or environment variables.');
    }
    return match;
  } catch (err) {
    console.error('❌ [Webhook] Error verifying signature:', err.message);
    return false;
  }
}

// Log and check webhook event to prevent duplicates
async function logWebhookEvent(eventId, eventType, platform, payload, status = 'success', errorMessage = null) {
  try {
    const WebhookLog = require('./models/WebhookLog');
    const Client = require('./models/Client');
    if (eventId) {
      const existing = await WebhookLog.findOne({ eventId, status: 'success' });
      // Only skip if the event previously succeeded AND the client actually exists in DB
      if (existing) {
        const rawId = eventId.replace(/^(leadgen_|google_|website_)/, '');
        const clientExists = await Client.findOne({ 
          $or: [{ externalId: eventId }, { externalId: rawId }] 
        });
        if (clientExists) {
          console.log(`ℹ️ [Webhook] Duplicate event skipped (already created): ${eventId}`);
          return { isDuplicate: true };
        }
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
              
              // Check if lead already exists by externalId or email
              let client = await Client.findOne({ externalId: leadgenId });
              
              if (!client && leadDetails.email && leadDetails.email !== '') {
                client = await Client.findOne({ email: leadDetails.email });
              }

              if (!client) {
                 client = await Client.create({
                    fullName: leadDetails.fullName || `Meta Lead ${leadgenId.substring(0, 5)}`,
                    email: leadDetails.email || undefined,
                    phone: leadDetails.phone || undefined,
                    source: 'facebook',
                    externalId: leadgenId,
                    stage: 'new_lead',
                    loanAmount: leadDetails.loanAmount,
                    propertyValue: leadDetails.propertyValue,
                    address: leadDetails.city,
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
                    notes: [{ content: `🎉 Lead generated from Meta Ad (Campaign: ${leadDetails.campaignName || 'Unknown'}, Ad: ${leadDetails.adName || 'Unknown'})` }]
                 });
                 console.log(`✅ [Webhook] Created new client from Meta Ads: ${client.fullName}`);
                 await enrollLead(client);
              } else {
                 console.log(`ℹ️ [Webhook] Lead already exists: ${client.fullName}`);
                 let updated = false;
                 if (!client.externalId) {
                   client.externalId = leadgenId;
                   updated = true;
                 }
                 if (leadDetails.loanAmount && !client.loanAmount) {
                   client.loanAmount = leadDetails.loanAmount;
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

              // Update log status to success
              await WebhookLog.findOneAndUpdate({ eventId }, { status: 'success', errorMessage: null });

              // Emit to Socket.io to notify UI in real time
              const io = app.get('io');
              if (io) {
                io.emit('new_lead', client);
                io.emit('new_client', client);
              }

            } catch (err) {
              console.error('❌ [Webhook] Error processing Lead Ad:', err.message);
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
    await enrollLead(client);

    // Email notifications are automatically handled by the Client model's post-save hook

    // Log the webhook log event
    await WebhookLog.create({
      eventId,
      eventType: 'leadgen',
      platform: 'google',
      payload: req.body,
      status: 'success'
    });

    // Broadcast via socket.io
    const io = app.get('io') || (typeof io !== 'undefined' ? io : null);
    if (io) {
      io.emit('new_lead', client);
      io.emit('new_client', client);
    }

    return res.status(200).json({ status: 'success', clientId: client._id });
  } catch (error) {
    console.error('❌ [Google Webhook] Error processing Google Ads webhook:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// ✅ WEBSITE & EXTERNAL LEAD WEBHOOK INTAKE (Public, CORS enabled)
app.post(['/api/leads/public', '/api/clients/public', '/webhook/website'], async (req, res) => {
  try {
    const Client = require('./models/Client');
    const WebhookLog = require('./models/WebhookLog');

    const body = req.body || {};
    console.log('📡 [Website Lead] Incoming lead submission:', JSON.stringify(body, null, 2));

    const fullName = body.fullName || body.name || `${body.firstName || ''} ${body.lastName || ''}`.trim() || 'Website Visitor';
    const email = (body.email || body.emailAddress || '').trim().toLowerCase();
    const phone = (body.phone || body.phoneNumber || body.mobile || body.contact || '').trim();
    const source = body.source || 'website';
    const message = body.message || body.notes || body.comment || '';
    const city = body.city || body.address || '';
    
    // Parse loan and property amounts
    let loanAmount = body.loanAmount || body.loan_amount || body.amount;
    let propertyValue = body.propertyValue || body.property_value || body.purchasePrice || body.propertyPrice;

    if (loanAmount) loanAmount = parseInt(String(loanAmount).replace(/[^0-9]/g, ''), 10) || undefined;
    if (propertyValue) propertyValue = parseInt(String(propertyValue).replace(/[^0-9]/g, ''), 10) || undefined;

    if (!fullName && !email && !phone) {
      return res.status(400).json({ success: false, message: 'Please provide at least a name, email, or phone number.' });
    }

    const eventId = `website_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Create client in CRM
    const client = await Client.create({
      fullName,
      email: email || undefined,
      phone: phone || undefined,
      source: ['whatsapp', 'facebook', 'instagram', 'email', 'website', 'call', 'manual', 'google'].includes(source) ? source : 'website',
      stage: 'new_lead',
      loanAmount,
      propertyValue,
      address: city || undefined,
      metaData: {
        campaignName: body.campaign || body.campaignName || 'Website Contact Form',
        formName: body.formName || 'Website Landing Page',
        customFields: body.customFields || body,
        webhookTimestamp: new Date()
      },
      notes: message ? [{ content: `📝 Message from website submission:\n${message}` }] : []
    });

    console.log(`✅ [Website Lead] Successfully created client: ${client.fullName} (${client._id})`);
    await enrollLead(client);

    // Log to WebhookLog
    await WebhookLog.create({
      eventId,
      eventType: 'leadgen',
      platform: 'website',
      payload: body,
      status: 'success'
    });

    // Real-time Socket.io broadcast to UI
    const io = app.get('io');
    if (io) {
      io.emit('new_lead', client);
      io.emit('new_client', client);
    }

    return res.status(201).json({
      success: true,
      message: 'Lead received and recorded successfully!',
      clientId: client._id,
      lead: {
        id: client._id,
        fullName: client.fullName,
        source: client.source,
        createdAt: client.createdAt
      }
    });

  } catch (err) {
    console.error('❌ [Website Lead] Error saving lead:', err.message);
    return res.status(500).json({ success: false, message: err.message });
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
      logWebhookEvent(`sig_fail_${Date.now()}`, 'signature_verification', 'facebook', { headers: req.headers, body: req.body }, 'failed', 'Invalid Meta Signature').catch(() => {});
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
         await enrollLead(client);

         // Email notifications are automatically handled by the Client model's post-save hook
      } else {
         // Lead replied, stop automations
         await stopAutomationsForLead(client._id, 'Lead replied via WhatsApp');
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
// API Routes (already defined above)

// Catch-all route for missing APIs
app.get('*', (req, res) => {
  if (req.url.startsWith('/api')) {
    res.status(404).json({ success: false, message: 'API Route not found' });
  } else {
    res.status(404).send('Backend API is running. Client should be hosted separately.');
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

// Meta Leads Auto-Sync Service (Runs in background)
const messenger = require('./services/messenger');
async function runMetaLeadsSync() {
  console.log('🔄 [Auto-Sync Service] Checking Meta Leads & Webhook subscriptions in background...');
  try {
    // Auto-subscribe page to webhooks to ensure continuous real-time delivery
    await messenger.subscribePageToWebhooks().catch(() => {});

    const syncedCount = await messenger.syncHistoricalLeads(app);
    if (syncedCount > 0) {
      console.log(`✅ [Auto-Sync Service] Meta lead sync complete. Synced: ${syncedCount} new leads.`);
    }
  } catch (err) {
    console.error('❌ [Auto-Sync Service] Error during background Meta auto-sync:', err.message);
  }
}

// Start auto-sync on server boot (wait 10 seconds to allow server to fully initialize)
setTimeout(() => {
  runMetaLeadsSync();
  // Run every 10 minutes (600,000 ms)
  setInterval(runMetaLeadsSync, 10 * 60 * 1000);
}, 10000);

// Render 24/7 Keep-Alive Self-Ping Service
const axios = require('axios');
function startSelfPing() {
  const url = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
  if (!url) {
    console.log('⚠️ [Keep-Alive] No RENDER_EXTERNAL_URL or PUBLIC_URL defined in environment. Keep-alive ping skipped.');
    return;
  }
  
  const pingUrl = `${url.replace(/\/$/, '')}/health`;
  console.log(`🚀 [Keep-Alive] Starting 24/7 keep-alive ping service for URL: ${pingUrl}`);
  
  // Ping every 10 minutes (600,000 ms) to keep Render service awake
  setInterval(async () => {
    try {
      console.log(`📡 [Keep-Alive] Sending self-ping to preserve active state...`);
      const response = await axios.get(pingUrl);
      console.log(`✅ [Keep-Alive] Ping successful! Server status: ${response.data?.status || 'OK'}`);
    } catch (err) {
      console.error(`❌ [Keep-Alive] Self-ping failed:`, err.message);
    }
  }, 10 * 60 * 1000);
}

// Start keep-alive service 15 seconds after server boot
setTimeout(startSelfPing, 15000);

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
// Email polling completely disabled. Meta Leads & Ads active.
