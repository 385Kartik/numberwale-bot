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
            
            let catId, styled;
            
            if (item.styledNumber && item.category) {
                // Use pre-classified values if they exist (from new local classifier flow)
                catId = item.category;
                styled = item.styledNumber;
            } else {
                // Fallback to legacy behavior
                const res = classifyEngine(clean);
                catId = res.catId;
                if (keepSpacing) {
                    styled = applyBothWithCustomSpaces(numStrForSpace, res.matches);
                } else {
                    styled = applyBoth(clean, res.matches);
                }
            }
            
            const catName = CAT[catId] || 'Category';

            tableData.push({
                'ORIGINAL NUMBER': clean,
                'CATEGORY ID': catId,
                'CATEGORY NAME': catName,
                'STYLED NUMBER': styled,
                'RATE': rate,
                'DISCOUNT': discount,
                'VENDOR ID': vendorId,
                'PORT': portStatus
            });

            return [clean, styled, catId, portStatus, rate, discount, vendorId];
        });

        console.log(`\n[📊 CLASSIFICATION RESULTS]`);
        console.table(tableData);
        

        const CHUNK_SIZE = 500;
        const totalBatches = Math.ceil(rows.length / CHUNK_SIZE);
        
        for (let i = 0; i < totalBatches; i++) {
            const start = i * CHUNK_SIZE;
            const chunk = rows.slice(start, start + CHUNK_SIZE);
            
            console.log(`\n[📤 API] Generating Excel file for Batch ${i + 1}/${totalBatches} (${chunk.length} numbers)...`);
            const wsData = [
                ['Vanity Number', 'Styled Number', 'Category ID',
                 'Ready to Port', 'Vendor Rate', 'Vendor Discount', 'Vendor ID'],
                ...chunk
            ];
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            XLSX.utils.book_append_sheet(wb, ws, 'Classified');
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            const form = new FormData();
            form.append('files', buffer, {
                filename: `bot-import-batch-${i + 1}.xlsx`,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });

            console.log(`[📤 API] Pushing Batch ${i + 1}/${totalBatches} to /api/v1/products/import...`);
            const response = await client.post(
                `${BASE_URL}/api/v1/products/import`,
                form,
                { headers: form.getHeaders() }
            );

            console.log(`[📤 API] Batch ${i + 1} Response: ${response.status} ${response.statusText}`);
            if(response.data) console.log(`[📤 API] Batch ${i + 1} Data: ${JSON.stringify(response.data)}`);
            
            // Wait 2 seconds before uploading the next batch to let server breathe
            if (i < totalBatches - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        return { success: true, message: `Successfully processed ${totalBatches} batches.` };
    } catch (err) {
        console.error('[❌ API ERROR] Import failed:', err.response?.data || err.message);
        throw err;
    }
}

async function removeNumbers(numbers, vendorEmail) {
    console.log(`\n[📤 API] Initiating removal sequence for ${numbers.length} numbers by ${vendorEmail}...`);
    const cleanNumbers = numbers.map(num => String(num.number || num).replace(/\D/g, ''));
    
    try {
        const res = await client.post(`${BASE_URL}/api/v1/products/bulk-mark-sold-by-vendor`, { 
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
        
        const res = await client.put(`${BASE_URL}/api/v1/vendors/action/toggle-by-email`, {
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

        
        const res = await client.get(`${BASE_URL}/api/v1/oldOrder/bot-inquiry?email=${vendorEmail}`);
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
