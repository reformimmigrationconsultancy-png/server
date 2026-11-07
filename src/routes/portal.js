const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Setup Multer for secure customer uploads (PDF, DOCX, JPG, PNG up to 15MB)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const clientId = req.clientId || 'portal_temp_' + Date.now();
    const dir = path.join(__dirname, '../../uploads/documents', String(clientId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeBaseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `${safeBaseName}_${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|pdf|doc|docx/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowed.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPG, PNG, and DOC files are allowed'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter
});

/**
 * 1. GET /api/portal/intake/:token
 * Public endpoint: Retrieves client information using unique unguessable token
 */
router.get('/intake/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Invalid token' });
    }

    const client = await Client.findOne({ portalToken: token, isArchived: { $ne: true } })
      .select('fullName email phone address city state postalCode country visaDetails portalStatus portalSubmittedAt documents loanAmount');

    if (!client) {
      return res.status(404).json({ success: false, message: 'Portal link is invalid or has expired' });
    }

    res.json({
      success: true,
      client: {
        _id: client._id,
        fullName: client.fullName,
        email: client.email || '',
        phone: client.phone || '',
        address: client.address || '',
        city: client.city || '',
        state: client.state || '',
        postalCode: client.postalCode || '',
        country: client.country || 'India',
        visaDetails: client.visaDetails || {},
        portalStatus: client.portalStatus || 'pending',
        portalSubmittedAt: client.portalSubmittedAt,
        documentCount: client.documents?.length || 0
      }
    });
  } catch (error) {
    console.error('Error fetching portal intake:', error);
    res.status(500).json({ success: false, message: 'Server error loading portal' });
  }
});

/**
 * 2. POST /api/portal/intake/:token
 * Public endpoint: Submits updated Visa details & uploads documents for existing lead
 */
router.post('/intake/:token', (req, res, next) => {
  // Pre-find client to set upload directory
  Client.findOne({ portalToken: req.params.token })
    .then(c => {
      if (c) req.clientId = c._id;
      next();
    })
    .catch(next);
}, upload.array('files', 10), async (req, res) => {
  try {
    const { token } = req.params;
    const client = await Client.findOne({ portalToken: token });

    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found or invalid token' });
    }

    const body = req.body || {};
    
    // Parse nested visaDetails if sent as string or object
    let visaDetails = {};
    if (typeof body.visaDetails === 'string') {
      try {
        visaDetails = JSON.parse(body.visaDetails);
      } catch (e) {
        visaDetails = {};
      }
    } else if (typeof body.visaDetails === 'object') {
      visaDetails = body.visaDetails;
    }

    // Merge direct fields into visaDetails if provided flat
    visaDetails = {
      ...client.visaDetails,
      ...visaDetails,
      visaType: body.visaType || visaDetails.visaType || client.visaDetails?.visaType,
      targetCountry: body.targetCountry || visaDetails.targetCountry || client.visaDetails?.targetCountry,
      dob: body.dob || visaDetails.dob,
      gender: body.gender || visaDetails.gender,
      passportNumber: body.passportNumber || visaDetails.passportNumber,
      passportExpiry: body.passportExpiry || visaDetails.passportExpiry,
      highestEducation: body.highestEducation || visaDetails.highestEducation,
      fieldOfStudy: body.fieldOfStudy || visaDetails.fieldOfStudy,
      passingYear: body.passingYear || visaDetails.passingYear,
      percentageOrCgpa: body.percentageOrCgpa || visaDetails.percentageOrCgpa,
      englishTest: body.englishTest || visaDetails.englishTest,
      overallScore: body.overallScore || visaDetails.overallScore,
      workExperienceYears: body.workExperienceYears || visaDetails.workExperienceYears,
      currentJobTitle: body.currentJobTitle || visaDetails.currentJobTitle,
      hasVisaRefusal: body.hasVisaRefusal || visaDetails.hasVisaRefusal,
      refusalDetails: body.refusalDetails || visaDetails.refusalDetails,
      budgetOrFunds: body.budgetOrFunds || visaDetails.budgetOrFunds,
      comments: body.comments || visaDetails.comments
    };

    // Update client basic info
    if (body.fullName) client.fullName = body.fullName.trim();
    if (body.email) client.email = body.email.trim().toLowerCase();
    if (body.phone) client.phone = body.phone.trim();
    if (body.address) client.address = body.address.trim();
    if (body.city) client.city = body.city.trim();
    if (body.state) client.state = body.state.trim();
    if (body.postalCode) client.postalCode = body.postalCode.trim();
    if (body.country) client.country = body.country.trim();

    client.visaDetails = visaDetails;
    client.portalStatus = 'submitted';
    client.portalSubmittedAt = new Date();

    // Auto move stage to 'documents_received' or 'interested'
    if (client.stage === 'new_lead' || client.stage === 'contacted') {
      client.stage = 'documents_received';
    }

    // Process uploaded documents
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        client.documents.push({
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          uploadedAt: new Date()
        });
      });
    }

    // Add note to client history
    client.notes.push({
      content: `📋 Client submitted complete Visa Intake Form for [${visaDetails.targetCountry || 'Abroad'}] - [${visaDetails.visaType || 'Visa'}] with ${req.files?.length || 0} document(s).`,
      createdAt: new Date()
    });

    await client.save();

    // Emit real-time Socket.IO event to all admins
    try {
      const io = req.app.get('io') || global.io;
      if (io) {
        io.emit('new_intake_submission', {
          clientId: client._id,
          fullName: client.fullName,
          visaType: visaDetails.visaType,
          targetCountry: visaDetails.targetCountry,
          submittedAt: client.portalSubmittedAt
        });
        io.emit('update_lead', client);
        io.emit('update_client', client);
      }
    } catch (e) {
      console.error('Socket emit error:', e);
    }

    res.json({
      success: true,
      message: 'Your information and documents have been securely received.',
      clientId: client._id
    });
  } catch (error) {
    console.error('Error submitting intake:', error);
    res.status(500).json({ success: false, message: error.message || 'Submission failed' });
  }
});

/**
 * 3. POST /api/portal/public-apply
 * Public endpoint: For new prospects to apply directly from public intake link
 */
router.post('/public-apply', upload.array('files', 10), async (req, res) => {
  try {
    const body = req.body || {};
    const fullName = (body.fullName || '').trim();
    const phone = (body.phone || '').trim();
    const email = (body.email || '').trim().toLowerCase();

    if (!fullName) {
      return res.status(400).json({ success: false, message: 'Full Name is required' });
    }
    if (!phone && !email) {
      return res.status(400).json({ success: false, message: 'Please provide either a phone number or email address' });
    }

    let visaDetails = {};
    if (typeof body.visaDetails === 'string') {
      try { visaDetails = JSON.parse(body.visaDetails); } catch (e) {}
    } else if (typeof body.visaDetails === 'object') {
      visaDetails = body.visaDetails;
    }

    visaDetails = {
      visaType: body.visaType || visaDetails.visaType || 'Study Visa',
      targetCountry: body.targetCountry || visaDetails.targetCountry || 'Canada',
      dob: body.dob || visaDetails.dob,
      gender: body.gender || visaDetails.gender,
      passportNumber: body.passportNumber || visaDetails.passportNumber,
      passportExpiry: body.passportExpiry || visaDetails.passportExpiry,
      highestEducation: body.highestEducation || visaDetails.highestEducation,
      fieldOfStudy: body.fieldOfStudy || visaDetails.fieldOfStudy,
      passingYear: body.passingYear || visaDetails.passingYear,
      percentageOrCgpa: body.percentageOrCgpa || visaDetails.percentageOrCgpa,
      englishTest: body.englishTest || visaDetails.englishTest,
      overallScore: body.overallScore || visaDetails.overallScore,
      workExperienceYears: body.workExperienceYears || visaDetails.workExperienceYears,
      currentJobTitle: body.currentJobTitle || visaDetails.currentJobTitle,
      hasVisaRefusal: body.hasVisaRefusal || visaDetails.hasVisaRefusal,
      refusalDetails: body.refusalDetails || visaDetails.refusalDetails,
      budgetOrFunds: body.budgetOrFunds || visaDetails.budgetOrFunds,
      comments: body.comments || visaDetails.comments
    };

    const newClient = new Client({
      fullName,
      email: email || undefined,
      phone: phone || undefined,
      source: 'portal',
      stage: 'new_lead',
      address: body.address || '',
      city: body.city || '',
      state: body.state || '',
      postalCode: body.postalCode || '',
      country: body.country || 'India',
      visaDetails,
      portalStatus: 'submitted',
      portalSubmittedAt: new Date(),
      portalToken: crypto.randomBytes(16).toString('hex')
    });

    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        newClient.documents.push({
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          uploadedAt: new Date()
        });
      });
    }

    newClient.notes.push({
      content: `🎯 New Application received from Public Visa Portal: [${visaDetails.targetCountry}] [${visaDetails.visaType}] with ${req.files?.length || 0} document(s).`,
      createdAt: new Date()
    });

    await newClient.save();

    // Real-time broadcast
    try {
      const io = req.app.get('io') || global.io;
      if (io) {
        io.emit('new_lead', newClient);
      }
    } catch (e) {}

    res.json({
      success: true,
      message: 'Application submitted successfully! Our immigration counselor will contact you soon.',
      clientId: newClient._id,
      portalToken: newClient.portalToken
    });
  } catch (error) {
    console.error('Error submitting public application:', error);
    res.status(500).json({ success: false, message: error.message || 'Submission error' });
  }
});

/**
 * 4. GET /api/portal/client/:id/link
 * Protected endpoint: Returns the full shareable portal link for a lead
 */
router.get('/client/:id/link', protect, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    if (!client.portalToken) {
      client.portalToken = crypto.randomBytes(16).toString('hex');
      await client.save();
    }

    res.json({
      success: true,
      portalToken: client.portalToken,
      portalStatus: client.portalStatus || 'pending',
      portalSubmittedAt: client.portalSubmittedAt
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

