require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const conversationRoutes = require('./routes/conversations');
const callRoutes = require('./routes/calls');
const reminderRoutes = require('./routes/reminders');
const dashboardRoutes = require('./routes/dashboard');
const emailRoutes = require('./routes/emails');
const messageRoutes = require('./routes/messages');


// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);

// Middleware to strip /lead prefix if the app is hosted under a subpath
app.use((req, res, next) => {
  if (req.url.startsWith('/lead/')) {
    req.url = req.url.replace(/^\/lead/, '');
  } else if (req.url === '/lead') {
    req.url = '/';
  }
  next();
});

// Socket.io setup
const allowedOrigins = process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:8000'];

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
  
  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
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
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "mycrm123";

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Facebook Webhook Verified');
    return res.status(200).send(challenge);
  } else {
    console.error('❌ Facebook Webhook Verification Failed');
    return res.sendStatus(403);
  }
});

// ✅ FACEBOOK WEBHOOK RECEIVE MESSAGE
app.post('/webhook/facebook', async (req, res) => {
  try {
    const body = req.body;

    // Check if this is an event from a page or instagram subscription
    if (body.object === 'page' || body.object === 'instagram') {
      for (const entry of body.entry) {
        // Gets the body of the webhook event
        const webhook_event = entry.messaging?.[0];
        if (!webhook_event) continue;

        const senderId = webhook_event.sender.id;
        const message = webhook_event.message;
        const timestamp = webhook_event.timestamp;

        // Skip if sender is the page itself (outbound message echo)
        if (senderId === process.env.FB_PAGE_ID) {
           console.log(`ℹ️ [Webhook] Skipping echo message from Page ${senderId}`);
           continue;
        }

        console.log(`📩 Incoming FB Message from ${senderId}:`, message?.text);

        if (message && message.text) {
          const text = message.text;

          const platform = body.object === 'instagram' ? 'instagram' : 'facebook';

          // 1. Find or create client
          const Client = require('./models/Client');
          const { Conversation, Message } = require('./models/Conversation');

          let client = await Client.findOne({ platformContactId: senderId });
          if (!client) {
             client = await Client.create({
                fullName: `${platform === 'instagram' ? 'IG' : 'FB'} User ${senderId.substring(0, 5)}`,
                platformContactId: senderId,
                source: platform,
                stage: 'new_lead'
             });
             console.log(`✨ Created new client from ${platform}: ${client.fullName}`);
          }

          // 2. Find or create conversation
          let conv = await Conversation.findOne({ platformContactId: senderId, platform: platform, status: { $ne: 'archived' } });
          if (!conv) {
             conv = await Conversation.create({
                client: client._id,
                platform: platform,
                platformContactId: senderId,
                lastMessage: text,
                lastMessageAt: new Date(timestamp)
             });
          }

          // 3. Save message
          const newMessage = await Message.create({
             conversationId: conv._id,
             sender: 'client',
             content: text,
             messageType: 'text',
             externalId: message.mid,
             createdAt: new Date(timestamp)
          });

          // 4. Update conversation
          await Conversation.findByIdAndUpdate(conv._id, {
             lastMessage: text,
             lastMessageAt: new Date(timestamp),
             $inc: { unreadCount: 1 }
          });

          // 5. Emit to Socket.io
          const io = app.get('io');
          const populatedMessage = await newMessage.populate({
            path: 'conversationId',
            populate: { path: 'client' }
          });
          
          io.emit('new_message', newMessage); // Global broadcast
          io.to(conv._id.toString()).emit('new_message', newMessage); // Room broadcast
          
          console.log(`✅ FB Message processed and emitted: ${text}`);
        }
      }
      res.status(200).send('EVENT_RECEIVED');
    } else {
      res.sendStatus(404);
    }
  } catch (err) {
    console.error('❌ Facebook Webhook Error:', err.message);
    res.sendStatus(500);
  }
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
app.get('/', (req, res) => res.send('Server running'));
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
});

