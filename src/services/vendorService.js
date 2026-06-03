const mongoose = require('mongoose');

const vendorGroupSchema = new mongoose.Schema({
    groupJid: { type: String, unique: true },
    vendorId: String,
    vendorName: String,
    active: { type: Boolean, default: true },
    addedAt: { type: Date, default: Date.now }
});

const VendorGroup = mongoose.model('VendorGroup', vendorGroupSchema);

const PATTERN = /^(.+?)\(numberwale\)/i; // "VendorName(numberwale) kashifshaikh4204@gmail.com"

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('📦 Connected to MongoDB (Vendor Groups)');
    } catch (err) {
        console.error('MongoDB connection error:', err);
    }
}

async function autoRegisterIfValid(groupJid, groupName) {
    const match = groupName.trim().match(PATTERN);
    if (!match) return null; // pattern match nahi hua

    const vendorName = match[1].trim();

    // Extract email from groupName if present
    const emailMatch = groupName.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    let extractedEmail = emailMatch ? emailMatch[0] : null;

    // Already registered hai?
    const existing = await VendorGroup.findOne({ groupJid });
    if (existing) {
        if (!existing.active) {
            existing.active = true;
            await existing.save();
            console.log(`[📦 DATABASE] Reactivated existing Vendor: "${vendorName}" (${existing.vendorId})`);
        } else {
            console.log(`[📦 DATABASE] Vendor "${vendorName}" (${existing.vendorId}) is already active.`);
        }
        
        // If the group name has an email and it differs from the saved vendorId, update it
        if (extractedEmail && existing.vendorId !== extractedEmail) {
            existing.vendorId = extractedEmail;
            await existing.save();
            console.log(`[📦 DATABASE] Updated Vendor ID to email: ${extractedEmail}`);
        }
        return existing;
    }

    // Naya register karo
    const count = await VendorGroup.countDocuments();
    const vendorId = extractedEmail ? extractedEmail : `V-${String(count + 1).padStart(3, '0')}`;

    const vendor = await VendorGroup.create({
        groupJid,
        vendorId,
        vendorName,
        active: true
    });

    console.log(`[📦 DATABASE] ✅ NEW VENDOR CREATED! "${vendorName}" assigned ID: ${vendorId}`);
    return vendor;
}

async function getVendorByGroup(groupJid) {
    return await VendorGroup.findOne({ groupJid, active: true });
}

async function deactivateVendor(groupJid) {
    await VendorGroup.findOneAndUpdate({ groupJid }, { active: false });
}

module.exports = { connectDB, autoRegisterIfValid, getVendorByGroup, deactivateVendor, VendorGroup };
