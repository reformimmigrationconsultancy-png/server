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
   * Subscribe Facebook Page to Webhooks (Leadgen, Messages, Feed)
   * This is required for Facebook to deliver real-time Lead Ads to our webhook URL
   */
  async subscribePageToWebhooks(suppliedToken = null) {
    try {
      const token = suppliedToken || this._pageToken || process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
      if (!token) throw new Error('No Page Access Token available for webhook subscription');

      console.log(`📡 [MessengerService] Subscribing Page ${this.pageId} to leadgen webhooks only...`);
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${this.pageId}/subscribed_apps`,
        null,
        {
          params: {
            access_token: token,
            subscribed_fields: 'leadgen'
          }
        }
      );

      console.log(`✅ [MessengerService] Page successfully subscribed to Meta Webhooks:`, response.data);
      return { success: true, data: response.data };
    } catch (err) {
      console.warn(`⚠️ [MessengerService] Webhook subscription notice:`, err.response?.data?.error?.message || err.message);
      return { success: false, error: err.response?.data?.error?.message || err.message };
    }
  }

  /**
   * Get Page Access Token from environment or cache.
   * Ensures the token is upgraded to a Permanent Page Access Token and Page is subscribed to webhooks.
   */
  async getPageAccessToken() {
    if (this._pageToken) return this._pageToken;

    try {
      console.log('📡 [MessengerService] Validating and resolving Meta Access Token...');
      const tokenToUse = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || this.metaAccessToken;
      if (!tokenToUse) {
        throw new Error('No Meta tokens found in .env');
      }

      const metaTokenManager = require('../utils/metaTokenManager');
      const type = await metaTokenManager.getTokenType(tokenToUse);

      if (type === 'PAGE') {
        console.log('✅ [MessengerService] Token is a valid Page Access Token.');
        this._pageToken = tokenToUse;
        process.env.META_PAGE_ACCESS_TOKEN = tokenToUse;
        metaTokenManager.writeEnv('META_PAGE_ACCESS_TOKEN', tokenToUse);
        
        // Auto-subscribe page to webhooks in background
        this.subscribePageToWebhooks(tokenToUse).catch(() => {});
        return this._pageToken;
      }

      // If it's a User Token, upgrade it to Permanent Page Token
      console.log('📡 [MessengerService] Token is a User Token. Upgrading to Permanent Page Token...');
      const result = await metaTokenManager.convertAndSave(tokenToUse);
      this._pageToken = result.token;
      process.env.META_PAGE_ACCESS_TOKEN = result.token;
      
      // Auto-subscribe page to webhooks in background
      this.subscribePageToWebhooks(result.token).catch(() => {});
      return this._pageToken;
    } catch (error) {
      console.error('❌ [MessengerService] Token Resolution Error:', error.message);
      // Fallback to whatever token is in memory
      this._pageToken = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || this.metaAccessToken;
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
  async sendFacebookMessage(recipientId, content, imageUrl = null, localFilePath = null) {
    const sendRequest = async (isRetryWithTag = false) => {
      const token = await this.getPageAccessToken();
      if (!token) throw new Error('Could not obtain Page Access Token');

      let data;
      let headers = {};

      if (localFilePath) {
        // Send image as a file (Form-Data)
        const fs = require('fs');
        const FormData = require('form-data');
        const form = new FormData();
        if (isRetryWithTag) {
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
          messaging_type: isRetryWithTag ? 'MESSAGE_TAG' : 'RESPONSE',
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'image',
              payload: { url: imageUrl, is_reusable: true }
            }
          }
        };
        if (isRetryWithTag) {
          data.tag = 'HUMAN_AGENT';
        }
      } else {
        // Send text only
        data = {
          messaging_type: isRetryWithTag ? 'MESSAGE_TAG' : 'RESPONSE',
          recipient: { id: recipientId },
          message: { text: content }
        };
        if (isRetryWithTag) {
          data.tag = 'HUMAN_AGENT';
        }
      }

      return axios.post(
        `https://graph.facebook.com/v18.0/${this.pageId}/messages`,
        data,
        {
          params: { access_token: token },
          headers: headers
        }
      );
    };

    try {
      // First attempt: standard RESPONSE type
      const response = await sendRequest(false);
      console.log(`✅ [MessengerService] Facebook API Success:`, response.data);
      return response.data;
    } catch (error) {
      const errorDetail = error.response?.data || error.message;
      const errorMessage = errorDetail.error?.message || error.message;
      
      const is24hError = errorMessage.includes('outside of allowed window') || 
                         errorMessage.includes('24 hour messaging window') || 
                         errorMessage.includes('24-hour') || 
                         errorDetail.error?.code === 10;
      
      if (is24hError) {
        console.warn(`⚠️ [MessengerService] 24h window limit hit. Retrying with HUMAN_AGENT message tag...`);
        try {
          const retryResponse = await sendRequest(true);
          console.log(`✅ [MessengerService] Facebook API Success (Retry with HUMAN_AGENT):`, retryResponse.data);
          return retryResponse.data;
        } catch (retryError) {
          const retryErrorDetail = retryError.response?.data || retryError.message;
          console.error('❌ Facebook API Retry Error Details:', JSON.stringify(retryErrorDetail, null, 2));
          throw new Error(`Facebook API Error (24-hour window / HUMAN_AGENT rejected): ${retryErrorDetail.error?.message || retryError.message}`);
        }
      }

      console.error('❌ Facebook API Error Details:', JSON.stringify(errorDetail, null, 2));
      throw new Error(`Facebook API Error: ${errorMessage}`);
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
   * Sync all platforms (Facebook & Instagram) - Disabled to only allow Lead Ads
   */
  async syncAll(app = null) {
    return { fbCount: 0, igCount: 0 };
  }

  /**
   * Reusable sync logic for a specific platform - Disabled for direct messages
   */
  async syncPlatform(platform, app = null) {
    return 0;
  }

  /**
   * Fetch lead details from Meta Graph API using leadgen_id
   * Uses multi-tier fallback to ensure field compatibility across Graph API versions
   */
  async getLeadDetails(leadgenId) {
    try {
      const token = await this.getPageAccessToken();
      if (!token) throw new Error('Could not obtain Page Access Token for lead retrieval');

      console.log(`📡 [MessengerService] Fetching lead details for ID: ${leadgenId}`);
      
      let leadData = null;

      // Tier 1: Attempt to fetch with extended campaign and ad metadata
      try {
        const fields = 'created_time,id,ad_id,form_id,field_data,campaign_name,campaign_id,adset_name,ad_name';
        const response = await axios.get(`https://graph.facebook.com/v18.0/${leadgenId}`, {
          params: { access_token: token, fields }
        });
        leadData = response.data;
      } catch (tier1Err) {
        console.warn(`⚠️ [MessengerService] Extended lead fields fetch failed. Falling back to core fields:`, tier1Err.response?.data?.error?.message || tier1Err.message);
        // Tier 2: Fallback to core fields guaranteed to be available on all Lead nodes
        const coreFields = 'created_time,id,ad_id,form_id,field_data';
        const fallbackRes = await axios.get(`https://graph.facebook.com/v18.0/${leadgenId}`, {
          params: { access_token: token, fields: coreFields }
        });
        leadData = fallbackRes.data;
      }

      console.log(`✅ [MessengerService] Lead details fetched:`, JSON.stringify(leadData, null, 2));

      // Map the field_data to a standardized object
      const mappedData = {
        externalId: leadData.id,
        createdTime: leadData.created_time || new Date().toISOString(),
        adId: leadData.ad_id,
        formId: leadData.form_id,
        campaignName: leadData.campaign_name,
        adSetName: leadData.adset_name,
        adName: leadData.ad_name,
        pageName: 'Facebook Page',
        customFields: {},
        loanAmount: undefined,
        propertyValue: undefined,
        city: undefined,
        rawData: leadData,
      };

      try {
        mappedData.pageName = await this.getPageName();
      } catch (pageErr) {
        console.warn('⚠️ [MessengerService] Failed to fetch Page Name for lead:', pageErr.message);
      }

      if (leadData.field_data) {
        leadData.field_data.forEach(field => {
          const rawName = (field.name || '').trim();
          const name = rawName.toLowerCase();
          const value = field.values && field.values.length > 0 ? String(field.values[0]).trim() : '';
          
          if (!value) return;

          if (name === 'full_name' || name === 'fullname' || name === 'name' || name === 'your_name' || name === 'full name' || name.includes('full_name') || name.includes('fullname') || name === 'your_full_name' || name === 'applicant_name') {
            mappedData.fullName = value;
          } else if (name === 'first_name' || name === 'fname' || name === 'first name' || name.includes('first_name')) {
            mappedData.firstName = value;
          } else if (name === 'last_name' || name === 'lname' || name === 'last name' || name.includes('last_name')) {
            mappedData.lastName = value;
          } else if (name.includes('email')) {
            mappedData.email = value;
          } else if (name.includes('phone') || name.includes('mobile') || name.includes('contact') || name.includes('cell') || name.includes('number')) {
            mappedData.phone = value;
          } else if (name.includes('city') || name.includes('location') || name.includes('address')) {
            mappedData.city = value;
            mappedData.customFields[rawName] = value;
          } else {
            // Save non-standard responses in customFields
            mappedData.customFields[rawName] = value;
            
            // Check for numeric values for loan or property
            const cleanNum = parseInt(String(value).replace(/[^0-9]/g, ''), 10);
            if (!isNaN(cleanNum) && cleanNum > 0) {
              if (name.includes('loan') || name.includes('mortgage') || name.includes('borrow')) {
                mappedData.loanAmount = cleanNum;
              } else if (name.includes('property') || name.includes('purchase') || name.includes('budget') || name.includes('price') || name.includes('value')) {
                mappedData.propertyValue = cleanNum;
              }
            }
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
  async syncHistoricalLeads(app = null) {
    try {
      const token = await this.getPageAccessToken();
      if (!token) throw new Error('Could not obtain Page Access Token for lead sync');

      console.log(`📡 [MessengerService] Fetching Leadgen Forms for Page: ${this.pageId}`);
      const pageName = await this.getPageName();
      
      // Auto-subscribe page to webhooks during sync
      this.subscribePageToWebhooks(token).catch(() => {});

      // 1. Get all forms for this page (including active & archived)
      let forms = [];
      try {
        const formsRes = await axios.get(`https://graph.facebook.com/v18.0/${this.pageId}/leadgen_forms`, {
          params: { access_token: token, fields: 'id,name,status,leads_count,created_time', limit: 100 }
        });
        forms = formsRes.data.data || [];
      } catch (pageFormsErr) {
        console.warn('⚠️ [MessengerService] Error fetching forms for configured page, trying basic forms query:', pageFormsErr.response?.data?.error?.message || pageFormsErr.message);
        const fallbackForms = await axios.get(`https://graph.facebook.com/v18.0/${this.pageId}/leadgen_forms`, {
          params: { access_token: token, limit: 100 }
        });
        forms = fallbackForms.data.data || [];
      }

      console.log(`📋 [MessengerService] Found ${forms.length} Leadgen Forms on Page.`);
      let totalSynced = 0;

      for (const form of forms) {
        console.log(`🔍 [MessengerService] Syncing leads from form: "${form.name}" (ID: ${form.id})`);
        
        // 2. Get leads for each form with full pagination traversal
        const fields = 'created_time,id,ad_id,form_id,field_data,campaign_name,campaign_id,adset_name,ad_name';
        let leadsUrl = `https://graph.facebook.com/v18.0/${form.id}/leads`;
        let leadsParams = { access_token: token, fields, limit: 100 };

        while (leadsUrl) {
          console.log(`📡 [MessengerService] Querying leads page for form ${form.id}...`);
          let leadsData = null;
          try {
            const leadsRes = await axios.get(leadsUrl, { 
              params: leadsUrl.includes('?') ? {} : leadsParams 
            });
            leadsData = leadsRes.data;
          } catch (fetchErr) {
            console.warn(`⚠️ [MessengerService] Form ${form.id} leads fetch failed with extended fields. Retrying with core fields...`);
            const fallbackRes = await axios.get(leadsUrl, {
              params: leadsUrl.includes('?') ? {} : { access_token: token, fields: 'created_time,id,ad_id,form_id,field_data', limit: 100 }
            });
            leadsData = fallbackRes.data;
          }
          
          const leads = leadsData?.data || [];
          
          for (const rawLead of leads) {
            const leadDetails = {
              externalId: rawLead.id,
              createdTime: rawLead.created_time || new Date(),
              adId: rawLead.ad_id,
              formId: rawLead.form_id || form.id,
              campaignName: rawLead.campaign_name,
              adSetName: rawLead.adset_name,
              adName: rawLead.ad_name,
              pageName: pageName,
              formName: form.name,
              customFields: {},
              loanAmount: undefined,
              propertyValue: undefined,
              city: undefined,
              rawData: rawLead
            };

            if (rawLead.field_data) {
              rawLead.field_data.forEach(field => {
                const rawName = (field.name || '').trim();
                const name = rawName.toLowerCase();
                const value = field.values && field.values.length > 0 ? String(field.values[0]).trim() : '';
                
                if (!value) return;

                if (name === 'full_name' || name === 'fullname' || name === 'name' || name === 'your_name' || name === 'full name' || name.includes('full_name') || name.includes('fullname') || name === 'your_full_name' || name === 'applicant_name') {
                  leadDetails.fullName = value;
                } else if (name === 'first_name' || name === 'fname' || name === 'first name' || name.includes('first_name')) {
                  leadDetails.firstName = value;
                } else if (name === 'last_name' || name === 'lname' || name === 'last name' || name.includes('last_name')) {
                  leadDetails.lastName = value;
                } else if (name.includes('email')) {
                  leadDetails.email = value;
                } else if (name.includes('phone') || name.includes('mobile') || name.includes('contact') || name.includes('cell') || name.includes('number')) {
                  leadDetails.phone = value;
                } else if (name.includes('city') || name.includes('location') || name.includes('address')) {
                  leadDetails.city = value;
                  leadDetails.customFields[rawName] = value;
                } else {
                  leadDetails.customFields[rawName] = value;
                  const cleanNum = parseInt(String(value).replace(/[^0-9]/g, ''), 10);
                  if (!isNaN(cleanNum) && cleanNum > 0) {
                    if (name.includes('loan') || name.includes('mortgage') || name.includes('borrow')) {
                      leadDetails.loanAmount = cleanNum;
                    } else if (name.includes('property') || name.includes('purchase') || name.includes('budget') || name.includes('price') || name.includes('value')) {
                      leadDetails.propertyValue = cleanNum;
                    }
                  }
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
                const client = await Client.create({
                  fullName: leadDetails.fullName || `Meta Lead ${leadDetails.externalId.substring(0, 5)}`,
                  email: leadDetails.email,
                  phone: leadDetails.phone,
                  source: 'facebook',
                  externalId: leadDetails.externalId,
                  stage: 'new_lead',
                  loanAmount: leadDetails.loanAmount,
                  propertyValue: leadDetails.propertyValue,
                  address: leadDetails.city,
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
                  },
                  notes: [{ content: `✨ Lead generated from Meta Leadgen Form: "${leadDetails.formName}"` }]
                });
                totalSynced++;
                console.log(`✅ [MessengerService] Created new Client: ${client.fullName} (${client._id})`);

                // Emit to Socket.io to notify UI in real-time
                if (app) {
                  const io = app.get('io');
                  if (io) {
                    io.emit('new_lead', client);
                    io.emit('new_client', client);
                  }
                }
              } catch (dbErr) {
                if (dbErr.code === 11000) {
                  console.warn(`ℹ️ [MessengerService] Client with externalId ${leadDetails.externalId} was created concurrently. Skipping.`);
                } else {
                  console.error(`❌ [MessengerService] DB Save Error for lead ${leadDetails.externalId}:`, dbErr.message);
                }
              }
            } else {
              // Update externalId / custom fields if missing
              let updated = false;
              if (!existing.externalId) {
                existing.externalId = leadDetails.externalId;
                updated = true;
              }
              if (!existing.loanAmount && leadDetails.loanAmount) {
                existing.loanAmount = leadDetails.loanAmount;
                updated = true;
              }
              if (updated) {
                await existing.save();
              }
            }
          }

          // Advance to next page of leads
          leadsUrl = leadsData?.paging?.next || null;
          leadsParams = {}; // Parameters already embedded in next page URL

          if (leadsUrl) {
            // Throttling: Pause 300ms between paginated requests
            await sleep(300);
          }
        }
        
        // Sleep between forms
        await sleep(400);
      }

      console.log(`✅ [MessengerService] Historical lead sync complete. Total new leads: ${totalSynced}`);
      return totalSynced;
    } catch (error) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      console.error('❌ [MessengerService] Historical Lead Sync Error:', error.response?.data || error.message);
      throw new Error(`Meta API Error: ${errorMsg}`);
    }
  }
}

module.exports = new MessengerService();
