const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('../parser/aiParser');
const { autoRegisterIfValid, getVendorByGroup, VendorGroup } = require('../services/vendorService');

let sock;
let currentQR = null;
let isConnected = false;

function getBotStatus() {
    return { connected: isConnected, qr: currentQR };
}

async function connectToWhatsApp() {
    console.log('⌛ Generating WhatsApp session...');
    
    console.log('⌛ Calling useMultiFileAuthState...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    console.log('✅ useMultiFileAuthState done!');

    console.log('⌛ Calling makeWASocket...');
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'debug' }), // Show all logs
        browser: ["NumberwaleBot", "Chrome", "1.0.0"],
    });
    console.log('✅ makeWASocket done!');

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        const { updateQRStatus } = require('../services/importService');
        
        console.log(`[🔗 CONNECTION UPDATE] Status: ${connection || 'Connecting...'} | QR Present: ${!!qr}`);

        if (qr) {
            currentQR = qr;
            isConnected = false;
            console.log('\nScan this QR Code to connect your WhatsApp:');
            qrcode.generate(qr, { small: true });
            // Send QR to server for Admin panel display
            updateQRStatus(qr, false).catch(() => {});
        }

        if (connection === 'close') {
            isConnected = false;
            currentQR = null;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[🔗 CONNECTION CLOSED] Reason code: ${lastDisconnect?.error?.output?.statusCode}, Should reconnect: ${shouldReconnect}`);
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('❌ Logged out from WhatsApp! Deleting session folder...');
                require('fs').rmSync('auth_info_baileys', { recursive: true, force: true });
                updateQRStatus(null, false).catch(() => {});
                console.log('🔄 Session deleted. Please restart the bot to scan a new QR code.');
                process.exit(1);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentQR = null;
            console.log('\n✅ WhatsApp Connected!');
            // Update admin panel status to connected
            updateQRStatus(null, true).catch(() => {});
        }
    });

    // Group update listener for auto-registration
    sock.ev.on('groups.update', async (updates) => {
        for (const update of updates) {
            if (!update.subject) continue; 
            console.log(`\n[🔍 WHATSAPP] Group Name Update Detected: "${update.subject}" (JID: ${update.id})`);

            const PATTERN = /^(.+?)\(numberwale\)/i;
            const match = update.subject.trim().match(PATTERN);

            if (match) {
                console.log(`[🔍 WHATSAPP] Pattern matched! Extracted Vendor Name: "${match[1].trim()}"`);
                await autoRegisterIfValid(update.id, update.subject);
            } else {
                console.log(`[🔍 WHATSAPP] Pattern did not match for "${update.subject}". Deactivating if exists...`);
                await VendorGroup.findOneAndUpdate(
                    { groupJid: update.id },
                    { active: false }
                );
                console.log(`[⚠️ VENDOR] Vendor Group Deactivated: ${update.id}`);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        console.log(`\n[🔍 DEBUG] messages.upsert event triggered! Type: ${type}`);
        const msg = messages[0];
        if (!msg) {
            console.log(`[🔍 DEBUG] No message object in array.`);
            return;
        }

        if (msg.key.fromMe) {
            console.log(`[🔍 DEBUG] Ignoring message from me.`);
            return;
        }
        
        if (!msg.message) {
            console.log(`[🔍 DEBUG] Message has no content (stub/system message).`);
            return;
        }
        
        const sender = msg.key.remoteJid;
        console.log(`[🔍 DEBUG] Message from sender: ${sender}`);

        if (!sender.endsWith('@g.us')) {
            console.log(`[🔍 DEBUG] Ignoring message from non-group chat.`);
            return; 
        }

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.documentMessage?.caption || '';
        if (!text) {
            console.log(`[🔍 DEBUG] No text/caption found in the message. Types present: ${Object.keys(msg.message).join(', ')}`);
            return; 
        }

        console.log(`\n[📩 MESSAGE RECEIVED] From JID: ${sender}`);
        console.log(`[📩 CONTENT]: "${text}"`);

        console.log(`[🔍 VENDOR CHECK] Looking up vendor for JID: ${sender}...`);
        let vendor = await getVendorByGroup(sender);

        if (!vendor) {
            console.log(`[🔍 VENDOR CHECK] Not found in DB. Fetching group metadata from WhatsApp...`);
            try {
                const metadata = await sock.groupMetadata(sender);
                console.log(`[🔍 VENDOR CHECK] Group name fetched: "${metadata.subject}"`);
                vendor = await autoRegisterIfValid(sender, metadata.subject);
            } catch (err) {
                console.error("[❌ ERROR] Failed to fetch group metadata:", err.message);
            }
            if (!vendor) {
                console.log(`[⏭️ IGNORED] Message ignored as group does not match vendor pattern.`);
                return;
            }
        }

        console.log(`[✅ VENDOR MATCHED] Message from Authorized Vendor: ${vendor.vendorName} (${vendor.vendorId})`);
        await handleMessage(sock, sender, text, vendor.vendorId);
    });

    sock.ev.on('creds.update', saveCreds);
}

module.exports = { connectToWhatsApp, getBotStatus };
