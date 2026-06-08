const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { parseIntent, generateReply } = require('../parser/aiParser');
const { processText, processExcelBuffer, splitMixedIntentText } = require('../services/classifierService');
const importService = require('../services/importService');
const { autoRegisterIfValid, getVendorByGroup, VendorGroup } = require('../services/vendorService');

let sock;
let currentQR = null;
let isConnected = false;

function getBotStatus() {
    return { connected: isConnected, qr: currentQR };
}

async function processVendorMessage(sock, msg, sender, vendorId) {
    try {
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.documentMessage?.caption || '';
        const isDocument = !!msg.message.documentMessage;
        const isImageOrVideo = !!msg.message.imageMessage || !!msg.message.videoMessage;

        // Ignore images and videos without documents
        if (isImageOrVideo) {
            console.log(`[⏭️ IGNORED] Image/Video ignored as per rules.`);
            await sock.sendMessage(sender, { text: "⚠️ Photos aur videos is bot par support nahi hote. Kripya apne numbers Text ya Excel/CSV format mein bhejein." });
            return;
        }

        if (!textMessage && !isDocument) {
             console.log(`[🔍 DEBUG] Empty message ignored.`);
             return;
        }

        let docMime = '';
        let docFileName = '';
        if (isDocument) {
            docMime = msg.message.documentMessage.mimetype || '';
            docFileName = msg.message.documentMessage.fileName || '';
            const validDocs = ['.xlsx', '.xls', '.csv'];
            const isValidDoc = validDocs.some(ext => docFileName.toLowerCase().endsWith(ext)) || 
                               docMime.includes('spreadsheet') || 
                               docMime.includes('csv') ||
                               docMime.includes('excel');
            if (!isValidDoc) {
                console.log(`[⏭️ IGNORED] Unsupported document type: ${docFileName} (${docMime})`);
                await sock.sendMessage(sender, { text: "⚠️ Ye file type support nahi hota. Kripya sirf Excel (.xlsx, .xls) ya CSV files hi bhejein." });
                return;
            }
        }

        // 1. AI Intent Classification (Fast)
        console.log(`\n[🧠 AI PARSER] Sending caption/text to Gemini for INTENT parsing...`);
        const parsedIntent = await parseIntent(textMessage);
        
        // If it's a document, check the file name for "with spacing" keywords
        if (isDocument) {
            const lowerFileName = docFileName.toLowerCase();
            if (lowerFileName.includes('with space') || lowerFileName.includes('with spacing') || 
                lowerFileName.includes('keep space') || lowerFileName.includes('keep spacing')) {
                parsedIntent.keepSpacing = true;
            }
        }

        console.log(`   ➜ Action: ${parsedIntent.action}`);
        console.log(`   ➜ Discount: ${parsedIntent.vendorDiscount || 'None'}`);
        console.log(`   ➜ Keep Spacing: ${parsedIntent.keepSpacing}`);

        if (parsedIntent.action === 'IGNORE' || parsedIntent.action === 'HELP') {
             console.log(`[⏭️ ${parsedIntent.action}] AI marked as ${parsedIntent.action}.`);
             let replyText = "";
             if (parsedIntent.action === 'HELP') {
                 replyText = await generateReply('HELP');
             } else {
                 replyText = parsedIntent.reply_message || "⚠️ I didn't understand. Please send a valid request or list of numbers to add/remove.";
             }
             await sock.sendMessage(sender, { text: replyText });
             return;
        }

        if (parsedIntent.action === 'DEACTIVATE' || parsedIntent.action === 'ACTIVATE') {
            const targetStatus = parsedIntent.action === 'DEACTIVATE' ? 'vendor deactivated' : 'available';
            const apiResult = await importService.updateVendorStatus(vendorId, targetStatus);
            const replyMsg = await generateReply(parsedIntent.action, 0, [], [], [], null, [], apiResult);
            await sock.sendMessage(sender, { text: replyMsg });
            return;
        }

        if (parsedIntent.action === 'INQUIRY') {
            const inquiryData = await importService.getVendorInquiry(vendorId);
            if (!inquiryData) {
                await sock.sendMessage(sender, { text: "❌ Sorry, I could not fetch your account details right now. Please try again later." });
                return;
            }
            const replyMsg = await generateReply('INQUIRY', 0, [], [], [], inquiryData);
            await sock.sendMessage(sender, { text: replyMsg });
            return;
        }

        // 2. Data Extraction & Splitting
        let addText = '';
        let removeText = '';
        let addBuffer = null;

        if (isDocument) {
            console.log(`[📁 EXCEL] Downloading document: ${docFileName}...`);
            addBuffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            console.log(`[📁 EXCEL] Document downloaded.`);
            // Documents are inherently ADD unless specifically said REMOVE, but we'll respect intent
        } else {
            if (parsedIntent.action === 'MIXED') {
                const chunks = splitMixedIntentText(textMessage);
                addText = chunks.addText;
                removeText = chunks.removeText;
            } else if (parsedIntent.action === 'ADD') {
                addText = textMessage;
            } else if (parsedIntent.action === 'REMOVE') {
                removeText = textMessage;
            }
        }

        let combinedReply = "";

        // ---- REMOVE PROCESSING ----
        if (removeText || (isDocument && parsedIntent.action === 'REMOVE')) {
            console.log(`[📝 REMOVE] Processing Removal chunk...`);
            let removeResultData = isDocument ? processExcelBuffer(addBuffer, parsedIntent.keepSpacing) : processText(removeText, parsedIntent.keepSpacing);
            
            if (removeResultData.validNumbers.length > 0) {
                const itemsToRemove = removeResultData.validNumbers.map(v => ({ number: v.number }));
                const removeResult = await importService.removeNumbers(itemsToRemove, vendorId);
                
                let failedIds = [];
                let unauthorizedIds = [];
                if (removeResult && removeResult.result) {
                    if (removeResult.result.failedItems) failedIds = removeResult.result.failedItems.map(f => f.identifier);
                    if (removeResult.result.unauthorizedItems) unauthorizedIds = removeResult.result.unauthorizedItems;
                }
                
                combinedReply += await generateReply('REMOVE', removeResultData.validNumbers.length - failedIds.length - unauthorizedIds.length, [], failedIds, unauthorizedIds);
            } else {
                combinedReply += "❌ No valid 10-digit numbers found to remove.";
            }
        }

        // ---- ADD PROCESSING ----
        if (addText || (isDocument && parsedIntent.action !== 'REMOVE' && parsedIntent.action !== 'IGNORE')) {
            console.log(`[📝 ADD] Processing Add chunk...`);
            let addResultData = isDocument && addBuffer ? processExcelBuffer(addBuffer, parsedIntent.keepSpacing) : processText(addText, parsedIntent.keepSpacing);
            
            if (addResultData.validNumbers.length > 0) {
                const itemsToAdd = [];
                const noRateNumbers = [];
                
                addResultData.validNumbers.forEach(v => {
                    let rateVal = v.vendorRate || parsedIntent.vendorRate || '';
                    if (!rateVal || rateVal === '0') {
                        noRateNumbers.push(v.number);
                    } else {
                        itemsToAdd.push({
                            number: v.number,
                            styledNumber: v.styledNumber,
                            category: v.categoryId, 
                            rate: rateVal,
                            discount: parsedIntent.vendorDiscount || '0',
                            port: parsedIntent.readyToPort || 'RTP'
                        });
                    }
                });

                if (itemsToAdd.length > 0) {
                    console.log(`\n[☁️ UPLOAD] Uploading ${itemsToAdd.length} numbers to server...`);
                    const sample = itemsToAdd.slice(0, 3).map(n => n.styledNumber).join(', ');
                    console.log(`   ➜ Sample: ${sample}${itemsToAdd.length > 3 ? '...' : ''}`);
                    await importService.processAndImport(itemsToAdd, vendorId, parsedIntent.keepSpacing);
                }
                
                if (combinedReply.length > 0) combinedReply += "\n\n";
                combinedReply += await generateReply('ADD', itemsToAdd, addResultData.invalidNumbers, null, null, null, noRateNumbers, null, parsedIntent.keepSpacing);
            } else {
                if (combinedReply.length > 0) combinedReply += "\n\n";
                combinedReply += await generateReply('ADD', [], addResultData.invalidNumbers, null, null, null, [], null, parsedIntent.keepSpacing);
            }
        }

        if (combinedReply) {
            await sock.sendMessage(sender, { text: combinedReply.trim() });
        }

    } catch (err) {
        console.error('Message Processing error:', err.message);
        await sock.sendMessage(sender, { text: "⚠️ System Error: Unable to process the request." }).catch(console.error);
    }
}

async function connectToWhatsApp() {
    console.log('⌛ Generating WhatsApp session...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    console.log('✅ useMultiFileAuthState done!');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'error' }), // Enable error logs to see why it crashes
        browser: ["NumberwaleBot", "Chrome", "1.0.0"],
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            currentQR = qr;
            isConnected = false;
            qrcode.generate(qr, { small: true });
            importService.updateQRStatus(qr, false).catch(() => {});
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log(`⚠️ Connection dropped (Status: ${statusCode}, Reason: ${lastDisconnect?.error?.message}). Reconnecting in 3 seconds...`);
                setTimeout(connectToWhatsApp, 3000);
            } else {
                console.log('❌ Logged out from WhatsApp! Deleting session folder...');
                require('fs').rmSync('auth_info_baileys', { recursive: true, force: true });
                importService.updateQRStatus(null, false).catch(() => {});
                process.exit(1);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('\n✅ WhatsApp Connected!');
            importService.updateQRStatus(null, true).catch(() => {});
        }
    });

    sock.ev.on('groups.update', async (updates) => {
        for (const update of updates) {
            if (!update.subject) continue; 
            const PATTERN = /^(.+?)\(numberwale\)/i;
            const match = update.subject.trim().match(PATTERN);

            if (match) {
                await autoRegisterIfValid(update.id, update.subject);
            } else {
                await VendorGroup.findOneAndUpdate({ groupJid: update.id }, { active: false });
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Prevent duplicate processing by only reacting to 'notify' (new messages)
        if (type !== 'notify') return;
        
        const msg = messages[0];
        if (!msg || msg.key.fromMe || !msg.message) return;
        
        const sender = msg.key.remoteJid;
        if (!sender.endsWith('@g.us')) return;

        let vendor = await getVendorByGroup(sender);
        if (!vendor) {
            try {
                const metadata = await sock.groupMetadata(sender);
                vendor = await autoRegisterIfValid(sender, metadata.subject);
            } catch (err) {
                console.error("[❌ ERROR] Failed to fetch group metadata:", err.message);
            }
            if (!vendor) return;
        }

        await processVendorMessage(sock, msg, sender, vendor.vendorId);
    });

    sock.ev.on('creds.update', saveCreds);
}

module.exports = {
    connectToWhatsApp,
    getBotStatus
};
