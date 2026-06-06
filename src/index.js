require('dotenv').config();
const { connectToWhatsApp } = require('./whatsapp/client');
const { connectDB } = require('./services/vendorService');


const { startAutoLogin } = require('./services/importService');

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/api/status', (req, res) => {
    const { getBotStatus } = require('./whatsapp/client');
    res.json({ success: true, data: getBotStatus() });
});

app.listen(7870, () => {
    console.log(`[🌐 SERVER] Bot status API running on http://localhost:7870`);
});

connectDB().then(() => {
    startAutoLogin();
    connectToWhatsApp();
});
