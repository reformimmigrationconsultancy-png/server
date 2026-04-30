const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function testUpload() {
  const form = new FormData();
  // Create a dummy file
  fs.writeFileSync('server/scratch/dummy.png', 'dummy data');
  form.append('file', fs.createReadStream('server/scratch/dummy.png'));

  try {
    const response = await axios.post('http://localhost:8000/api/upload', form, {
      headers: form.getHeaders(),
    });
    console.log('✅ Upload Success:', response.data);
  } catch (error) {
    console.error('❌ Upload Failed!');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Message:', error.message);
    }
  }
}

testUpload();
