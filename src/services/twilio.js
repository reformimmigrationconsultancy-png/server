const twilio = require('twilio');

/**
 * Service to handle real calls and SMS via Twilio
 */
class TwilioService {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
    
    if (this.accountSid && this.authToken) {
       this.client = twilio(this.accountSid, this.authToken);
    }
  }

  /**
   * Initiate a real call to a client
   * @param {string} to - Client phone number
   * @param {string} callbackUrl - URL to TwiML instructions
   */
  async makeCall(to, callbackUrl) {
    if (!this.client || !this.fromNumber) {
      console.warn('⚠️ Twilio credentials missing. Skipping real call.');
      return null;
    }

    try {
      const call = await this.client.calls.create({
        url: callbackUrl || 'http://demo.twilio.com/docs/voice.xml',
        to: to,
        from: this.fromNumber
      });
      return call;
    } catch (error) {
      console.error('❌ Twilio Call Error:', error.message);
      throw new Error('Failed to initiate external call');
    }
  }

  /**
   * Send a real SMS to a client
   */
  async sendSMS(to, body) {
    if (!this.client || !this.fromNumber) {
      console.warn('⚠️ Twilio credentials missing. Skipping real SMS.');
      return null;
    }

    try {
      const message = await this.client.messages.create({
        body: body,
        to: to,
        from: this.fromNumber
      });
      return message;
    } catch (error) {
       console.error('❌ Twilio SMS Error:', error.message);
       throw new Error('Failed to send external SMS');
    }
  }
}

module.exports = new TwilioService();
