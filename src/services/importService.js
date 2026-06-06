const XLSX = require('xlsx');
const axios = require('axios');
const FormData = require('form-data');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { classifyEngine, applyBoth, applyBothWithCustomSpaces, CAT } = require('../classifier/engine');

const BASE_URL = process.env.ADMIN_URL || 'http://localhost:7869';

// Cookie jar — session yahan store hogi
const jar = new CookieJar();
const client = wrapper(axios.create({ jar, withCredentials: true }));

async function loginBot() {
    console.log(`[📤 API] Attempting login to Admin Portal (${BASE_URL}/api/v1/admins/auth/login)...`);
    await client.post(`${BASE_URL}/api/v1/admins/auth/login`, {
        email: process.env.BOT_EMAIL,
        password: process.env.BOT_PASSWORD
    });
    console.log('🔐 Bot logged in');
}

async function refreshTokenBot() {
    try {
        await client.post(`${BASE_URL}/api/v1/admins/auth/refresh-token`);
    } catch (err) {
        console.error('[❌ API] Refresh token failed. Falling back to full login...');
        await loginBot();
    }
}

async function processAndImport(items, vendorId, keepSpacing = false) {
    try {

        console.log(`\n[⚙️ ENGINE] Classifying & Formatting ${items.length} numbers (Keep Spacing: ${keepSpacing})...`);
        let tableData = [];
        const rows = items.map(item => {
            const numStrForSpace = String(item.number).trim();
            const clean = numStrForSpace.replace(/\D/g, '');
            const rate = String(item.rate || '0').replace(/\D/g, '');
            const discount = String(item.discount || '0').replace(/\D/g, '');
            const portStatus = (item.port && item.port.toUpperCase() === 'CRTP') ? 'CRTP' : 'RTP';
            
            const res = classifyEngine(clean);
            
            let styled = "";
            if (keepSpacing) {
                styled = applyBothWithCustomSpaces(numStrForSpace, res.matches);
            } else {
                styled = applyBoth(clean, res.matches);
            }
            
            const catName = CAT[res.catId] || 'Category';

            tableData.push({
                'ORIGINAL NUMBER': clean,
                'CATEGORY ID': res.catId,
                'CATEGORY NAME': catName,
                'STYLED NUMBER': styled,
                'RATE': rate,
                'DISCOUNT': discount,
                'VENDOR ID': vendorId,
                'PORT': portStatus
            });

            return [clean, styled, res.catId, portStatus, rate, discount, vendorId];
        });

        console.log(`\n[📊 CLASSIFICATION RESULTS]`);
        console.table(tableData);
        

        console.log(`\n[📤 API] Generating Excel file in memory...`);
        const wsData = [
            ['Vanity Number', 'Styled Number', 'Category ID',
             'Ready to Port', 'Vendor Rate', 'Vendor Discount', 'Vendor ID'],
            ...rows
        ];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, 'Classified');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const form = new FormData();
        form.append('files', buffer, {
            filename: 'bot-import.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        console.log(`[📤 API] Pushing Excel data to /api/v1/bot-api/import...`);
        const response = await client.post(
            `${BASE_URL}/api/v1/bot-api/import`,
            form,
            { headers: form.getHeaders() }
        );

        console.log(`[📤 API] Import API Response: ${response.status} ${response.statusText}`);
        if(response.data) console.log(`[📤 API] Response Data: ${JSON.stringify(response.data)}`);
        return response.data;
    } catch (err) {
        console.error('[❌ API ERROR] Import failed:', err.response?.data || err.message);
        throw err;
    }
}

async function removeNumbers(numbers, vendorEmail) {
    console.log(`\n[📤 API] Initiating removal sequence for ${numbers.length} numbers by ${vendorEmail}...`);
    const cleanNumbers = numbers.map(num => String(num.number || num).replace(/\D/g, ''));
    
    try {
        const res = await client.post(`${BASE_URL}/api/v1/bot-api/bulk-sold`, { 
            mobileNumbers: cleanNumbers,
            vendorEmail: vendorEmail
        });
        console.log(vendorEmail, cleanNumbers)
        console.log(`[📤 API] Bulk remove Status: ${res.status}`);
        if (res.data) console.log(`[📤 API] Response: ${JSON.stringify(res.data)}`);
        return res.data;
    } catch (err) {
        console.error(`[❌ API ERROR] Failed to bulk remove numbers:`, err.response?.data || err.message);
        return null;
    }
}

async function updateVendorStatus(vendorEmail, targetStatus) {
    console.log(`\n[⚙️  API] Initiating vendor status update for ${vendorEmail} to "${targetStatus}"...`);
    
    try {
        const desiredActive = targetStatus === 'available';
        
        const res = await client.put(`${BASE_URL}/api/v1/bot-api/vendor-toggle`, {
            email: vendorEmail,
            active: desiredActive
        });
        console.log(vendorEmail);
        
        console.log(`[⚙️  API] Toggle Status Update: ${res.status}`);
        if (res.data) console.log(`[⚙️  API] Response: ${JSON.stringify(res.data)}`);
        return res.data;
    } catch (err) {
        console.error(`[❌ API ERROR] Failed to update vendor status:`, err.response?.data || err.message);
    }
}

function startAutoLogin() {
    loginBot().catch(console.error);
    // Auto refresh token every 5 minutes
    setInterval(() => {
        refreshTokenBot().catch(console.error);
    }, 5 * 60 * 1000);
}

async function getVendorInquiry(vendorEmail) {
    try {
        console.log(`\n[🔍 API] Fetching inquiry data for ${vendorEmail}...`);

        
        const res = await client.get(`${BASE_URL}/api/v1/bot-api/vendor-inquiry?email=${vendorEmail}`);
        if (res.data && res.data.success) {
            return res.data.data;
        }
        return null;
    } catch (err) {
        console.error('[❌ API ERROR] Failed to fetch vendor inquiry:', err.response?.data || err.message);
        return null;
    }
}

async function updateQRStatus(qr, connected) {
    
    try {
        await client.post(`${BASE_URL}/api/v1/bot-api/status`, { qr, connected });
    } catch (err) {
        console.error('[❌ API ERROR] Failed to update bot status:', err.message);
    }
}

module.exports = {
    loginBot,
    processAndImport,
    removeNumbers,
    startAutoLogin,
    updateVendorStatus,
    getVendorInquiry,
    updateQRStatus
};
