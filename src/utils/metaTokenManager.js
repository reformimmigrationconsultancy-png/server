const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Meta Token Manager - Handles Long-Lived and Permanent Token Generation
 */
class MetaTokenManager {
  constructor() {
    this.appId = process.env.META_APP_ID;
    this.appSecret = process.env.META_APP_SECRET;
    this.pageId = process.env.FB_PAGE_ID;
    this.envPath = path.resolve(__dirname, '../../.env');
  }

  /**
   * Helper to write keys into the .env file preserving comments and formatting
   */
  writeEnv(key, value) {
    try {
      if (!fs.existsSync(this.envPath)) {
        fs.writeFileSync(this.envPath, `${key}=${value}\n`);
        return;
      }
      
      let content = fs.readFileSync(this.envPath, 'utf-8');
      const regex = new RegExp(`^(${key}=).*$`, 'm');
      
      if (regex.test(content)) {
        content = content.replace(regex, `$1${value}`);
      } else {
        // Ensure there's a newline at the end if we append
        if (content.length > 0 && !content.endsWith('\n')) {
          content += '\n';
        }
        content += `${key}=${value}\n`;
      }
      
      fs.writeFileSync(this.envPath, content, 'utf-8');
      console.log(`✅ [MetaTokenManager] .env file successfully updated: ${key}`);
    } catch (error) {
      console.error(`❌ [MetaTokenManager] Failed to write key ${key} to .env:`, error.message);
    }
  }

  /**
   * Step 1: Exchange Short-Lived User Token for Long-Lived User Token (60 days)
   */
  async getLongLivedUserToken(shortLivedToken) {
    try {
      console.log('📡 [MetaTokenManager] Exchanging Short-Lived User Token for Long-Lived Token...');
      const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.appId,
          client_secret: this.appSecret,
          fb_exchange_token: shortLivedToken
        }
      });
      return response.data.access_token;
    } catch (error) {
      console.error('❌ [MetaTokenManager] Error exchanging User Token:', error.response?.data || error.message);
      throw new Error(`User Token Exchange Failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Step 2: Get Permanent Page Access Token using Long-Lived User Token
   */
  async getPermanentPageToken(longLivedUserToken) {
    try {
      console.log('📡 [MetaTokenManager] Fetching Permanent Page Access Token...');
      const response = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
        params: { access_token: longLivedUserToken, limit: 100 }
      });

      const pages = response.data.data || [];
      const page = pages.find(p => p.id === this.pageId);
      
      if (!page) {
        throw new Error(`Page with ID ${this.pageId} not found in this user's accounts. Verified accounts: ${pages.map(p => `${p.name} (${p.id})`).join(', ')}`);
      }

      console.log(`✅ [MetaTokenManager] Found Page Token for: ${page.name}`);
      return {
        pageToken: page.access_token,
        pageName: page.name
      };
    } catch (error) {
      console.error('❌ [MetaTokenManager] Error fetching Page Token:', error.response?.data || error.message);
      throw new Error(`Page Access Token Retrieval Failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Determine token type (USER or PAGE)
   */
  async getTokenType(token) {
    try {
      if (!this.appId || !this.appSecret) {
        console.warn('⚠️ [MetaTokenManager] META_APP_ID or META_APP_SECRET is not configured in .env, falling back to basic check.');
        // Basic check via /me
        const meRes = await axios.get('https://graph.facebook.com/v18.0/me', {
          params: { access_token: token, fields: 'id,name' }
        });
        // If it succeeds and has accounts, or fails when fetching accounts, we guess
        return 'USER';
      }

      console.log('📡 [MetaTokenManager] Debugging token to identify type...');
      const debugRes = await axios.get('https://graph.facebook.com/debug_token', {
        params: {
          input_token: token,
          access_token: `${this.appId}|${this.appSecret}`
        }
      });
      
      const type = debugRes.data.data.type?.toUpperCase() || 'USER';
      console.log(`ℹ️ [MetaTokenManager] Token type detected: ${type}`);
      return type;
    } catch (error) {
      console.warn('⚠️ [MetaTokenManager] Could not debug token type via API. Assuming USER type.', error.response?.data || error.message);
      return 'USER';
    }
  }

  /**
   * Full Workflow: Convert Short-Lived User Token to Permanent Page Token or validate Page Token
   */
  async convertAndSave(suppliedToken) {
    try {
      const cleanToken = suppliedToken.trim();
      const type = await this.getTokenType(cleanToken);

      let permanentPageToken = '';
      let pageName = 'Facebook Page';

      if (type === 'PAGE') {
        console.log('ℹ️ [MetaTokenManager] Supplied token is already a Page Access Token. Skipping user exchange.');
        permanentPageToken = cleanToken;
        
        // Fetch Page Name to verify it
        try {
          const pageRes = await axios.get(`https://graph.facebook.com/v18.0/${this.pageId}`, {
            params: { access_token: permanentPageToken, fields: 'name' }
          });
          pageName = pageRes.data.name;
          console.log(`✅ [MetaTokenManager] Page verified: ${pageName}`);
        } catch (e) {
          console.warn(`⚠️ [MetaTokenManager] Could not verify Page name:`, e.message);
        }
      } else {
        // Exchange User token
        let longLivedUserToken = cleanToken;
        try {
          longLivedUserToken = await this.getLongLivedUserToken(cleanToken);
        } catch (exchangeError) {
          console.warn('⚠️ [MetaTokenManager] Could not get Long-Lived User Token (maybe invalid app secret). Proceeding with original short-lived token to get Page Token.');
        }
        const result = await this.getPermanentPageToken(longLivedUserToken);
        permanentPageToken = result.pageToken;
        pageName = result.pageName;
      }

      // Update both keys in environment for max compatibility
      process.env.META_ACCESS_TOKEN = permanentPageToken;
      process.env.META_PAGE_ACCESS_TOKEN = permanentPageToken;

      this.writeEnv('META_ACCESS_TOKEN', permanentPageToken);
      this.writeEnv('META_PAGE_ACCESS_TOKEN', permanentPageToken);
      
      return {
        token: permanentPageToken,
        pageName
      };
    } catch (error) {
      console.error('❌ [MetaTokenManager] Conversion failed:', error.message);
      throw error;
    }
  }
}

module.exports = new MetaTokenManager();
