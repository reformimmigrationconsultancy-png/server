const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const { Conversation, Message } = require('../models/Conversation');
const Client = require('../models/Client');

// Configure retry logic to prevent rate-limiting and handle transient errors
axiosRetry(axios, {
  retries: 3, // Number of retries
  retryDelay: (retryCount) => {
    console.log(`⏳ [MessengerService] Retrying request... Attempt ${retryCount}`);
    return retryCount * 2000; // time interval between retries
  },
  retryCondition: (error) => {
    // Retry if rate-limited (429) or internal server errors (5xx)
    return error.response?.status === 429 || error.response?.status >= 500 || axiosRetry.isNetworkOrIdempotentRequestError(error);
  },
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Service to handle external communication via Meta Graph API (WhatsApp, Facebook)
 */
class MessengerService {
  constructor() {
    this.whatsappToken = process.env.WHATSAPP_TOKEN;
    this.whatsappPhoneId = process.env.WHATSAPP_PHONE_ID;
    this.metaAccessToken = process.env.META_ACCESS_TOKEN;
    this.pageId = process.env.FB_PAGE_ID;
    this._pageToken = null; // Cache for Page Access Token
    this._pageName = null;  // Cache for Page Name
  }

  /**
   * Get Page Access Token from environment or cache.
   * If a Page Token is set in META_PAGE_ACCESS_TOKEN, it is used immediately.
   */
  async getPageAccessToken() {
    if (this._pageToken) return this._pageToken;
    if (process.env.META_PAGE_ACCESS_TOKEN) {
      this._pageToken = process.env.META_PAGE_ACCESS_TOKEN;
      return this._pageToken;
    }

    try {
      console.log('📡 [MessengerService] Validating Meta Access Token...');
      const tokenToUse = this.metaAccessToken || process.env.META_ACCESS_TOKEN;
      if (!tokenToUse) {
        throw new Error('No Meta tokens found in .env');
      }

      // Check if it's already a Page Token or exchange it
      const metaTokenManager = require('../utils/metaTokenManager');
      const type = await metaTokenManager.getTokenType(tokenToUse);

      if (type === 'PAGE') {
        console.log('✅ [MessengerService] Token is already a Page Access Token.');
        this._pageToken = tokenToUse;
        process.env.META_PAGE_ACCESS_TOKEN = tokenToUse;
        metaTokenManager.writeEnv('META_PAGE_ACCESS_TOKEN', tokenToUse);
        return this._pageToken;
      }

      // If it's a User Token, let's convert it to a Permanent Page Token
      console.log('📡 [MessengerService] Token is a User Token. Upgrading to Permanent Page Token...');
      const result = await metaTokenManager.convertAndSave(tokenToUse);
      this._pageToken = result.token;
      return this._pageToken;
    } catch (error) {
      console.error('❌ [MessengerService] Token Resolution Error:', error.message);
      // Fallback to whatever token is in memory
      this._pageToken = this.metaAccessToken || process.env.META_ACCESS_TOKEN;
      return this._pageToken;
    }
  }

  /**
   * Fetch and cache the Facebook Page Name
   */
  async getPageName() {
    if (this._pageName) return this._pageName;
    try {
      const token = await this.getPageAccessToken();
      if (!token) return 'Facebook Page';
      
      console.log(`📡 [MessengerService] Fetching Page Name for ID: ${this.pageId}...`);
      const response = await axios.get(`https://graph.facebook.com/v18.0/${this.pageId}`, {
        params: { access_token: token, fields: 'name' }
      });
      
      this._pageName = response.data.name;
      console.log(`✅ [MessengerService] Page Name Cached: ${this._pageName}`);
      return this._pageName;
    } catch (err) {
      console.error('❌ [MessengerService] Error fetching Page Name:', err.response?.data || err.message);
      return 'Facebook Page';
    }
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
  async sendFacebookMessage(recipientId, content, imageUrl = null, localFilePath = null, platform = 'facebook') {
    try {
      const token = await this.getPageAccessToken();
      if (!token) throw new Error('Could not obtain Page Access Token');

      let data;
      let headers = {};

      const isFb = platform === 'facebook';

      if (localFilePath) {
        // Send image as a file (Form-Data)
        const fs = require('fs');
        const FormData = require('form-data');
        const form = new FormData();
        
        if (isFb) {
          form.append('messaging_type', 'MESSAGE_TAG');
          form.append('tag', 'HUMAN_AGENT');
        } else {
          form.append('messaging_type', 'RESPONSE');
        }
        
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
          messaging_type: isFb ? 'MESSAGE_TAG' : 'RESPONSE',
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'image',
              payload: { url: imageUrl, is_reusable: true }
            }
          }
        };
        if (isFb) {
          data.tag = 'HUMAN_AGENT';
        }
      } else {
        // Send text only
        data = {
          messaging_type: isFb ? 'MESSAGE_TAG' : 'RESPONSE',
          recipient: { id: recipientId },
          message: { text: content }
        };
        if (isFb) {
          data.tag = 'HUMAN_AGENT';
        }
      }

      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${this.pageId}/messages`,
        data,
        {
          params: { access_token: token },
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
    try {
      const token = await this.getPageAccessToken();
      if (!token) {
        console.warn(`⚠️ Page Access Token is missing. Sync for ${platform} aborted.`);
        return [];
      }

      console.log(`📡 [MessengerService] Fetching ${platform} conversations...`);
      const response = await axios.get(
        `https://graph.facebook.com/v18.0/${this.pageId}/conversations`,
        {
          params: {
            access_token: token,
            platform: platform, // 'messenger' for FB, 'instagram' for IG
            fields: 'id,updated_time,participants,messages.limit(10){message,from,created_time,attachments{image_data,audio_data,video_data,file_url,name,size}}'
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

  /**
   * Sync all platforms (Facebook & Instagram)
   * This is used for background auto-sync
   */
  async syncAll() {
    console.log('🔄 [MessengerService] Starting full sync...');
    const fbCount = await this.syncPlatform('facebook');
    const igCount = await this.syncPlatform('instagram');
    console.log(`✅ [MessengerService] Full sync complete. Imported: FB(${fbCount}), IG(${igCount})`);
    return { fbCount, igCount };
  }

  /**
   * Reusable sync logic for a specific platform
   */
  async syncPlatform(platform) {
    try {
      const rawConvs = platform === 'instagram' ? await this.fetchInstagramConversations() : await this.fetchFacebookConversations();
      let importedCount = 0;

      for (const metaConv of rawConvs) {
        const participants = metaConv.participants?.data || [];
        const lastMsg = metaConv.messages?.data?.[0];
        
        const pageId = platform === 'instagram' ? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID : process.env.FB_PAGE_ID;
        const otherUser = participants.find(p => p.id !== pageId);
        if (!otherUser) continue;

        const psid = otherUser.id;

        // 1. Find or create client
        let client = await Client.findOne({ platformContactId: psid });
        if (!client) {
          client = await Client.create({
            fullName: otherUser.name || `${platform === 'instagram' ? 'IG' : 'FB'} User ${psid.substring(0, 5)}`,
            platformContactId: psid,
            source: platform
          });
        }

        // 2. Find or create conversation
        let conv = await Conversation.findOne({ platformContactId: psid, platform: platform });
        
        if (!conv) {
          conv = await Conversation.create({
            client: client._id,
            platform: platform,
            platformContactId: psid,
            externalConversationId: metaConv.id,
            lastMessage: lastMsg?.message || 'Synced conversation',
            lastMessageAt: new Date(metaConv.updated_time)
          });
          importedCount++;
        } else {
          await Conversation.findByIdAndUpdate(conv._id, {
            lastMessage: lastMsg?.message || conv.lastMessage,
            lastMessageAt: new Date(metaConv.updated_time)
          });
        }

        // 3. Sync the last message if it's not already in our DB
        if (lastMsg) {
          const messageExists = await Message.findOne({ 
            conversationId: conv._id, 
            externalId: lastMsg.id
          }) || await Message.findOne({
            conversationId: conv._id,
            content: lastMsg.message,
            createdAt: new Date(lastMsg.created_time)
          });

          if (!messageExists) {
            const attachments = lastMsg.attachments?.data?.map(att => {
              const url = att.image_data?.url || att.audio_data?.url || att.video_data?.url || att.file_url || att.url;
              let mimetype = 'application/octet-stream';
              if (att.image_data) mimetype = 'image/jpeg';
              else if (att.audio_data) mimetype = 'audio/mpeg';
              else if (att.video_data) mimetype = 'video/mp4';
              
              return {
                url,
                mimetype,
                filename: att.name || `fb_attachment_${Date.now()}`
              };
            }).filter(a => a.url) || [];

            const isAudio = lastMsg.attachments?.data?.some(att => att.audio_data);
            const isVideo = lastMsg.attachments?.data?.some(att => att.video_data);
            const isImage = lastMsg.attachments?.data?.some(att => att.image_data);

            let messageType = 'text';
            if (isAudio) messageType = 'audio';
            else if (isVideo) messageType = 'video';
            else if (isImage) messageType = 'image';

            await Message.create({
              conversationId: conv._id,
              sender: lastMsg.from?.id === psid ? 'client' : 'agent',
              content: lastMsg.message || (attachments.length > 0 ? `[${messageType.toUpperCase()}]` : '[No content]'),
              messageType,
              attachments: attachments,
              externalId: lastMsg.id,
              createdAt: new Date(lastMsg.created_time || Date.now())
            });
            importedCount++;
          }
        }
      }
      return importedCount;
    } catch (err) {
      console.error(`❌ [MessengerService] Sync error for ${platform}:`, err.message);
      return 0;
    }
  }

  /**
   * Fetch lead details from Meta Graph API using leadgen_id
   */
  async getLeadDetails(leadgenId) {
    try {
      const token = await this.getPageAccessToken();
      if (!token) throw new Error('Could not obtain Page Access Token for lead retrieval');

      console.log(`📡 [MessengerService] Fetching lead details for ID: ${leadgenId}`);
      
      const fields = 'created_time,id,ad_id,form_id,field_data,campaign_name,campaign_id,adset_name,ad_name';
      const response = await axios.get(`https://graph.facebook.com/v18.0/${leadgenId}`, {
        params: { access_token: token, fields }
      });

      const leadData = response.data;
      console.log(`✅ [MessengerService] Lead details fetched:`, JSON.stringify(leadData, null, 2));

      // Map the field_data to a more usable object
      const mappedData = {
        externalId: leadData.id,
        createdTime: leadData.created_time,
        adId: leadData.ad_id,
        formId: leadData.form_id,
        campaignName: leadData.campaign_name,
        adSetName: leadData.adset_name,
        adName: leadData.ad_name,
        pageName: 'Facebook Page',
        customFields: {},
        rawData: leadData,
      };

      try {
        mappedData.pageName = await this.getPageName();
      } catch (pageErr) {
        console.warn('⚠️ [MessengerService] Failed to fetch Page Name for lead:', pageErr.message);
      }

      if (leadData.field_data) {
        leadData.field_data.forEach(field => {
          const name = field.name.toLowerCase();
          const value = field.values && field.values.length > 0 ? field.values[0] : '';
          
          if (name === 'full_name' || name === 'name') mappedData.fullName = value;
          else if (name === 'first_name') mappedData.firstName = value;
          else if (name === 'last_name') mappedData.lastName = value;
          else if (name === 'email') mappedData.email = value;
          else if (name === 'phone_number' || name === 'phone') mappedData.phone = value;
          else if (name === 'city') mappedData.city = value;
          else {
            // Save non-standard responses in customFields
            mappedData.customFields[field.name] = value;
          }
        });

        // Construct fullName if missing
        if (!mappedData.fullName && (mappedData.firstName || mappedData.lastName)) {
          mappedData.fullName = `${mappedData.firstName || ''} ${mappedData.lastName || ''}`.trim();
        }
      }

      return mappedData;
    } catch (error) {
      const errorDetail = error.response?.data || error.message;
      console.error('❌ Lead Retrieval Error:', JSON.stringify(errorDetail, null, 2));
      throw new Error(`Lead Retrieval Error: ${errorDetail.error?.message || error.message}`);
    }
  }

  /**
   * Sync all historical leads from Meta Leadgen Forms (fully paginated, rate-limit optimized)
   */
  async syncHistoricalLeads() {
    try {
      const token = await this.getPageAccessToken();
      if (!token) throw new Error('Could not obtain Page Access Token for lead sync');

      console.log(`📡 [MessengerService] Fetching Leadgen Forms for Page: ${this.pageId}`);
      const pageName = await this.getPageName();
      
      // 1. Get all forms for this page
      const formsRes = await axios.get(`https://graph.facebook.com/v18.0/${this.pageId}/leadgen_forms`, {
        params: { access_token: token, limit: 100 }
      });

      const forms = formsRes.data.data || [];
      let totalSynced = 0;

      for (const form of forms) {
        console.log(`🔍 [MessengerService] Syncing leads from form: ${form.name} (${form.id})`);
        
        // 2. Get leads for each form with full pagination traversal (ensure NO LEADS ARE SKIPPED)
        const fields = 'created_time,id,ad_id,form_id,field_data,campaign_name,campaign_id,adset_name,ad_name';
        let leadsUrl = `https://graph.facebook.com/v18.0/${form.id}/leads`;
        let leadsParams = { access_token: token, fields, limit: 100 };

        while (leadsUrl) {
          console.log(`📡 [MessengerService] Querying leads page: ${leadsUrl.substring(0, 80)}...`);
          const leadsRes = await axios.get(leadsUrl, { 
            params: leadsUrl.includes('?') ? {} : leadsParams 
          });
          
          const leadsData = leadsRes.data;
          const leads = leadsData.data || [];
          
          for (const rawLead of leads) {
            // Map lead fields using helper logic
            const leadDetails = {
              externalId: rawLead.id,
              createdTime: rawLead.created_time,
              adId: rawLead.ad_id,
              formId: rawLead.form_id,
              campaignName: rawLead.campaign_name,
              adSetName: rawLead.adset_name,
              adName: rawLead.ad_name,
              pageName: pageName,
              formName: form.name,
              customFields: {},
              rawData: rawLead
            };

            if (rawLead.field_data) {
              rawLead.field_data.forEach(field => {
                const name = field.name.toLowerCase();
                const value = field.values && field.values.length > 0 ? field.values[0] : '';
                
                if (name === 'full_name' || name === 'name') leadDetails.fullName = value;
                else if (name === 'first_name') leadDetails.firstName = value;
                else if (name === 'last_name') leadDetails.lastName = value;
                else if (name === 'email') leadDetails.email = value;
                else if (name === 'phone_number' || name === 'phone') leadDetails.phone = value;
                else {
                  leadDetails.customFields[field.name] = value;
                }
              });
              if (!leadDetails.fullName && (leadDetails.firstName || leadDetails.lastName)) {
                leadDetails.fullName = `${leadDetails.firstName || ''} ${leadDetails.lastName || ''}`.trim();
              }
            }

            // Check if lead already exists
            const existing = await Client.findOne({ 
              $or: [
                { externalId: leadDetails.externalId },
                { email: leadDetails.email && leadDetails.email !== '' ? leadDetails.email : '____never____' }
              ]
            });

            if (!existing) {
              try {
                await Client.create({
                  fullName: leadDetails.fullName || `Meta Lead ${leadDetails.externalId.substring(0, 5)}`,
                  email: leadDetails.email,
                  phone: leadDetails.phone,
                  source: 'facebook',
                  externalId: leadDetails.externalId,
                  stage: 'new_lead',
                  createdAt: new Date(leadDetails.createdTime),
                  metaData: {
                    campaignName: leadDetails.campaignName,
                    adSetName: leadDetails.adSetName,
                    adName: leadDetails.adName,
                    pageName: leadDetails.pageName,
                    formName: leadDetails.formName,
                    customFields: leadDetails.customFields,
                    rawData: leadDetails.rawData,
                    webhookTimestamp: new Date(leadDetails.createdTime)
                  }
                });
                totalSynced++;
              } catch (dbErr) {
                // If parallel processes create it or index fails
                if (dbErr.code === 11000) {
                  console.warn(`ℹ️ [MessengerService] Client with externalId ${leadDetails.externalId} was created concurrently. Skipping.`);
                } else {
                  console.error(`❌ [MessengerService] DB Save Error for lead ${leadDetails.externalId}:`, dbErr.message);
                }
              }
            }
          }

          // Advance to next page of leads
          leadsUrl = leadsData.paging?.next || null;
          leadsParams = {}; // Parameters already embedded in next page URL

          if (leadsUrl) {
            // Throttling: Pause 300ms between paginated requests to respect Meta API rate limit
            await sleep(300);
          }
        }
        
        // Sleep between forms as well
        await sleep(500);
      }

      console.log(`✅ [MessengerService] Historical lead sync complete. Total new leads: ${totalSynced}`);
      return totalSynced;
    } catch (error) {
      console.error('❌ [MessengerService] Historical Lead Sync Error:', error.message);
      throw error;
    }
  }
}

module.exports = new MessengerService();
