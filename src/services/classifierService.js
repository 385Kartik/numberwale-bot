const xlsx = require('xlsx');

const CAT = {
    1:'Without 248', 2:'Mirror (5+5 Same)', 3:'Semi Mirror (4+4 Same)', 4:'Two Digit Number',
    5:'Three Digit Number', 6:'Counting Number', 7:'786 Number', 8:'108 Number',
    9:'Doubling Number', 10:'AB AB XY XY', 11:'AB AB AB', 12:'Start AB AB',
    13:'Middle AB AB', 14:'Ending AB AB', 15:'ABC ABC ABC', 16:'ABC ABC',
    17:'AAA BBB', 18:'Triple', 19:'Tetra', 20:'Penta', 21:'Hexa',
    22:'Septa', 23:'Octa', 24:'Unique'
};

function findOccurrences(str, pattern) {
    let matches = [];
    let pos = 0;
    while ((pos = str.indexOf(pattern, pos)) !== -1) {
        matches.push([pos, pos + pattern.length]);
        pos += pattern.length;
    }
    return matches;
}

function classifyEngine(raw) {
    const d = String(raw).replace(/\D/g, '');
    if (!d || d.length < 2) return { catId: 24, matches: [] };

    let i786 = d.indexOf('786');
    if (i786 !== -1) return { catId: 7, matches: [[i786, i786 + 3]] };

    let i108 = d.indexOf('108');
    if (i108 !== -1) return { catId: 8, matches: [[i108, i108 + 3]] };

    if (d.length >= 10 && d.slice(0, 5) === d.slice(5, 10)) {
        return { catId: 2, matches: [[0, 5]] };
    }

    let maxRun = 1, cur = 1, bestStart = 0;
    for (let i = 1; i < d.length; i++) {
        if (d[i] === d[i - 1]) {
            cur++;
            if (cur > maxRun) { maxRun = cur; bestStart = i - cur + 1; }
        } else { cur = 1; }
    }
    if (maxRun >= 8) return { catId: 23, matches: [[bestStart, bestStart + maxRun]] };
    if (maxRun >= 7) return { catId: 22, matches: [[bestStart, bestStart + maxRun]] };
    if (maxRun >= 6) return { catId: 21, matches: [[bestStart, bestStart + maxRun]] };
    if (maxRun >= 5) return { catId: 20, matches: [[bestStart, bestStart + maxRun]] };
    if (maxRun >= 4) return { catId: 19, matches: [[bestStart, bestStart + maxRun]] };

    for (let i = 0; i <= d.length - 8; i++) {
        for (let j = i + 4; j <= d.length - 4; j++) {
            if (d.slice(i, i + 4) === d.slice(j, j + 4) && new Set(d.slice(i, i+4)).size > 1) {
                return { catId: 3, matches: [[i, i+4], [j, j+4]] };
            }
        }
    }

    let bestAbc = [];
    let maxAbcCount = 0;
    for (let i = 0; i <= d.length - 3; i++) {
        const p = d.slice(i, i + 3);
        if (p[0] === p[1] && p[1] === p[2]) continue; 
        const occ = findOccurrences(d, p);
        if (occ.length > maxAbcCount) { maxAbcCount = occ.length; bestAbc = occ; }
    }
    if (maxAbcCount >= 3) return { catId: 15, matches: bestAbc.slice(0,3) };

    for (let i = 0; i <= d.length - 6; i++) {
        const p = d.slice(i, i + 2);
        if (p[0] === p[1]) continue;
        if (p === d.slice(i + 2, i + 4) && p === d.slice(i + 4, i + 6)) {
            return { catId: 11, matches: [[i, i+2], [i+2, i+4], [i+4, i+6]] };
        }
    }
    if (maxAbcCount >= 2) return { catId: 16, matches: bestAbc.slice(0,2) };

    const ababRegex = /(\d)(\d)\1\2/g;
    let match_abab;
    const ababMatches = [];
    while ((match_abab = ababRegex.exec(d)) !== null) {
        if (match_abab[1] !== match_abab[2]) {
            ababMatches.push([match_abab.index, match_abab.index + 4]);
        }
    }
    if (ababMatches.length >= 2) return { catId: 10, matches: ababMatches.slice(0,2) };

    let trips = [];
    let j = 0;
    while (j < d.length) {
        let k = j;
        while (k < d.length && d[k] === d[j]) k++;
        if (k - j >= 3) trips.push([j, j+3]);
        j = k;
    }
    if (trips.length >= 2) return { catId: 17, matches: trips.slice(0,2) };

    if (maxRun >= 3) return { catId: 18, matches: [[bestStart, bestStart + maxRun]] };

    const uniqueCount = new Set(d).size;
    if (uniqueCount === 2) return { catId: 4, matches: [] };
    if (uniqueCount === 3) return { catId: 5, matches: [] };

    let pairs = [];
    let idx = 0;
    while (idx < d.length - 1) {
        if (d[idx] === d[idx+1]) {
            pairs.push([idx, idx+2]);
            idx += 2;
        } else { idx++; }
    }
    if (pairs.length >= 2) return { catId: 9, matches: pairs };

    if (d.length >= 4 && d[0] !== d[1] && d[0] === d[2] && d[1] === d[3]) return { catId: 12, matches: [[0, 4]] };

    for (let i = 1; i <= d.length - 5; i++) {
        if (d[i] === d[i + 1]) continue;
        if (d[i] === d[i + 2] && d[i + 1] === d[i + 3]) return { catId: 13, matches: [[i, i+4]] };
    }

    if (d.length >= 4) {
        const L = d.length;
        if (d[L - 4] !== d[L - 3] && d[L - 4] === d[L - 2] && d[L - 3] === d[L - 1]) return { catId: 14, matches: [[L-4, L]] };
    }

    const tens = ['10','20','30','40','50','60','70','80','90'];
    const hundreds = ['100','200','300','400','500','600','700','800','900'];
    for (let i = 0; i < tens.length - 2; i++) {
        let i1 = d.indexOf(tens[i]);
        let i2 = d.indexOf(tens[i+1]);
        let i3 = d.indexOf(tens[i+2]);
        if (i1 !== -1 && i2 !== -1 && i3 !== -1) return { catId: 6, matches: [[i1, i1+2], [i2, i2+2], [i3, i3+2]] };
        
        let j1 = d.indexOf(hundreds[i]);
        let j2 = d.indexOf(hundreds[i+1]);
        let j3 = d.indexOf(hundreds[i+2]);
        if (j1 !== -1 && j2 !== -1 && j3 !== -1) return { catId: 6, matches: [[j1, j1+3], [j2, j2+3], [j3, j3+3]] };
    }
    
    let bestSeqMatches = [];
    for (let len = 2; len <= 3; len++) {
        for (let i = 0; i <= d.length - (len * 3); i++) {
            let seqMatches = [[i, i+len]];
            let currVal = parseInt(d.slice(i, i+len));
            let j = i + len;
            let isAsc = parseInt(d.slice(j, j+len)) === currVal + 1;
            let isDesc = parseInt(d.slice(j, j+len)) === currVal - 1;
            
            if (isAsc || isDesc) {
                while (j <= d.length - len) {
                    let nVal = parseInt(d.slice(j, j+len));
                    if ((isAsc && nVal === currVal + 1) || (isDesc && nVal === currVal - 1)) {
                        seqMatches.push([j, j+len]);
                        currVal = nVal;
                        j += len;
                    } else {
                        break;
                    }
                }
                if (seqMatches.length >= 3 && seqMatches.length > bestSeqMatches.length) {
                    bestSeqMatches = seqMatches;
                }
            }
        }
    }
    if (bestSeqMatches.length >= 3) {
        return { catId: 6, matches: bestSeqMatches };
    }

    let maxAsc = 1, curAsc = 1, bestAscStart = 0, curAscStart = 0;
    let maxDesc = 1, curDesc = 1, bestDescStart = 0, curDescStart = 0;
    
    for (let i = 1; i < d.length; i++) {
        if (+d[i] === +d[i-1] + 1) {
            curAsc++;
            if (curAsc > maxAsc) { maxAsc = curAsc; bestAscStart = curAscStart; }
        } else {
            curAsc = 1;
            curAscStart = i;
        }
        
        if (+d[i] === +d[i-1] - 1) {
            curDesc++;
            if (curDesc > maxDesc) { maxDesc = curDesc; bestDescStart = curDescStart; }
        } else {
            curDesc = 1;
            curDescStart = i;
        }
    }
    
    if (maxAsc >= 3 || maxDesc >= 3) {
        if (maxAsc >= maxDesc) return { catId: 6, matches: [[bestAscStart, bestAscStart + maxAsc]] };
        else return { catId: 6, matches: [[bestDescStart, bestDescStart + maxDesc]] };
    }

    if (!/[248]/.test(d)) return { catId: 1, matches: [] };
    return { catId: 24, matches: [] };
}

function addSecondaryDashes(subStr) {
    if (subStr.length < 2) return subStr;
    let res = classifyEngine(subStr);
    if ([1, 4, 5, 24].includes(res.catId) || !res.matches || res.matches.length === 0) return subStr;
    
    let parts = [];
    let lastEnd = 0;
    let sorted = [...res.matches].sort((a,b) => a[0] - b[0]);
    
    for (let [start, end] of sorted) {
        if (start > lastEnd) parts.push(addSecondaryDashes(subStr.slice(lastEnd, start)));
        parts.push(subStr.slice(start, end));
        lastEnd = end;
    }
    if (lastEnd < subStr.length) parts.push(addSecondaryDashes(subStr.slice(lastEnd)));
    
    return parts.filter(p => p.length > 0).join('-');
}

function applyBoth(cleanNum, primaryMatches, catId = null) {
    if (!primaryMatches || primaryMatches.length === 0) return addSecondaryDashes(cleanNum);
    
    let parts = [];
    let lastEnd = 0;
    let sorted = [...primaryMatches].sort((a,b) => a[0] - b[0]);
    
    for (let [start, end] of sorted) {
        if (start > lastEnd) {
            if (catId === 2) {
                parts.push(cleanNum.slice(lastEnd, start));
            } else {
                parts.push(addSecondaryDashes(cleanNum.slice(lastEnd, start)));
            }
        }
        parts.push('*' + cleanNum.slice(start, end) + '*');
        lastEnd = end;
    }
    if (lastEnd < cleanNum.length) {
        if (catId === 2) {
            parts.push(cleanNum.slice(lastEnd));
        } else {
            parts.push(addSecondaryDashes(cleanNum.slice(lastEnd)));
        }
    }
    
    let res = parts.filter(p => p.length > 0).join('-');
    return res.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function applyBothWithCustomSpaces(rawStr, matches) {
    let dashedStr = rawStr.replace(/\s+/g, '-');
    if (!matches || matches.length === 0) return dashedStr.replace(/^-|-$/g, '');
    
    let sorted = [...matches].sort((a,b) => a[0] - b[0]);
    let mergedMatches = [];
    if (sorted.length > 0) {
        let current = [...sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i][0] === current[1]) {
                current[1] = sorted[i][1];
            } else {
                mergedMatches.push(current);
                current = [...sorted[i]];
            }
        }
        mergedMatches.push(current);
    }
    
    let result = '';
    let digitIdx = 0;
    
    for (let i = 0; i < dashedStr.length; i++) {
        let char = dashedStr[i];
        let isDigit = /\d/.test(char);
        
        if (isDigit) {
            for (let [start, end] of mergedMatches) {
                if (digitIdx === start) result += '*';
            }
        }
        
        result += char;
        
        if (isDigit) {
            digitIdx++;
            for (let [start, end] of mergedMatches) {
                if (digitIdx === end) result += '*';
            }
        }
    }
    return result.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Parses raw text messages sent by user
function processText(text, globalVendorDiscount = null, globalVendorStatus = 'RTP', withSpace = false) {
    const lines = text.split('\n');
    let validNumbers = [];
    let invalidNumbers = [];
    
    let emojiLegend = {};

    lines.forEach(line => {
        let emojiMatch = line.match(/(\d+)\s*=\s*([^\d\s\w]+)/);
        if (emojiMatch) {
            emojiLegend[emojiMatch[2].trim()] = emojiMatch[1];
        }
    });

    let extractedItems = [];
    
    lines.forEach(line => {
        let rawLine = line.trim();
        let normalizedLine = rawLine.replace(/(\d)[Oo]+/g, (m) => m.replace(/[Oo]/g, '0'));
        normalizedLine = normalizedLine.replace(/[Oo]+(\d)/g, (m) => m.replace(/[Oo]/g, '0'));

        if (!normalizedLine) return;
        
        // Match standalone status
        let statusMatch = normalizedLine.match(/^(rtp|crtp)$/i);
        if (statusMatch) {
            extractedItems.push({ type: 'status', statusStr: statusMatch[1].toUpperCase() });
            return;
        }

        // Match standalone discount
        let blockDiscountMatch = normalizedLine.match(/^(\d+(?:\.\d+)?)\s*(%|off|discount)$/i);
        if (blockDiscountMatch) {
            extractedItems.push({ type: 'discount', discountStr: blockDiscountMatch[1] + (blockDiscountMatch[2]==='%'?'%':'') });
            return;
        }

        // Match explicit block rate like "Rs 500", or standalone abbreviation like "650L", "380k"
        let blockRateMatch = normalizedLine.match(/^(?:rs\.?|₹|rate:?|price:?|pick any)?\s*(\d+(?:\.\d+)?)\s*(k|l|lakh)?\s*(?:\/|-|each|fixed|₹|\*|👇|👆|$)/i);
        
        if (blockRateMatch) {
            let baseRate = parseFloat(blockRateMatch[1]);
            let suffix = (blockRateMatch[2] || '').toLowerCase();
            if (suffix === 'k') baseRate *= 1000;
            if (suffix === 'l' || suffix === 'lakh') {
                if (baseRate >= 100) baseRate = baseRate / 100; // Vendor slang: 230L means 2.30 Lakhs
                baseRate *= 100000;
            }
            
            // Only push if it's explicitly a rate (had a currency symbol/word or a k/l suffix)
            // If it's just a raw number "123" without 'Rs' or 'k/L', it might be a quantity or something else, but if it's on a line alone, we treat it as rate.
            if (blockRateMatch[0].match(/(rs\.?|₹|rate:?|price:?|pick any|k|l|lakh)/i) || /^\d+(?:\.\d+)?$/.test(normalizedLine)) {
                extractedItems.push({ type: 'rate', rateStr: String(baseRate) });
            }
        }

        let totalDigitsInLine = normalizedLine.replace(/\D/g, '').length;
        if (totalDigitsInLine > 0 && totalDigitsInLine < 7) return;

        let cleanLine = normalizedLine.replace(/^(add|remove|delete)\s+/i, '').trim();
        let numStr = '';
        let rateStr = '';
        let statusStr = '';
        let discountStr = '';

        let explicitSepMatch = cleanLine.match(/^(.*?)(?:@|rs\.?|₹|rate:?|price:?)\s*(\d+(?:\.\d+)?)\s*(k|l|lakh)?\s*$/i);
        
        if (explicitSepMatch) {
            numStr = explicitSepMatch[1].trim();
            let baseRate = parseFloat(explicitSepMatch[2]);
            let suffix = (explicitSepMatch[3] || '').toLowerCase();
            if (suffix === 'k') baseRate *= 1000;
            if (suffix === 'l' || suffix === 'lakh') {
                if (baseRate >= 100) baseRate = baseRate / 100;
                baseRate *= 100000;
            }
            rateStr = String(baseRate);
        } else {
            let digitRegex = /\d+/g;
            let match;
            let currentDigits = 0;
            let splitIndex = -1;

            while ((match = digitRegex.exec(cleanLine)) !== null) {
                let group = match[0];
                if (currentDigits + group.length > 10) {
                    splitIndex = match.index;
                    break;
                }
                currentDigits += group.length;
                if (currentDigits === 10) {
                    splitIndex = match.index + group.length;
                    break;
                }
            }

            if (splitIndex !== -1) {
                numStr = cleanLine.substring(0, splitIndex).trim();
                let remaining = cleanLine.substring(splitIndex).trim();
                
                let rtpMatch = remaining.match(/\b(rtp|crtp)\b/i);
                if (rtpMatch) statusStr = rtpMatch[1].toUpperCase();

                let discountMatchInline = remaining.match(/(\d+(?:\.\d+)?)\s*(%|off|discount)\b/i);
                if (discountMatchInline) discountStr = discountMatchInline[1] + (discountMatchInline[2]==='%'?'%':'');

                let klMatch = remaining.match(/(\d+(?:\.\d+)?)\s*(k|l|lakh)\b/i);
                if (klMatch) {
                    let baseRate = parseFloat(klMatch[1]);
                    let suffix = klMatch[2].toLowerCase();
                    if (suffix === 'k') baseRate *= 1000;
                    if (suffix === 'l' || suffix === 'lakh') {
                        if (baseRate >= 100) baseRate = baseRate / 100;
                        baseRate *= 100000;
                    }
                    rateStr = String(baseRate);
                } else {
                    // Remove any discount percentage tokens (like "2%", "12 %") before extracting digits
                    let remainingNoDiscount = remaining.replace(/\b\d+(?:\.\d+)?\s*%/g, '');
                    rateStr = remainingNoDiscount.replace(/[^\d]/g, '').trim();
                }
            } else {
                numStr = cleanLine;
                rateStr = '';
            }
        }
        
        let cleanNum = numStr.replace(/\D/g, '');
        let hasDigits = /\d/.test(rawLine);
        
        if (hasDigits && cleanNum.length !== 10) {
            extractedItems.push({ type: 'invalid', rawLine });
            return;
        }

        if (cleanNum && cleanNum.length === 10) {
            let inlineEmojiRate = '';
            for (let emoji in emojiLegend) {
                if (rawLine.includes(emoji)) {
                    inlineEmojiRate = emojiLegend[emoji];
                    break;
                }
            }
            if (!rateStr && inlineEmojiRate) rateStr = inlineEmojiRate;

            extractedItems.push({
                type: 'number',
                number: cleanNum,
                numStr: numStr,
                rateStr: rateStr || null,
                statusStr: statusStr || null,
                discountStr: discountStr || null
            });
        }
    });

    let currentBottomUpRate = null;
    let currentBottomUpStatus = null;
    let currentBottomUpDiscount = null;
    
    for (let i = extractedItems.length - 1; i >= 0; i--) {
        let item = extractedItems[i];
        if (item.type === 'rate') currentBottomUpRate = item.rateStr;
        else if (item.type === 'status') currentBottomUpStatus = item.statusStr;
        else if (item.type === 'discount') currentBottomUpDiscount = item.discountStr;
        else if (item.type === 'number') {
            if (!item.rateStr && currentBottomUpRate) item.rateStr = currentBottomUpRate;
            if (!item.statusStr && currentBottomUpStatus) item.statusStr = currentBottomUpStatus;
            if (!item.discountStr && currentBottomUpDiscount) item.discountStr = currentBottomUpDiscount;
        }
    }

    let currentTopDownRate = null;
    let currentTopDownStatus = null;
    let currentTopDownDiscount = null;

    for (let i = 0; i < extractedItems.length; i++) {
        let item = extractedItems[i];
        if (item.type === 'rate') currentTopDownRate = item.rateStr;
        else if (item.type === 'status') currentTopDownStatus = item.statusStr;
        else if (item.type === 'discount') currentTopDownDiscount = item.discountStr;
        else if (item.type === 'number') {
            if (!item.rateStr && currentTopDownRate) item.rateStr = currentTopDownRate;
            if (!item.statusStr && currentTopDownStatus) item.statusStr = currentTopDownStatus;
            if (!item.discountStr && currentTopDownDiscount) item.discountStr = currentTopDownDiscount;
            
            const res = classifyEngine(item.number);
            let styled = '';
            if (withSpace) {
                let cleanNumStr = item.numStr.replace(/[*_~]/g, '');
                styled = applyBothWithCustomSpaces(cleanNumStr, res.matches);
            } else {
                styled = applyBoth(item.number, res.matches, res.catId);
            }
            
            validNumbers.push({
                number: item.number,
                styledNumber: styled,
                categoryId: res.catId,
                vendorRate: item.rateStr || null,
                statusStr: item.statusStr || null,
                discountStr: item.discountStr || null
            });
        } else if (item.type === 'invalid') {
            invalidNumbers.push(item.rawLine);
        }
    }
    
    return { validNumbers, invalidNumbers };
}

// Parses downloaded excel/csv buffer
function processExcelBuffer(buffer, globalVendorDiscount = null, globalVendorStatus = 'RTP', withSpace = false) {
    let validNumbers = [];
    let invalidNumbers = [];
    
    const excelWorkbook = xlsx.read(buffer, { type: 'buffer' });
    const excelSheetName = excelWorkbook.SheetNames[0];
    const worksheet = excelWorkbook.Sheets[excelSheetName];
    
    const excelJson = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
    if (!excelJson || excelJson.length === 0) {
        return { validNumbers, invalidNumbers };
    }
    
    let headers = excelJson[0];
    let numColIdx = -1, rateColIdx = -1, discountColIdx = -1, statusColIdx = -1;
    
    for (let i = 0; i < headers.length; i++) {
        let h = String(headers[i] || '').toLowerCase().trim();
        if (h === 'vanity number') numColIdx = i;
        else if (numColIdx === -1 && (h.includes('number') || h.includes('mobile') || h.includes('cell'))) numColIdx = i;
        
        if (h === 'vendor rate' || h === 'rate' || h === 'price' || h === 'amount') rateColIdx = i;
        if (h === 'discount' || h === 'dis' || h === 'discounts' || h === 'vendor discount') discountColIdx = i;
        if (h === 'status' || h === 'rtp' || h === 'crtp' || h === 'type') statusColIdx = i;
    }
    
    if (numColIdx === -1) numColIdx = 0; 
    
    for (let i = 1; i < excelJson.length; i++) {
        let row = excelJson[i];
        if (!row || row.length === 0) continue;
        
        let originalCellVal = String(row[numColIdx] || '');
        if (originalCellVal.includes('E') || originalCellVal.includes('e')) {
            originalCellVal = Number(row[numColIdx]).toLocaleString('fullwide', { useGrouping: false });
        }
        
        let numStrForSpace = originalCellVal.trim();
        let cleanNum = numStrForSpace.replace(/\D/g, '');
        
        let rateStr = '';
        if (rateColIdx !== -1) {
            rateStr = String(row[rateColIdx] || '').trim();
        }

        let discountStr = globalVendorDiscount;
        if (discountColIdx !== -1 && String(row[discountColIdx] || '').trim()) {
            discountStr = String(row[discountColIdx] || '').trim();
        }

        let statusStr = globalVendorStatus;
        if (statusColIdx !== -1 && String(row[statusColIdx] || '').trim()) {
            statusStr = String(row[statusColIdx] || '').trim();
        }
        
        if (cleanNum.length > 0 && cleanNum.length !== 10) {
            invalidNumbers.push(originalCellVal);
            continue;
        }

        if (cleanNum && cleanNum.length === 10) {
            const res = classifyEngine(cleanNum);
            
            let styled = '';
            if (withSpace) {
                styled = applyBothWithCustomSpaces(numStrForSpace, res.matches);
            } else {
                styled = applyBoth(cleanNum, res.matches, res.catId);
            }
            // Removed asterisk cleaning to preserve them for the database/UI
            
            validNumbers.push({
                number: cleanNum,
                styledNumber: styled,
                categoryId: res.catId,
                vendorRate: rateStr || null,
                discountStr: discountStr || null,
                statusStr: statusStr || 'RTP'
            });
        }
    }
    
    return { validNumbers, invalidNumbers };
}

function splitMixedIntentText(text) {
    const lines = text.split('\n');
    let addLines = [];
    let removeLines = [];
    let currentMode = 'ADD'; // Default mode

    lines.forEach(line => {
        let lower = line.toLowerCase().trim();
        let hasDigits = /\d/.test(lower);

        // If the line is mostly text (no digits) and contains keywords, switch mode
        if (!hasDigits) {
            if (lower.includes('sold') || lower.includes('remove') || lower.includes('dead') || lower.includes('delete') || lower.includes('out of stock')) {
                currentMode = 'REMOVE';
            } else if (lower.includes('add') || lower.includes('available') || lower.includes('new stock') || lower.includes('live')) {
                currentMode = 'ADD';
            }
        }

        if (currentMode === 'ADD') {
            addLines.push(line);
        } else {
            removeLines.push(line);
        }
    });

    return {
        addText: addLines.join('\n'),
        removeText: removeLines.join('\n')
    };
}

module.exports = {
    processText,
    processExcelBuffer,
    classifyEngine,
    splitMixedIntentText
};
