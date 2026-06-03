require('dotenv').config();
const { connectToWhatsApp } = require('./whatsapp/client');
const { connectDB } = require('./services/vendorService');

console.log('🤖 Numberwale Bot starting...');
connectDB().then(() => {
    connectToWhatsApp();
});
