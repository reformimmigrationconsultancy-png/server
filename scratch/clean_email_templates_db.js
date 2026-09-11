const mongoose = require('mongoose');
const EmailTemplate = require('../src/models/EmailTemplate');
require('dotenv').config({ path: './server/.env' });

async function checkTemplates() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const templates = await EmailTemplate.find({});
    console.log(`Found ${templates.length} email templates in DB:`);
    
    let updatedCount = 0;
    for (const t of templates) {
      console.log(`\nTemplate: "${t.name}" | Subject: "${t.subject}"`);
      let changed = false;

      if (t.subject && t.subject.toLowerCase().includes('crm')) {
        t.subject = t.subject.replace(/crm/gi, '').replace(/\s+/g, ' ').trim();
        changed = true;
      }

      if (t.body && t.body.toLowerCase().includes('crm')) {
        t.body = t.body.replace(/manpreet crm team/gi, 'Manpreet Singh Team')
                       .replace(/the crm team/gi, 'Manpreet Singh')
                       .replace(/lead crm/gi, 'Manpreet Singh')
                       .replace(/crm/gi, '');
        changed = true;
      }

      if (changed) {
        await t.save();
        updatedCount++;
        console.log(`✅ Updated template: "${t.name}"`);
      }
    }

    console.log(`\nUpdated ${updatedCount} email templates in database.`);
    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

checkTemplates();
