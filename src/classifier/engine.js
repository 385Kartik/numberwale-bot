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
        return { catId: 2, matches: [[0, 5], [5, 10]] };
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
    let distinctTrips = [];
    let seenDigits = new Set();
    for (let t of trips) {
        let digit = d[t[0]];
        if (!seenDigits.has(digit)) {
            seenDigits.add(digit); distinctTrips.push(t);
        }
    }
    if (distinctTrips.length >= 2) return { catId: 17, matches: distinctTrips.slice(0,2) };

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
    for (let i = 0; i < tens.length - 1; i++) {
        let i1 = d.indexOf(tens[i]);
        let i2 = d.indexOf(tens[i+1]);
        if (i1 !== -1 && i2 !== -1) return { catId: 6, matches: [[i1, i1+2], [i2, i2+2]] };
        
        let j1 = d.indexOf(hundreds[i]);
        let j2 = d.indexOf(hundreds[i+1]);
        if (j1 !== -1 && j2 !== -1) return { catId: 6, matches: [[j1, j1+3], [j2, j2+3]] };
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
    
    if (maxAsc >= 2 || maxDesc >= 2) {
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

function applyBoth(cleanNum, primaryMatches) {
    if (!primaryMatches || primaryMatches.length === 0) return addSecondaryDashes(cleanNum);
    
    let parts = [];
    let lastEnd = 0;
    let sorted = [...primaryMatches].sort((a,b) => a[0] - b[0]);
    
    for (let [start, end] of sorted) {
        if (start > lastEnd) {
            parts.push(addSecondaryDashes(cleanNum.slice(lastEnd, start)));
        }
        parts.push('*' + cleanNum.slice(start, end) + '*');
        lastEnd = end;
    }
    if (lastEnd < cleanNum.length) {
        parts.push(addSecondaryDashes(cleanNum.slice(lastEnd)));
    }
    
    let res = parts.filter(p => p.length > 0).join('-');
    return res.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

module.exports = { classifyEngine, applyBoth, CAT };
