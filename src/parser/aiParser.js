require('dotenv').config();
const Groq = require('groq-sdk');
const OpenAI = require('openai');

// ─── Clients Init ─────────────────────────────────────────────────────────
const groqKeys = [];
if (process.env.GROQ_API_KEY) groqKeys.push(process.env.GROQ_API_KEY);
if (process.env.GROQ_API_KEYS) groqKeys.push(...process.env.GROQ_API_KEYS.split(',').map(k => k.trim()));
for (let i = 1; i <= 5; i++) {
    if (process.env[`GROQ_API_KEY_${i}`]) groqKeys.push(process.env[`GROQ_API_KEY_${i}`]);
}

const uniqueGroqKeys = [...new Set(groqKeys)].filter(Boolean);
const groqClients = uniqueGroqKeys.map(key => new Groq({ apiKey: key }));

if (groqClients.length === 0) {
    console.warn('[⚠️ GROQ] No GROQ API Keys found in .env! Skipping Groq models.');
} else {
    console.log(`[🟢 GROQ] Initialized ${groqClients.length} Groq API keys for smart load balancing.`);
}

const openaiKey = process.env.OPENAI_API_KEY;
if (!openaiKey) {
    console.warn('[⚠️ OPENAI] OPENAI_API_KEY not found in .env! OpenAI fallback will be unavailable.');
}
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

// Smart models fallback chain for Groq Free Tier
const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'qwen/qwen3-32b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant'
];

// ─── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You're an intent classifier for Numberwale.com company a VIP mobile number vendor platform. Return ONLY valid JSON:
{"action":"ADD|REMOVE|MIXED|DEACTIVATE|ACTIVATE|INQUIRY|HELP|IGNORE","inquiry_type":"OUTSTANDING|NUMBERS|ALL|STATEMENT|null","vendorRate":"","vendorDiscount":"","readyToPort":"RTP|CRTP","keepSpacing":false,"reply_message":""}

RULES:
- ADD: vendor sent real 10-digit phone numbers.
- REMOVE: numbers sent + "sold/remove/delete/nikal/dead". (Note: 'dead' means sold by vendor, so it is REMOVE).
- MIXED: both add & remove in same msg.
- DEACTIVATE: ONLY if vendor EXPLICITLY says "deactivate all numbers", "I am on leave", or "chutti". Do NOT trigger this for "dead" or random words.
- ACTIVATE: vendor back (available/open).
- INQUIRY: asking account data (balance/dues/hisaab) OR asking for PDF statement (mera statement / my statement / download statement -> inquiry_type: "STATEMENT").
- HELP: asking how to use bot (NO actual numbers provided).
- IGNORE: greetings (hi/thanks).

EXTRACTION:
- vendorRate: flat price. CRITICAL: Convert abbreviations to full numeric strings without commas. 'k' = multiply by 1000 (e.g. "10k" -> "10000", "2.5k" -> "2500"). 'L' or 'lakh' = multiply by 100,000 (e.g. "2.3L" -> "230000", "5L" -> "500000").
- vendorDiscount: ONLY if "discount/off/%".
- readyToPort: "CRTP" if explicitly "CRTP" else "RTP".
- keepSpacing: true if "keep spacing/with space" else false.
- reply_message: if IGNORE -> ask for numbers; if HELP -> explain bot usage; else "".

NEVER extract phone numbers! Only metadata.`;

// ─── Retry & Model Rotation Helper ───────────────────────────────────────────
async function callLLMWithRetry(userMessage, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // --- 1. Try All Groq Models Across All Keys ---
        if (groqClients.length > 0) {
            for (let i = 0; i < GROQ_MODELS.length; i++) {
                const currentModel = GROQ_MODELS[i];
                
                for (let clientIdx = 0; clientIdx < groqClients.length; clientIdx++) {
                    const groqClient = groqClients[clientIdx];
                    try {
                        const completion = await groqClient.chat.completions.create({
                            model: currentModel,
                            messages: [
                                { role: 'system', content: SYSTEM_PROMPT },
                                { role: 'user', content: `Vendor message:\n${userMessage}\n\nReturn only the JSON object.` }
                            ],
                            temperature: 0,
                            response_format: { type: 'json_object' },
                            max_tokens: 300,
                        });
                        return completion.choices[0]?.message?.content?.trim();
                    } catch (err) {
                        lastError = err;
                        const status = err?.status || err?.statusCode || 0;

                        if (status === 429) {
                            console.warn(`[⚠️ GROQ 429] Rate limit hit on ${currentModel} (Key ${clientIdx + 1}). Trying next key...`);
                            continue; // Try next API key for the same model
                        }
                        if (status === 503 || status === 500) {
                            console.warn(`[⚠️ GROQ ${status}] Server issue on ${currentModel} (Key ${clientIdx + 1}). Switching to next model...`);
                            break; // Stop trying this model on other keys, switch to next model
                        }
                        
                        if (status === 401 || status === 403) {
                            console.error(`[❌ GROQ AUTH] Invalid API key (Key ${clientIdx + 1}). Skipping this key...`);
                            continue; // Try next key
                        }
                        
                        // For other errors, log and switch to next model
                        console.warn(`[⚠️ GROQ] Error on ${currentModel} (Key ${clientIdx + 1}): ${err.message}`);
                        break;
                    }
                }
            }
        }
        
        // --- 2. Fallback to OpenAI if all Groq models on all keys fail ---
        if (openai) {
            try {
                if (groqClients.length > 0) console.warn(`[⚠️ FALLBACK] All Groq models on all keys failed. Falling back to OpenAI (gpt-4o-mini)...`);
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: `Vendor message:\n${userMessage}\n\nReturn only the JSON object.` }
                    ],
                    temperature: 0,
                    response_format: { type: 'json_object' },
                    max_tokens: 300,
                });
                return completion.choices[0]?.message?.content?.trim();
            } catch (err) {
                lastError = err;
                const status = err?.status || err?.statusCode || 0;
                console.warn(`[⚠️ OPENAI] Fallback failed (status ${status}): ${err.message}`);
            }
        } else {
            console.warn(`[⚠️ OPENAI] No OPENAI_API_KEY provided for fallback.`);
        }
        
        // If ALL models (Groq + OpenAI) failed in this rotation, wait before full retry
        const waitMs = Math.pow(2, attempt) * 1000;
        console.warn(`[⚠️ AI] All AI models exhausted. Attempt ${attempt}/${maxRetries} failed. Retrying in ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
    }
    
    throw lastError;
}

// ─── Safe Offline Fallback (only 100% unambiguous cases) ─────────────────────
// Used ONLY when Groq is completely unreachable (network down, all retries fail)
function safeOfflineFallback(text) {
    if (!text || text.trim() === '') {
        return { action: 'ADD', inquiry_type: null, vendorRate: '', vendorDiscount: '', readyToPort: 'RTP', keepSpacing: false, reply_message: '' };
    }
    const lower = text.toLowerCase().trim();

    // 100% safe: Pure 10-digit numbers only → ADD (With custom fallback message)
    const stripped = text.replace(/[\d\s,\-\*\(\)\.]/g, '');
    if (stripped === '' && /\d{10}/.test(text)) {
        return { 
            action: 'ADD', 
            inquiry_type: null, 
            vendorRate: '', 
            vendorDiscount: '', 
            readyToPort: 'RTP', 
            keepSpacing: false, 
            reply_message: '⚠️ AI system is currently offline. We are parsing your numbers using basic offline mode, so please recheck the uploaded numbers. If there is an error, please reshare the numbers according to the guide. Till that time, we are trying to make our AI server alive again.' 
        };
    }

    // 100% safe: Exact single-word deactivate/activate commands
    if (lower === 'deactivate') return { action: 'DEACTIVATE', inquiry_type: null, vendorRate: '', vendorDiscount: '', readyToPort: 'RTP', keepSpacing: false, reply_message: '' };
    if (lower === 'activate') return { action: 'ACTIVATE', inquiry_type: null, vendorRate: '', vendorDiscount: '', readyToPort: 'RTP', keepSpacing: false, reply_message: '' };

    // 100% safe: Statement requests
    if (lower.includes('my statement') || lower.includes('mera statement')) {
        return { action: 'INQUIRY', inquiry_type: 'STATEMENT', vendorRate: '', vendorDiscount: '', readyToPort: 'RTP', keepSpacing: false, reply_message: '' };
    }

    // Everything else that's ambiguous → tell vendor AI is temporarily down with custom message
    return {
        action: 'IGNORE',
        inquiry_type: null,
        vendorRate: '',
        vendorDiscount: '',
        readyToPort: 'RTP',
        keepSpacing: false,
        reply_message: '⚠️ AI system is currently offline. We are parsing your numbers using basic offline mode, so please recheck the uploaded numbers. If there is an error, please reshare the numbers according to the guide. Till that time, we are trying to make our AI server alive again.'
    };
}

// ─── Main Intent Parser ───────────────────────────────────────────────────────
async function parseIntent(text) {
    // Empty message → treat as ADD (document uploads etc.)
    if (!text || text.trim() === '') {
        return { action: 'ADD', inquiry_type: null, vendorRate: '', vendorDiscount: '', readyToPort: 'RTP', keepSpacing: false, reply_message: '' };
    }

    let compressedText = text
        .replace(/<\|.*?\|>/g, '')
        .replace(/#{1,6}\s/g, '')
        // Replace exact 10-digit phone number patterns (including spaces/dashes and +91/0 prefix) with [NUM]
        .replace(/(?:\+91|0|91)?\s*(?:\d[\s-]*){10}(?!\d)/g, '[NUM]');
    
    // Compress multiple [NUM]s across newlines into a single [NUMBERS] to save tokens
    compressedText = compressedText.replace(/(?:\[NUM\]\s*){2,}/g, '[NUMBERS]\n');

    const sanitizedText = compressedText.trim().slice(0, 1000);

    // console.log(`[🤖 AI PAYLOAD] Compressed to ${sanitizedText.length} chars:\n${sanitizedText}`);

    try {
        const raw = await callLLMWithRetry(sanitizedText, 3);
        const parsed = JSON.parse(raw);
        const isCrtp = /crtp|current\s*ready\s*to\s*port/i.test(text);
        return {
            action: parsed.action || 'IGNORE',
            inquiry_type: parsed.inquiry_type || null,
            vendorRate: parsed.vendorRate || '',
            vendorDiscount: parsed.vendorDiscount || '',
            readyToPort: isCrtp ? 'CRTP' : 'RTP',
            keepSpacing: parsed.keepSpacing || false,
            reply_message: parsed.reply_message || '',
        };
    } catch (err) {
        const status = err?.status || err?.statusCode || 0;
        if (status === 429) {
            console.error(`[❌ AI] Rate limit exhausted after all retries on all models.`);
        } else {
            console.error(`[❌ AI] parseIntent failed (status ${status}): ${err.message}`);
        }
        console.warn(`[⚠️ FALLBACK] All AI models unavailable. Using safe offline fallback.`);
        return safeOfflineFallback(text);
    }
}

// ─── Reply Generator ──────────────────────────────────────────────────────────
async function generateReply(action, validCount, invalidNumbers, failedIds, unauthorizedIds, inquiryData, noRateNumbers = [], apiResult = null, keepSpacing = false) {
    if (action === 'DEACTIVATE') {
        if (apiResult && apiResult.message === 'Vendor is already deactivated') return '⏸️ Your numbers are already deactivated.';
        return '⏸️ Your numbers have been temporarily deactivated.';
    }
    if (action === 'ACTIVATE') {
        if (apiResult && apiResult.message === 'Vendor is already activated') return '▶️ Your numbers are already active.';
        return '▶️ Your numbers are now active and available again.';
    }

    if (action === 'HELP') {
        return `*How to Add Numbers:*\n\n` +
               `_Example 1 (Mixed Discounts):_\n` +
               `Add RTP/ CRTP\n` +
               `1234567890 8365 12%\n` +
               `0987654321 8462 5%\n\n` +
               `_Example 2 (Specific Porting):_\n` +
               `Add\n` +
               `1234567890 9037\n` +
               `0987654321 9265 CRTP\n` +
               `*(1234567890 will go to RTP, 0987654321 to CRTP)*\n\n` +
               `_Example 3 (Global Discount):_\n` +
               `Add\n` +
               `1234567890 8463\n` +
               `0987654321 8634\n` +
               `all 12% discount\n\n` +
               `_Example 4 (Keep Spacing):_\n` +
               `Add keep spacing\n` +
               `123 45 67 890 5000 12%\n\n` +
               `_Example 5 (Mixed - Add & Sold together):_\n` +
               `Add RTP\n` +
               `1234567890 8365 12%\n` +
               `0987654321 8462 5%\n\n` +
               `Sold\n` +
               `9876543210\n` +
               `8765432109\n\n` +
               `*How to Mark Numbers as Sold:*\n\n` +
               `Sold\n` +
               `1234567890\n` +
               `0987654321\n\n` +
               `*Spacing Logic:*\n` +
               `• Default: System auto-spaces numbers (e.g. 12345 67890).\n` +
               `• Custom: Add "keep spacing" or "with space" in your message to use your exact spacing.\n` +
               `• Excel: If you upload an Excel file, the system auto-spaces unless the file name contains "keep space" or "with spacing".\n\n` +
               `*For Balance Inquiry:*\n` +
               `Just say "hisaab", "outstanding", or "balance".`;
    }

    if (action === 'INQUIRY' && inquiryData) {
        const fmt = (val) => `₹${Number(val || 0).toLocaleString('en-IN')}`;
        const c = inquiryData.combinedTotals;
        let reply = `📊 *Your Account Summary*\n👨‍💼 Vendor: ${inquiryData.vendorName}\n\n💵 *Payment Details:*\n`;
        reply += `• Total Paid: ${fmt(c.paid)}\n`;
        reply += `• Pending: ${fmt(c.pending)}\n`;
        reply += `• To Be Paid: ${fmt(c.toBePaid)}\n`;
        reply += `*Total Outstanding: ${fmt(c.balanceTotal)}*\n\n`;
        reply += `📱 *Active Numbers on Website:* ${inquiryData.activeNumbers || 0}`;
        return reply;
    }

    if (action === 'REMOVE') {
        let msg = '';
        if (validCount > 0) {
            msg += `✅ *These numbers are sold:*\n`;
            // Assuming we don't have the exact list of successfully removed numbers here,
            // we will adjust the msg text. Wait, validCount is a number, we don't have the list.
            // But the user said: "this numbers are sold: 1234...". If we don't have the list, we can just say "✅ X numbers are sold."
            msg += `Successfully marked ${validCount} numbers as sold.\n\n`;
        }
        
        let notSold = [...(failedIds || []), ...(unauthorizedIds || [])];
        if (notSold.length > 0) {
            msg += `❌ *These numbers are not sold because they are not added by you / not yours:*\n`;
            notSold.forEach(num => { msg += `${num}\n`; });
        }
        
        if (validCount === 0 && notSold.length === 0) {
            msg = `❌ No valid numbers were found to remove.`;
        }
        
        return msg.trim();
    }

    if (action === 'ADD') {
        const itemsToAdd = validCount || [];
        const addedCount = itemsToAdd.length;

        if (addedCount === 0 && (!invalidNumbers || invalidNumbers.length === 0) && (!noRateNumbers || noRateNumbers.length === 0)) {
            return '❌ No valid numbers found.';
        }

        let reply = '';
        if (addedCount > 0) {
            reply += `✅ *Successfully Added (${addedCount}):*\n`;
            if (keepSpacing) {
                reply += `_(Numbers added according to your spacing)_\n\n`;
            } else {
                reply += `_(Spaces are auto generated)_\n\n`;
            }
            itemsToAdd.forEach(item => {
                const rateStr = item.rate ? `Rs. ${item.rate}` : `Rs. 0`;
                let discStr = item.discount && item.discount !== '0' ? `${item.discount}` : `0%`;
                if (!discStr.includes('%') && discStr !== '0%') discStr += '%';
                const displayNum = (item.styledNumber || item.number).replace(/-/g, ' ').replace(/\*/g, '');
                reply += `${displayNum} | ${rateStr} | ${discStr} | ${item.port}\n`;
            });
        }

        if (noRateNumbers && noRateNumbers.length > 0) {
            if (reply.length > 0) reply += '\n';
            reply += `⚠️ *Not Added (Missing Rate):*\n`;
            noRateNumbers.forEach(inv => { reply += `• ${inv}\n`; });
        }

        if (invalidNumbers && invalidNumbers.length > 0) {
            if (reply.length > 0) reply += '\n';
            reply += `❌ *Not Added (Invalid 9 or 11 Digit Format):*\n`;
            invalidNumbers.forEach(inv => { reply += `• ${inv}\n`; });
        }

        return reply.trim();
    }

    return "⚠️ I didn't quite catch that. Please send a valid list of numbers or an excel file.";
}

module.exports = { parseIntent, generateReply };