/**
 * Service to handle Google Calendar / Outlook integration
 */
class CalendarService {
  constructor() {
    this.apiKey = process.env.GOOGLE_CALENDAR_API_KEY;
  }

  /**
   * Sync a reminder with an external calendar
   * @param {Object} reminder - Reminder database object
   */
  async syncToExternal(reminder) {
     if (!this.apiKey) {
        console.warn('⚠️ Calendar API Key missing. Simulation mode enabled.');
        return { success: true, provider: 'simulated' };
     }

     try {
        // Implement Google Calendar API call here
        // const res = await axios.post('...', { summary: reminder.title, ... })
        return { success: true, syncedAt: new Date() };
     } catch (error) {
        console.error('❌ Calendar Sync Error:', error.message);
        throw new Error('Failed to sync to external calendar');
     }
  }
}

module.exports = new CalendarService();
