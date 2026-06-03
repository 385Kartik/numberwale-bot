const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('../parser/aiParser');
const { autoRegisterIfValid, getVendorByGroup, VendorGroup } = require('../services/vendorService');

let sock;

async function connectToWhatsApp() {
    console.log('⌛ Generating WhatsApp session...');
    
    console.log('⌛ Calling useMultiFileAuthState...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    console.log('✅ useMultiFileAuthState done!');

    console.log('⌛ Calling makeWASocket...');
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'error' }), // Show errors instead of silently dying
        browser: ["NumberwaleBot", "Chrome", "1.0.0"],
    });
    console.log('✅ makeWASocket done!');

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\nScan this QR Code to connect your WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('❌ Logged out from WhatsApp! Deleting session folder...');
                require('fs').rmSync('auth_info_baileys', { recursive: true, force: true });
                console.log('🔄 Session deleted. Please restart the bot to scan a new QR code.');
                process.exit(1);
            }
        } else if (connection === 'open') {
            console.log('\n✅ WhatsApp Connected!');
            const { startAutoLogin } = require('../services/importService');
            startAutoLogin();
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

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return; 
        
        const sender = msg.key.remoteJid;
        if (!sender.endsWith('@g.us')) return; 

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (!text) return; 

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

module.exports = { connectToWhatsApp };
