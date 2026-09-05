const { ImapFlow } = require('imapflow');
require('dotenv').config();

async function debugFilters() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT),
    secure: true,
    auth: {
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS
    },
    tls: { rejectUnauthorized: false },
    logger: false
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      console.log('--- DEBUGGING FILTERS FOR UNSEEN EMAILS ---');
      const searchArr = { seen: false };
      
      const noReplyKeywords = ['no-reply', 'noreply', 'donotreply', 'updates', 'alerts', 'marketing', 'newsletter', 'hello@', 'info@', 'messages-noreply'];
      const spamDomains = ['linkedin.com', 'simplilearnmailer.com', 'foundit', 'bayt.com', 'unstop.com', 'naukri.com', 'mailer'];


      let count = 0;
      for await (let message of client.fetch(searchArr, { envelope: true })) {
        if (count >= 10) break;
        const fromEmail = message.envelope.from[0].address.toLowerCase();
        const subject = message.envelope.subject;
        
        let isFiltered = false;
        let reason = '';

        if (noReplyKeywords.some(keyword => fromEmail.includes(keyword))) {
          isFiltered = true;
          reason = 'no-reply/automated keywords';
        } else if (spamDomains.some(domain => fromEmail.includes(domain))) {
          isFiltered = true;
          reason = 'promotional domain';
        }

        console.log(`- From: ${fromEmail}`);
        console.log(`  Subject: ${subject}`);
        console.log(`  Filtered: ${isFiltered ? 'YES (' + reason + ')' : 'NO (This should show up!)'}`);
        console.log('-------------------');
        count++;
      }
      
      if (count === 0) console.log('No unseen emails found.');
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error('❌ Error debugging Gmail:', err.message);
  }
}

debugFilters();
