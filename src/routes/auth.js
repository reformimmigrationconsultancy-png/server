const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already in use' });
    const user = await User.create({ name, email, password, role });
    const token = signToken(user._id);
    res.status(201).json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = signToken(user._id);
    res.json({ success: true, token, user: { ...user.toJSON() } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// PUT /api/auth/update-password
router.put('/update-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).trim().length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // If current password provided, verify it
    if (currentPassword && currentPassword.trim() !== '') {
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ 
          success: false, 
          message: 'Current password is incorrect. (Default password was 123456)' 
        });
      }
    }

    user.password = String(newPassword).trim();
    await user.save();

    const token = signToken(user._id);
    return res.json({
      success: true,
      message: 'Password updated successfully! You can now log in with your new password.',
      token,
      user: { ...user.toJSON() }
    });
  } catch (err) {
    console.error('Password update error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error updating password' });
  }
});

// PUT /api/auth/update-profile
router.put('/update-profile', protect, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and email are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    // Check if email already used by another user
    const existing = await User.findOne({ email: cleanEmail, _id: { $ne: req.user._id } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'This email is already in use by another account' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.name = cleanName;
    user.email = cleanEmail;
    await user.save();

    return res.json({
      success: true,
      message: 'Account details updated successfully!',
      user: { ...user.toJSON() }
    });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error updating profile' });
  }
});

// GET /api/auth/team-members (available to all logged-in users for assignment dropdowns)
router.get('/team-members', protect, async (req, res) => {
  try {
    const users = await User.find({ isActive: true }).select('_id name email role avatar').sort({ name: 1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/users (admin only - includes lead counts & permissions)
router.get('/users', protect, adminOnly, async (req, res) => {
  try {
    const Client = require('../models/Client');
    const users = await User.find({}).select('-password').sort({ createdAt: -1 }).lean();

    // Attach assigned lead count for each user
    const usersWithStats = await Promise.all(
      users.map(async (u) => {
        const assignedLeadCount = await Client.countDocuments({ 
          assignedTo: u._id, 
          isArchived: { $ne: true } 
        });
        return {
          ...u,
          assignedLeadCount
        };
      })
    );

    res.json({ success: true, users: usersWithStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/create-employee (admin only)
router.post('/create-employee', protect, adminOnly, async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Employee name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Employee email is required' });
    }
    if (!password || String(password).trim().length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists' });
    }

    const defaultPermissions = {
      viewAllLeads: false,
      editLeads: true,
      deleteLeads: false,
      exportLeads: false,
      viewFinancials: false,
      manageFollowUps: true,
      accessAutomations: false,
      accessSettings: false,
    };

    const mergedPermissions = {
      ...defaultPermissions,
      ...(permissions || {})
    };

    const newEmployee = new User({
      name: name.trim(),
      email: cleanEmail,
      password: String(password).trim(),
      role: 'staff',
      isActive: true,
      permissions: mergedPermissions
    });

    await newEmployee.save();

    res.status(201).json({
      success: true,
      message: `Employee account created for ${newEmployee.name} successfully!`,
      user: {
        ...newEmployee.toJSON(),
        assignedLeadCount: 0
      }
    });
  } catch (err) {
    console.error('Error creating employee:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error creating employee' });
  }
});

// PUT /api/auth/users/:id (admin only - update employee details, permissions, or password)
router.put('/users/:id', protect, adminOnly, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { name, email, password, role, isActive, permissions } = req.body;

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name.trim();
    if (email) {
      const cleanEmail = email.trim().toLowerCase();
      const existing = await User.findOne({ email: cleanEmail, _id: { $ne: targetUserId } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email already used by another account' });
      }
      user.email = cleanEmail;
    }

    if (role && ['admin', 'staff'].includes(role)) {
      user.role = role;
    }

    if (typeof isActive === 'boolean') {
      user.isActive = isActive;
    }

    if (permissions && typeof permissions === 'object') {
      user.permissions = {
        ...(user.permissions ? user.permissions.toObject() : {}),
        ...permissions
      };
    }

    // If admin is resetting this employee's password
    if (password && String(password).trim().length >= 6) {
      user.password = String(password).trim();
    }

    await user.save();

    const Client = require('../models/Client');
    const assignedLeadCount = await Client.countDocuments({ 
      assignedTo: user._id, 
      isArchived: { $ne: true } 
    });

    res.json({
      success: true,
      message: `Employee '${user.name}' updated successfully!`,
      user: {
        ...user.toJSON(),
        assignedLeadCount
      }
    });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error updating user' });
  }
});

// DELETE /api/auth/users/:id (admin only)
router.delete('/users/:id', protect, adminOnly, async (req, res) => {
  try {
    const targetUserId = req.params.id;

    if (String(req.user._id) === String(targetUserId)) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own admin account' });
    }

    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Unassign leads previously assigned to this user
    const Client = require('../models/Client');
    const unassignResult = await Client.updateMany(
      { assignedTo: targetUserId },
      { $unset: { assignedTo: 1 } }
    );

    await User.findByIdAndDelete(targetUserId);

    res.json({
      success: true,
      message: `Employee '${user.name}' deleted successfully. ${unassignResult.modifiedCount} lead(s) unassigned.`
    });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error deleting user' });
  }
});

module.exports = router;
