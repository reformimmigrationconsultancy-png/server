const express = require('express');
const router = express.Router();
const { protect: auth } = require('../middleware/auth');
const EmailTemplate = require('../models/EmailTemplate');
const Automation = require('../models/Automation');
const Client = require('../models/Client');
const nodemailer = require('nodemailer');
const { resolveVariables } = require('../utils/variableResolver');

// Helper for transporter
const getTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    pool: true,
    auth: {
      user: process.env.SMTP_USER || process.env.IMAP_USER || 'mortgagewithmanpreet@gmail.com',
      pass: process.env.SMTP_PASS || process.env.IMAP_PASS || 'swnamaxjdsfsygkz'
    },
    tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' }
  });
};

// 1. GET /api/email-templates/stats - Summary Metrics for Email Workspace
router.get('/stats', auth, async (req, res) => {
  try {
    const totalCount = await EmailTemplate.countDocuments({ status: { $ne: 'archived' } });
    const activeCount = await EmailTemplate.countDocuments({ status: 'active' });

    // Used in Automations count (unique templates referenced in active automations)
    const activeAutomations = await Automation.find({ isActive: true });
    const templateIdsInUse = new Set();
    activeAutomations.forEach(auto => {
      auto.steps.forEach(step => {
        if (step.action === 'send_email' && step.config?.templateId) {
          templateIdsInUse.add(step.config.templateId.toString());
        }
      });
    });

    const usedInAutomationsCount = templateIdsInUse.size;

    // Used this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const usedThisMonthCount = await EmailTemplate.countDocuments({
      lastUsedAt: { $gte: startOfMonth }
    });

    res.json({
      success: true,
      stats: {
        total: totalCount,
        active: activeCount,
        usedInAutomations: usedInAutomationsCount,
        usedThisMonth: usedThisMonthCount
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. GET /api/email-templates - List templates with search, category/status filters & automation usage info
router.get('/', auth, async (req, res) => {
  try {
    const { search, category, status, sort } = req.query;

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    } else {
      filter.status = { $ne: 'archived' }; // By default exclude archived unless requested
    }

    if (category && category !== 'all') {
      filter.category = category;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { subject: searchRegex },
        { description: searchRegex },
        { category: searchRegex }
      ];
    }

    let query = EmailTemplate.find(filter);

    if (sort === 'recently_created') query = query.sort({ createdAt: -1 });
    else if (sort === 'name_asc') query = query.sort({ name: 1 });
    else if (sort === 'most_used') query = query.sort({ usageCount: -1 });
    else query = query.sort({ updatedAt: -1 });

    const templates = await query.exec();

    // Fetch active automations to map dependent automations per template
    const allAutomations = await Automation.find().select('name isActive steps');

    const result = templates.map(t => {
      const templateIdStr = t._id.toString();
      const dependentAutomations = allAutomations.filter(auto => 
        auto.steps.some(s => s.action === 'send_email' && s.config?.templateId === templateIdStr)
      ).map(a => ({ _id: a._id, name: a.name, isActive: a.isActive }));

      return {
        ...t.toObject(),
        usedInAutomations: dependentAutomations
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. GET /api/email-templates/:id - Single template details with dependency check
router.get('/:id', auth, async (req, res) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });

    // Check automations referencing this template
    const automations = await Automation.find({ 'steps.config.templateId': req.params.id }).select('name isActive');

    res.json({
      success: true,
      template,
      usedInAutomations: automations
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. POST /api/email-templates - Create template
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, subject, body, category, status } = req.body;

    if (!name || !subject || !body) {
      return res.status(400).json({ message: 'Name, subject, and body are required' });
    }

    const template = new EmailTemplate({
      name,
      description,
      subject,
      body,
      category: category || 'General',
      status: status || 'active',
      isActive: status !== 'archived',
      createdBy: req.user._id || req.user.userId
    });

    const newTemplate = await template.save();
    res.status(201).json(newTemplate);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 5. POST /api/email-templates/:id/duplicate - Duplicate template as copy
router.post('/:id/duplicate', auth, async (req, res) => {
  try {
    const existing = await EmailTemplate.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Template not found' });

    const copyData = existing.toObject();
    delete copyData._id;
    delete copyData.createdAt;
    delete copyData.updatedAt;

    copyData.name = `${existing.name} - Copy`;
    copyData.status = 'active';
    copyData.isActive = true;
    copyData.usageCount = 0;
    copyData.lastUsedAt = null;
    copyData.createdBy = req.user._id || req.user.userId;

    const duplicated = await EmailTemplate.create(copyData);
    res.status(201).json({ success: true, template: duplicated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 6. POST /api/email-templates/test-send - Safe test email sender to admin
router.post('/test-send', auth, async (req, res) => {
  try {
    const { recipientEmail, subject, body, leadId } = req.body;

    if (!recipientEmail || !subject || !body) {
      return res.status(400).json({ success: false, message: 'Recipient email, subject, and body are required' });
    }

    let lead = null;
    if (leadId) {
      lead = await Client.findById(leadId);
    }

    // Resolve variables using real lead or default admin context
    const renderedSubject = resolveVariables(subject, lead, req.user);
    const renderedBody = resolveVariables(body, lead, req.user);

    // Append explicit test mode header
    const testHeaderHtml = `
      <div style="background-color: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 10px 16px; border-radius: 8px; font-family: Arial, sans-serif; font-size: 12px; margin-bottom: 16px;">
        <strong>⚠️ TEST PREVIEW MODE</strong><br/>
        This is a test email preview generated from the Email Template Center.
        ${lead ? `<br/><em>Rendered using Lead: ${lead.fullName || lead.email}</em>` : '<br/><em>Rendered using Sample Data</em>'}
      </div>
    `;

    const finalHtml = testHeaderHtml + renderedBody.replace(/\n/g, '<br/>');

    // Send via transporter or PHP Mailer if configured
    if (process.env.PHP_MAILER_URL) {
      const axios = require('axios');
      await axios.post(process.env.PHP_MAILER_URL, {
        to: recipientEmail,
        subject: `[TEST EMAIL] ${renderedSubject}`,
        html: finalHtml,
        text: renderedBody,
        from: process.env.SMTP_USER || process.env.IMAP_USER || 'mortgagewithmanpreet@gmail.com',
        fromName: 'Maninder Pal Singh'
      });
    } else {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: `"Maninder Pal Singh" <${process.env.SMTP_USER || process.env.IMAP_USER || 'mortgagewithmanpreet@gmail.com'}>`,
        to: recipientEmail,
        subject: `[TEST EMAIL] ${renderedSubject}`,
        html: finalHtml
      });
    }

    res.json({ success: true, message: `Test email sent successfully to ${recipientEmail}` });
  } catch (err) {
    console.error('❌ Test Email Send Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. PUT /api/email-templates/:id - Update template
router.put('/:id', auth, async (req, res) => {
  try {
    const updates = { ...req.body, updatedBy: req.user._id || req.user.userId };
    if (updates.status) {
      updates.isActive = updates.status !== 'archived';
    }

    const template = await EmailTemplate.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!template) return res.status(404).json({ message: 'Template not found' });

    res.json(template);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 8. DELETE /api/email-templates/:id - Safe delete with dependency check
router.delete('/:id', auth, async (req, res) => {
  try {
    // Check if automations depend on this template
    const dependentAutomations = await Automation.find({ 
      isActive: true, 
      'steps.config.templateId': req.params.id 
    }).select('name');

    if (dependentAutomations.length > 0 && req.query.force !== 'true') {
      const autoNames = dependentAutomations.map(a => a.name).join(', ');
      return res.status(400).json({
        success: false,
        message: `Cannot delete: Template is currently used in ${dependentAutomations.length} active automation(s): [${autoNames}]. Consider archiving instead.`,
        dependentAutomations
      });
    }

    const template = await EmailTemplate.findByIdAndDelete(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });

    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
