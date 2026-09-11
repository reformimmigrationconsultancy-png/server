/**
 * Centralized Variable Resolution & Personalization Engine
 * Safe dynamic variable replacement for leads and users across automations, manual emails, test emails & previews.
 */

// Supported variable catalog with descriptions and fallback values
const SUPPORTED_VARIABLES = {
  'first_name': { keys: ['first_name', 'firstName'], label: 'First Name', defaultFallback: 'there' },
  'last_name': { keys: ['last_name', 'lastName'], label: 'Last Name', defaultFallback: '' },
  'full_name': { keys: ['full_name', 'fullName', 'name'], label: 'Full Name', defaultFallback: 'Valued Client' },
  'email': { keys: ['email'], label: 'Email Address', defaultFallback: '' },
  'phone': { keys: ['phone'], label: 'Phone Number', defaultFallback: '' },
  'company': { keys: ['company'], label: 'Company', defaultFallback: '' },
  'lead_source': { keys: ['lead_source', 'leadSource', 'source'], label: 'Lead Source', defaultFallback: 'Direct Enquiry' },
  'lead_stage': { keys: ['lead_stage', 'leadStage', 'stage'], label: 'Lead Stage', defaultFallback: 'New Lead' },
  'assigned_to': { keys: ['assigned_to', 'assignedTo'], label: 'Assigned Agent', defaultFallback: 'Support Team' },
  'admin_name': { keys: ['admin_name', 'adminName'], label: 'Admin Name', defaultFallback: 'Manpreet Singh' }
};

/**
 * Extracts first & last name from a full name string if separate fields aren't provided.
 */
function extractNameComponents(lead) {
  let fullName = lead?.fullName || lead?.name || '';
  let firstName = lead?.firstName || '';
  let lastName = lead?.lastName || '';

  if (fullName && (!firstName || !lastName)) {
    const parts = fullName.trim().split(/\s+/);
    if (!firstName) firstName = parts[0] || '';
    if (!lastName) lastName = parts.slice(1).join(' ') || '';
  }

  if (!fullName) {
    fullName = `${firstName} ${lastName}`.trim();
  }

  return { fullName, firstName, lastName };
}

/**
 * Resolves template variables against lead and admin data.
 * @param {string} text - Raw template string containing {{variable}} placeholders
 * @param {object} lead - Lead/Client model instance or object
 * @param {object} admin - Authenticated User/Agent object
 * @param {object} options - Configuration options (e.g. custom fallbacks)
 * @returns {string} - Rendered string with placeholders replaced
 */
function resolveVariables(text, lead = null, admin = null, options = {}) {
  if (!text || typeof text !== 'string') return '';

  const { fullName, firstName, lastName } = extractNameComponents(lead);

  const email = lead?.email || '';
  const phone = lead?.phone || '';
  const company = lead?.company || lead?.metaData?.companyName || '';
  const source = lead?.source || lead?.leadSource || 'Direct Enquiry';
  const stage = lead?.stage || lead?.status || 'New Lead';

  // Resolve assigned agent name
  let assignedTo = 'Support Team';
  if (lead?.assignedTo) {
    if (typeof lead.assignedTo === 'object' && lead.assignedTo.name) {
      assignedTo = lead.assignedTo.name;
    } else if (typeof lead.assignedTo === 'string') {
      assignedTo = lead.assignedTo;
    }
  } else if (admin?.name) {
    assignedTo = admin.name;
  }

  const adminName = admin?.name || options.defaultAdminName || 'Manpreet Singh';

  // Map of canonical variable keys to actual values (with fallbacks)
  const variableMap = {
    // First Name
    '{{first_name}}': firstName || SUPPORTED_VARIABLES.first_name.defaultFallback,
    '{{firstName}}': firstName || SUPPORTED_VARIABLES.first_name.defaultFallback,
    
    // Last Name
    '{{last_name}}': lastName || SUPPORTED_VARIABLES.last_name.defaultFallback,
    '{{lastName}}': lastName || SUPPORTED_VARIABLES.last_name.defaultFallback,

    // Full Name
    '{{full_name}}': fullName || SUPPORTED_VARIABLES.full_name.defaultFallback,
    '{{fullName}}': fullName || SUPPORTED_VARIABLES.full_name.defaultFallback,
    '{{name}}': fullName || SUPPORTED_VARIABLES.full_name.defaultFallback,

    // Lead Details
    '{{email}}': email,
    '{{phone}}': phone,
    '{{company}}': company,
    '{{lead_source}}': source,
    '{{leadSource}}': source,
    '{{source}}': source,
    '{{lead_stage}}': stage,
    '{{leadStage}}': stage,
    '{{stage}}': stage,

    // Assignment & Admin
    '{{assigned_to}}': assignedTo,
    '{{assignedTo}}': assignedTo,
    '{{admin_name}}': adminName,
    '{{adminName}}': adminName,
  };

  let rendered = text;

  // Replace each mapped variable
  for (const [tag, val] of Object.entries(variableMap)) {
    const escapedTag = tag.replace(/[{}]/g, '\\$&');
    rendered = rendered.replace(new RegExp(escapedTag, 'g'), val);
  }

  return rendered;
}

/**
 * Validates template string and returns any unsupported variable tags found.
 * @param {string} text 
 * @returns {Array<string>} List of unsupported variable names
 */
function validateVariables(text) {
  if (!text || typeof text !== 'string') return [];

  const matches = text.match(/\{\{([^{}]+)\}\}/g) || [];
  const unsupported = [];

  const validKeys = new Set();
  for (const spec of Object.values(SUPPORTED_VARIABLES)) {
    spec.keys.forEach(k => validKeys.add(k));
  }

  for (const match of matches) {
    const varName = match.replace(/[\{\}]/g, '').trim();
    if (!validKeys.has(varName)) {
      unsupported.push(match);
    }
  }

  return Array.from(new Set(unsupported));
}

/**
 * Returns dictionary of resolved variables for inspection/preview display.
 */
function getResolvedVariableDictionary(lead = null, admin = null) {
  const { fullName, firstName, lastName } = extractNameComponents(lead);

  let assignedTo = 'Support Team';
  if (lead?.assignedTo) {
    assignedTo = typeof lead.assignedTo === 'object' ? (lead.assignedTo.name || 'Support Team') : lead.assignedTo;
  } else if (admin?.name) {
    assignedTo = admin.name;
  }

  return {
    'First Name ({{first_name}})': firstName || 'there',
    'Last Name ({{last_name}})': lastName || '(None)',
    'Full Name ({{full_name}})': fullName || 'Valued Client',
    'Email Address ({{email}})': lead?.email || '(None)',
    'Phone Number ({{phone}})': lead?.phone || '(None)',
    'Lead Source ({{lead_source}})': lead?.source || 'Direct Enquiry',
    'Lead Stage ({{lead_stage}})': lead?.stage || 'New Lead',
    'Assigned To ({{assigned_to}})': assignedTo,
    'Admin Name ({{admin_name}})': admin?.name || 'Manpreet Singh'
  };
}

module.exports = {
  SUPPORTED_VARIABLES,
  resolveVariables,
  validateVariables,
  getResolvedVariableDictionary,
  extractNameComponents
};
