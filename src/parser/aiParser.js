const { GoogleGenAI } = require('@google/genai');
const { processAndImport, removeNumbers } = require('../services/importService');

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function handleMessage(sock, sender, text, defaultVendorId) {
    try {
        console.log(`\n[🧠 AI PARSER] Sending text to Gemini API for intent classification...`);
        const parsed = await parseWithAI(text);
        
        console.log(`[🧠 AI PARSER] Response received from Gemini!`);
        console.log(`   ➜ Action: ${parsed.action}`);
        console.log(`   ➜ Items: ${parsed.items ? parsed.items.length : 0} found`);
        console.log(`   ➜ Email: ${parsed.vendor_email || 'None'}`);
        
        if (parsed.action === 'IGNORE') {
            console.log(`[⏭️ AI PARSER] Ignored. Not a valid add/remove command.`);
            return;
        }

        if (parsed.action === 'DEACTIVATE' || parsed.action === 'ACTIVATE') {
            const finalVendorId = parsed.vendor_email || defaultVendorId;
            if (!finalVendorId || !finalVendorId.includes('@')) {
                console.log(`[⚠️ AI PARSER] Vendor ID (email) missing for status update!`);
                await sock.sendMessage(sender, { text: "Please provide your vendor id (email id) in the group name to update your availability." });
                return;
            }

            const targetStatus = parsed.action === 'DEACTIVATE' ? 'vendor deactivated' : 'available';
            console.log(`[⚙️ ENGINE] Initiating Status Update Process: ${targetStatus} for Vendor: ${finalVendorId}...`);
            
            const importService = require('../services/importService');
            await importService.updateVendorStatus(finalVendorId, targetStatus);
            
            const replyMsg = parsed.action === 'DEACTIVATE' 
                ? "⏸️ Your numbers have been temporarily deactivated." 
                : "▶️ Your numbers are now available again.";
            await sock.sendMessage(sender, { text: replyMsg });
            return;
        }

        if ((parsed.action === 'ADD' || parsed.action === 'REMOVE') && parsed.items && parsed.items.length > 0) {
            const validItems = [];
            const invalidNumbers = [];

            parsed.items.forEach(item => {
                const cleanNum = String(item.number || item).replace(/\D/g, '');
                if (cleanNum.length === 10) {
                    validItems.push(item);
                } else {
                    invalidNumbers.push(item.number || item);
                }
            });

            parsed.items = validItems;

            let invalidMsg = "";
            if (invalidNumbers.length > 0) {
                invalidMsg = `\n\n⚠️ The following numbers are not 10 digits, so they are ignored:\n${invalidNumbers.join(', ')}`;
            }

            if (parsed.items.length === 0) {
                console.log(`[⚠️ AI PARSER] No valid 10-digit numbers found.`);
                await sock.sendMessage(sender, { text: `⚠️ None of the numbers provided are valid 10-digit numbers:\n${invalidNumbers.join(', ')}` });
                return;
            }

            // Priority: Email from message > Email from group (defaultVendorId)
            const finalVendorId = parsed.vendor_email || defaultVendorId;
            
            if (parsed.action === 'ADD') {
                if (!finalVendorId || !finalVendorId.includes('@')) {
                    console.log(`[⚠️ AI PARSER] Vendor ID (email) missing in message and group name! Requesting from user...`);
                    await sock.sendMessage(sender, { text: "Please provide your vendor id (email id) in the group name or your message to add these numbers on our website." });
                    return;
                }

                console.log(`[⚙️ ENGINE] Initiating Add Process for ${parsed.items.length} numbers using Vendor: ${finalVendorId}...`);
                const importService = require('../services/importService');
                const importResult = await importService.processAndImport(parsed.items, finalVendorId);
                console.log(`[✅ SUCCESS] Import process completed.`);
                
                // Reply on WhatsApp
                let numsAddedList = parsed.items.map(i => i.number || i);
                let soldNumbers = [];

                if (importResult && importResult.filesProcessed && importResult.filesProcessed.length > 0) {
                    const skippedRows = importResult.filesProcessed[0].skippedRows || [];
                    for (const skipped of skippedRows) {
                        if (skipped.error && skipped.error.includes("has been sold to customer")) {
                            const skippedNum = skipped.row ? (skipped.row["Vanity Number"] || skipped.row["ORIGINAL NUMBER"]) : null;
                            if (skippedNum) {
                                soldNumbers.push(String(skippedNum).trim());
                            }
                        }
                    }
                }

                // Remove sold numbers from numsAddedList
                numsAddedList = numsAddedList.filter(num => !soldNumbers.includes(String(num).trim()));

                let successMsg = numsAddedList.length > 0 
                    ? `✅ These numbers are added successfully:\n${numsAddedList.join(', ')}` 
                    : `⚠️ No numbers were added.`;

                let soldMsg = "";
                if (soldNumbers.length > 0) {
                    soldMsg = `\n\n⚠️ The following numbers were not added because they are already sold:\n${soldNumbers.join(', ')}`;
                }

                await sock.sendMessage(sender, { text: `${successMsg}${soldMsg}${invalidMsg}` });

            } else if (parsed.action === 'REMOVE') {
                if (!finalVendorId || !finalVendorId.includes('@')) {
                    console.log(`[⚠️ AI PARSER] Vendor ID (email) missing in message and group name! Requesting from user...`);
                    await sock.sendMessage(sender, { text: "Please provide your vendor id (email id) in the group name or your message to remove these numbers." });
                    return;
                }

                console.log(`[🗑️ ENGINE] Initiating Remove Process for ${parsed.items.length} numbers using Vendor: ${finalVendorId}...`);
                const importService = require('../services/importService');
                const apiResponse = await importService.removeNumbers(parsed.items, finalVendorId);
                console.log(`[✅ SUCCESS] Successfully processed remove request!`);
                
                // Extract 10-digit raw strings
                let numsRemoved = parsed.items.map(item => String(item.number || item).replace(/\D/g, ''));
                let unauthorizedMsg = "";

                const resultObj = apiResponse && apiResponse.result ? apiResponse.result : null;

                if (resultObj && resultObj.unauthorizedItems && resultObj.unauthorizedItems.length > 0) {
                    unauthorizedMsg = `\n\n⚠️ The following numbers are NOT removed because they were not added by you:\n${resultObj.unauthorizedItems.join(', ')}`;
                    numsRemoved = numsRemoved.filter(num => !resultObj.unauthorizedItems.includes(num));
                }

                let failedMsg = "";
                if (resultObj && resultObj.failedItems && resultObj.failedItems.length > 0) {
                    const failedIds = resultObj.failedItems.map(f => f.identifier);
                    failedMsg = `\n\n⚠️ The following numbers were not found or already sold:\n${failedIds.join(', ')}`;
                    numsRemoved = numsRemoved.filter(num => !failedIds.includes(num));
                }
                
                let successMsg = numsRemoved.length > 0 
                    ? `🗑️ These numbers are removed successfully:\n${numsRemoved.join(', ')}` 
                    : `⚠️ No numbers were removed.`;

                await sock.sendMessage(sender, { text: `${successMsg}${unauthorizedMsg}${failedMsg}${invalidMsg}` });
            }
        }
    } catch (err) {
        console.error('Parser error:', err.message);
    }
}

async function parseWithAI(text) {
    const prompt = `You are parsing WhatsApp messages from a VIP mobile number vendor.
Extract the action, phone numbers, and the vendor's email id if present in the message.

Return ONLY valid JSON, no explanation:
{
  "action": "ADD" | "REMOVE" | "DEACTIVATE" | "ACTIVATE" | "UPC" | "IGNORE",
  "vendor_email": "example@gmail.com" | null,
  "items": [
      { "number": "9876543210", "rate": "2000", "discount": "0", "port": "RTP" }
  ]
}

Rules:
  - ADD: vendor is making numbers available for sale
  - REMOVE: vendor says numbers are sold or removing from inventory
  - DEACTIVATE: vendor says they are not available, out of station, going on leave, etc.
  - ACTIVATE: vendor says they are available now, back to work, etc.
  - UPC: vendor is sending a UPC/tracking code
  - IGNORE: casual chat, greetings, irrelevant messages
  - Extract ALL phone numbers provided. Phone numbers are typically around 10 digits long. Do NOT confuse rates, prices, or discounts (which are usually 1 to 5 digits) for phone numbers!
  - You MUST extract the 'rate' if provided, even if it does not contain 'rs'. Rate is usually the 3 to 5 digit number next to the phone number.
  - Strip country codes like +91 or spaces, but DO NOT remove leading zeros if the number itself starts with 0.
  - If rate or discount is missing, return "" or "0". Do NOT leave the field out.
  - For 'port', use "CRTP" if the vendor explicitly mentions CRTP for a number. If they write "CRTP" at the top or generally for the message, apply "CRTP" to ALL numbers in that message. Otherwise, always default to "RTP".
  - Extract any valid email address as vendor_email, otherwise return null.

User message:
${text}`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
        config: {
            temperature: 0,
            responseMimeType: "application/json",
        }
    });

    const raw = response.text.trim();
    return JSON.parse(raw);
}

module.exports = { handleMessage };