const express = require('express');
const router = express.Router();
const PipelineStage = require('../models/PipelineStage');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');

const DEFAULT_STAGES = [
  { key: 'new_lead', title: 'New Opportunity', color: 'blue', order: 0, isDefault: true },
  { key: 'contacted', title: 'Contacted', color: 'indigo', order: 1, isDefault: false },
  { key: 'interested', title: 'Negotiation', color: 'purple', order: 2, isDefault: false },
  { key: 'documents_received', title: 'Documentation', color: 'amber', order: 3, isDefault: false },
  { key: 'approved', title: 'Approved', color: 'emerald', order: 4, isDefault: false },
  { key: 'closed', title: 'Closed / Won', color: 'slate', order: 5, isDefault: false },
];

async function ensureDefaultStages() {
  const count = await PipelineStage.countDocuments();
  if (count === 0) {
    try {
      await PipelineStage.insertMany(DEFAULT_STAGES);
      console.log('✅ [PipelineStage] Seeded default stages');
    } catch (err) {
      console.error('❌ [PipelineStage] Seeding error:', err.message);
    }
  }
}

/**
 * GET /api/stages
 * Returns list of all pipeline stages in order
 */
router.get('/', protect, async (req, res) => {
  try {
    await ensureDefaultStages();
    const stages = await PipelineStage.find().sort({ order: 1, createdAt: 1 });
    return res.json({ success: true, stages });
  } catch (err) {
    console.error('Error fetching pipeline stages:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch stages' });
  }
});

/**
 * POST /api/stages
 * Add a new stage / column (Admin only)
 */
router.post('/', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can add pipeline stages' });
    }

    const { title, color = 'blue' } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Stage title is required' });
    }

    const cleanTitle = title.trim();
    // Generate unique slug key
    let key = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!key) {
      key = `stage_${Date.now()}`;
    }

    // Check if key already exists
    const existing = await PipelineStage.findOne({ key });
    if (existing) {
      key = `${key}_${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // Get highest current order
    const lastStage = await PipelineStage.findOne().sort({ order: -1 });
    const order = lastStage ? lastStage.order + 1 : 0;

    const newStage = await PipelineStage.create({
      key,
      title: cleanTitle,
      color,
      order,
      isDefault: false
    });

    return res.status(201).json({ success: true, stage: newStage });
  } catch (err) {
    console.error('Error creating pipeline stage:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create stage' });
  }
});

/**
 * PUT /api/stages/:id
 * Edit an existing stage / column (Admin only)
 */
router.put('/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can edit pipeline stages' });
    }

    const { title, color, order } = req.body;
    const stage = await PipelineStage.findById(req.params.id);
    if (!stage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }

    if (title && title.trim()) {
      stage.title = title.trim();
    }
    if (color) {
      stage.color = color;
    }
    if (typeof order === 'number') {
      stage.order = order;
    }

    await stage.save();
    return res.json({ success: true, stage });
  } catch (err) {
    console.error('Error updating pipeline stage:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update stage' });
  }
});

/**
 * DELETE /api/stages/:id
 * Delete a stage / column (Admin only)
 * If leads exist in this stage, migrates them to fallbackStageKey or first available stage
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can delete pipeline stages' });
    }

    const stage = await PipelineStage.findById(req.params.id);
    if (!stage) {
      return res.status(404).json({ success: false, message: 'Stage not found' });
    }

    const count = await PipelineStage.countDocuments();
    if (count <= 1) {
      return res.status(400).json({ success: false, message: 'Cannot delete the only remaining stage' });
    }

    // Find fallback stage to move cards to if any exist
    let fallbackStageKey = req.body?.fallbackStageKey || req.query?.fallbackStageKey;
    if (!fallbackStageKey || fallbackStageKey === stage.key) {
      const anotherStage = await PipelineStage.findOne({ _id: { $ne: stage._id } }).sort({ order: 1 });
      fallbackStageKey = anotherStage ? anotherStage.key : 'new_lead';
    }

    // Migrate any leads that have stage === stage.key
    const migrateResult = await Client.updateMany(
      { stage: stage.key },
      { $set: { stage: fallbackStageKey } }
    );

    await PipelineStage.findByIdAndDelete(stage._id);

    return res.json({ 
      success: true, 
      message: `Stage '${stage.title}' deleted successfully`,
      movedLeadsCount: migrateResult.modifiedCount || 0,
      fallbackStageKey
    });
  } catch (err) {
    console.error('Error deleting pipeline stage:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to delete stage' });
  }
});

module.exports = router;
