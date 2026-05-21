const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { protect } = require('../middleware/auth');
const messenger = require('../services/messenger');

const router = express.Router();

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

/** Read .env as key-value map */
function readEnv() {
  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split('\n');
  const map = {};
  lines.forEach(line => {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      map[key] = val;
    }
  });
  return map;
}

/** Write updated key-value back to .env preserving comments/order */
function writeEnv(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf-8');
  const regex = new RegExp(`^(${key}=).*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `$1${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

/**
 * GET /api/settings/facebook/token-status
 * Returns token info: expiry, type, page name
 */
router.get('/facebook/token-status', protect, async (req, res) => {
  try {
    const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    if (!token) {
      return res.json({ success: true, status: 'missing', message: 'META_ACCESS_TOKEN not set' });
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    if (!appId || !appSecret) {
      // Return assumed valid Page token if app ID/secret is not set
      return res.json({
        success: true,
        status: 'valid',
        isValid: true,
        isExpired: false,
        neverExpires: true,
        expiresAt: 'Never Expires',
        daysLeft: null,
        type: 'PAGE (Assumed)',
        scopes: ['pages_messaging', 'pages_read_engagement', 'pages_manage_metadata']
      });
    }

    // Debug the token via Graph API
    const debugRes = await axios.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: token,
        access_token: `${appId}|${appSecret}`
      }
    });

    const data = debugRes.data.data;
    const expiresAt = data.expires_at ? new Date(data.expires_at * 1000) : null;
    const isExpired = expiresAt ? expiresAt < new Date() : !data.is_valid;
    
    // Page Access Tokens retrieved from long-lived user tokens never expire
    const neverExpires = data.is_valid && (!expiresAt || data.expires_at === 0);

    const daysLeft = expiresAt
      ? Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24))
      : (neverExpires ? null : null);

    return res.json({
      success: true,
      status: isExpired ? 'expired' : (neverExpires ? 'valid' : (daysLeft !== null && daysLeft <= 7 ? 'expiring_soon' : 'valid')),
      isValid: data.is_valid,
      isExpired,
      neverExpires,
      expiresAt: neverExpires ? 'Never Expires' : (expiresAt?.toISOString() || null),
      daysLeft,
      appId: data.app_id,
      type: data.type,
      scopes: data.scopes || [],
      userId: data.user_id,
    });
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error('❌ Token debug error:', errorMsg);
    return res.json({ success: false, status: 'error', message: errorMsg });
  }
});

/**
 * POST /api/settings/facebook/refresh-token
 * Exchanges the current short-lived User Token for a 60-day long-lived token, then fetches Permanent Page Token
 */
router.post('/facebook/refresh-token', protect, async (req, res) => {
  try {
    const currentToken = process.env.META_ACCESS_TOKEN;

    if (!currentToken) {
      return res.status(400).json({
        success: false,
        message: 'META_ACCESS_TOKEN must be set in .env'
      });
    }

    const metaTokenManager = require('../utils/metaTokenManager');
    const result = await metaTokenManager.convertAndSave(currentToken);

    // Invalidate cached token in MessengerService
    messenger.metaAccessToken = result.token;
    messenger._pageToken = result.token;

    console.log(`✅ [Settings] Facebook Permanent Page Access Token generated successfully.`);

    return res.json({
      success: true,
      message: `Token extended and Permanent Page Access Token generated successfully. Page: "${result.pageName}". This token never expires!`,
      expiresAt: 'Never Expires',
      daysLeft: null
    });
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error('❌ Token refresh error:', errorMsg);
    return res.status(400).json({ success: false, message: errorMsg });
  }
});

/**
 * POST /api/settings/facebook/update-token
 * Manually paste a new token (User Token or Page Token) and automatically resolve to Permanent Page Token
 */
router.post('/facebook/update-token', protect, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || token.trim().length < 20) {
      return res.status(400).json({ success: false, message: 'Invalid token provided' });
    }

    const suppliedToken = token.trim();

    // Upgrade/validate using our smart manager
    const metaTokenManager = require('../utils/metaTokenManager');
    const result = await metaTokenManager.convertAndSave(suppliedToken);

    // Update messenger instance cache
    messenger.metaAccessToken = result.token;
    messenger._pageToken = result.token;

    console.log('✅ [Settings] Meta Access Token updated and resolved to Page Token:', result.pageName);

    return res.json({ 
      success: true, 
      message: `Token updated successfully! Connected to Page: "${result.pageName}". Resolved to a Permanent Page Access Token which never expires.` 
    });
  } catch (err) {
    console.error('❌ Token update error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/settings/facebook/webhook-logs
 * Returns the last 20 webhook processing logs for debugging
 */
router.get('/facebook/webhook-logs', protect, async (req, res) => {
  try {
    const WebhookLog = require('../models/WebhookLog');
    const logs = await WebhookLog.find()
      .sort({ createdAt: -1 })
      .limit(20);
    return res.json({ success: true, logs });
  } catch (err) {
    console.error('❌ [Settings] Error fetching webhook logs:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
