const XLSX = require('xlsx');
const axios = require('axios');
const FormData = require('form-data');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const { classifyEngine, applyBoth, CAT } = require('../classifier/engine');

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

async function processAndImport(items, vendorId) {
    try {
        await loginBot();

        console.log(`\n[⚙️ ENGINE] Classifying & Formatting ${items.length} numbers...`);
        let tableData = [];
        const rows = items.map(item => {
            const clean = String(item.number).replace(/\D/g, '');
            const rate = String(item.rate || '0').replace(/\D/g, '');
            const discount = String(item.discount || '0').replace(/\D/g, '');
            const portStatus = (item.port && item.port.toUpperCase() === 'CRTP') ? 'CRTP' : 'RTP';
            
            const res = classifyEngine(clean);
            const styled = applyBoth(clean, res.matches);
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

        console.log(`[📤 API] Pushing Excel data to /api/v1/products/import...`);
        const response = await client.post(
            `${BASE_URL}/api/v1/products/import`,
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
    try {
        await loginBot();
        
        console.log(`\n[📤 API] Initiating removal sequence for ${numbers.length} numbers by ${vendorEmail}...`);
        const cleanNumbers = numbers.map(num => String(num.number || num).replace(/\D/g, ''));
        
        try {
            const res = await client.post(`${BASE_URL}/api/v1/products/bulk-mark-sold-by-vendor`, { 
                mobileNumbers: cleanNumbers,
                vendorEmail: vendorEmail
            });
            console.log(`[📤 API] Bulk remove Status: ${res.status}`);
            if (res.data) console.log(`[📤 API] Response: ${JSON.stringify(res.data)}`);
            return res.data;
        } catch (err) {
            console.error(`[❌ API ERROR] Failed to bulk remove numbers:`, err.response?.data || err.message);
            return null;
        }
    } catch (err) {
        console.error('[❌ API ERROR] Remove login failed:', err.message);
        return null;
    }
}

async function updateVendorStatus(vendorEmail, targetStatus) {
    try {
        await loginBot();
        
        console.log(`\n[📤 API] Initiating vendor status update for ${vendorEmail} to "${targetStatus}"...`);
        
        try {
            const res = await client.post(`${BASE_URL}/api/v1/products/update-vendor-status`, { 
                vendorEmail: vendorEmail,
                targetStatus: targetStatus
            });
            console.log(`[📤 API] Status Update: ${res.status}`);
            if (res.data) console.log(`[📤 API] Response: ${JSON.stringify(res.data)}`);
            return res.data;
        } catch (err) {
            console.error(`[❌ API ERROR] Failed to update vendor status:`, err.response?.data || err.message);
        }
    } catch (err) {
        console.error('[❌ API ERROR] Login failed for status update:', err.message);
    }
}

function startAutoLogin() {
    loginBot().catch(console.error);
    // Auto login every 5 minutes
    setInterval(() => {
        loginBot().catch(console.error);
    }, 5 * 60 * 1000);
}

module.exports = {
    processAndImport,
    removeNumbers,
    startAutoLogin,
    updateVendorStatus
};
