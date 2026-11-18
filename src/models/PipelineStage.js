const mongoose = require('mongoose');

const pipelineStageSchema = new mongoose.Schema({
  key: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true,
    lowercase: true
  },
  title: { 
    type: String, 
    required: true, 
    trim: true 
  },
  color: { 
    type: String, 
    default: 'blue',
    enum: ['blue', 'indigo', 'purple', 'amber', 'emerald', 'rose', 'teal', 'cyan', 'slate', 'violet', 'sky', 'orange']
  },
  order: { 
    type: Number, 
    default: 0 
  },
  isDefault: { 
    type: Boolean, 
    default: false 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

module.exports = mongoose.model('PipelineStage', pipelineStageSchema);
