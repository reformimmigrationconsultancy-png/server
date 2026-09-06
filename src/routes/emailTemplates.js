const express = require('express');
const router = express.Router();
const { protect: auth } = require('../middleware/auth');
const EmailTemplate = require('../models/EmailTemplate');

// Get all templates
router.get('/', auth, async (req, res) => {
  try {
    const templates = await EmailTemplate.find().sort({ createdAt: -1 });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create template
router.post('/', auth, async (req, res) => {
  try {
    const template = new EmailTemplate({
      ...req.body,
      createdBy: req.user.userId
    });
    const newTemplate = await template.save();
    res.status(201).json(newTemplate);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update template
router.put('/:id', auth, async (req, res) => {
  try {
    const template = await EmailTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json(template);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete template
router.delete('/:id', auth, async (req, res) => {
  try {
    const template = await EmailTemplate.findByIdAndDelete(req.params.id);
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json({ message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
