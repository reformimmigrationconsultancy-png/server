const { ImapFlow } = require('imapflow');
require('dotenv').config();

async function checkEmails() {
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
      console.log('Checking INBOX for emails...');
      const status = await client.status('INBOX', { messages: true, unseen: true });
      console.log('Total messages:', status.messages);
      console.log('Unseen messages:', status.unseen);

      // List 5 most recent emails
      console.log('\nLast 5 emails:');
      for await (let message of client.fetch({ seq: `${Math.max(1, status.messages - 4)}:*` }, { envelope: true })) {
        console.log(`- From: ${message.envelope.from[0].address}, Subject: ${message.envelope.subject}`);
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error('❌ Error checking Gmail:', err.message);
  }
}

checkEmails();
