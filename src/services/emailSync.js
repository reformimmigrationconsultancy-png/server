/**
 * EmailSyncService - PERMANENTLY DISABLED
 * Lead CRM now strictly receives leads from Meta Ads, Google Ads, and Website Forms.
 */
class EmailSyncService {
  constructor(app) {
    this.app = app;
  }

  start() {
    console.log('🛑 [EmailSyncService] Email lead sync is permanently disabled.');
  }

  async sync() {
    return;
  }
}

module.exports = EmailSyncService;
