const axios = require('axios');

/**
 * Service to handle external communication via Meta Graph API (WhatsApp, Facebook)
 */
class MessengerService {
  constructor() {
    this.whatsappToken = process.env.WHATSAPP_TOKEN;
    this.whatsappPhoneId = process.env.WHATSAPP_PHONE_ID;
    this.metaAccessToken = process.env.META_ACCESS_TOKEN;
  }

  /**
   * Send a WhatsApp message via Meta Cloud API
   */
  async sendWhatsAppMessage(to, text) {
    if (!this.whatsappToken || !this.whatsappPhoneId) {
      console.warn('⚠️ WhatsApp credentials missing. Skipping external API call.');
      return null;
    }

    try {
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${this.whatsappPhoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: to.replace('+', ''), // Remove + for WhatsApp API
          type: 'text',
          text: { body: text },
        },
        {
          headers: {
            Authorization: `Bearer ${this.whatsappToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ WhatsApp API Error:', error.response?.data || error.message);
      throw new Error('Failed to send WhatsApp message externally');
    }
  }

  /**
   * Send a Facebook Messenger message via Meta Graph API
   */
  async sendFacebookMessage(recipientId, content, imageUrl = null, localFilePath = null) {
    try {
      const metaAccessToken = process.env.META_ACCESS_TOKEN;
      if (!metaAccessToken) throw new Error('META_ACCESS_TOKEN is missing');

      let data;
      let headers = {};

      if (localFilePath) {
        // Send image as a file (Form-Data)
        const fs = require('fs');
        const FormData = require('form-data');
        const form = new FormData();
        form.append('recipient', JSON.stringify({ id: recipientId }));
        form.append('message', JSON.stringify({
          attachment: {
            type: 'image',
            payload: { is_reusable: true }
          }
        }));
        form.append('filedata', fs.createReadStream(localFilePath));
        
        data = form;
        headers = form.getHeaders();
      } else if (imageUrl) {
        // Send image via URL
        data = {
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'image',
              payload: { url: imageUrl, is_reusable: true }
            }
          }
        };
      } else {
        // Send text only
        data = {
          recipient: { id: recipientId },
          message: { text: content }
        };
      }

      const response = await axios.post(
        `https://graph.facebook.com/v18.0/me/messages`,
        data,
        {
          params: { access_token: metaAccessToken },
          headers: headers
        }
      );
      console.log(`✅ [MessengerService] Facebook API Success:`, response.data);
      return response.data;
    } catch (error) {
      const errorDetail = error.response?.data || error.message;
      console.error('❌ Facebook API Error Details:', JSON.stringify(errorDetail, null, 2));
      throw new Error(`Facebook API Error: ${errorDetail.error?.message || error.message}`);
    }
  }

  /**
   * Fetch recent conversations from Meta (Facebook or Instagram)
   */
  async fetchMetaConversations(platform = 'messenger') {
    if (!this.metaAccessToken || this.metaAccessToken === 'your_meta_page_access_token') {
      console.warn(`⚠️ Meta Access Token is missing or placeholder. Sync for ${platform} aborted.`);
      return [];
    }

    try {
      console.log(`📡 [MessengerService] Fetching ${platform} conversations...`);
      const response = await axios.get(
        `https://graph.facebook.com/v18.0/me/conversations`,
        {
          params: {
            access_token: this.metaAccessToken,
            platform: platform, // 'messenger' for FB, 'instagram' for IG
            fields: 'id,updated_time,participants,messages.limit(1){message,from,created_time}'
          },
        }
      );
      console.log(`✅ [MessengerService] Fetched ${response.data.data?.length || 0} ${platform} conversations`);
      return response.data.data || [];
    } catch (error) {
      const errorDetail = error.response?.data || error.message;
      console.error(`❌ ${platform} Fetch Error Details:`, JSON.stringify(errorDetail, null, 2));
      return [];
    }
  }

  /**
   * Fetch recent Facebook Messenger conversations
   */
  async fetchFacebookConversations() {
    return this.fetchMetaConversations('messenger');
  }

  /**
   * Fetch recent Instagram Direct conversations
   */
  async fetchInstagramConversations() {
    return this.fetchMetaConversations('instagram');
  }
}

module.exports = new MessengerService();
