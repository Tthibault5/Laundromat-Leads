export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address, name, debug } = req.query;
  if (debug === '1') return res.status(200).json({ ok: true, message: 'owner.js is reachable' });
  if (!address) return res.status(400).json({ error: 'Address is required' });

  try {
    const results = [];
    const parts = address.split(',').map(p => p.trim());
    const street = parts[0] || '';
    const city = parts[1] || '';
    const stateZip = (parts[2] || '').trim();
    const stateCode = stateZip.split(' ')[0] || 'CT';
    const zip = stateZip.split(' ')[1] || '';
    const jurisdiction = 'us_' + stateCode.toLowerCase();

    // Extract street number for more targeted search
    const streetNum = street.match(/^\d+/)?.[0] || '';
    const streetName = street.replace(/^\d+\s*/, '').trim();

    // Strategy: name-only search is most reliable per user feedback
    // Strip generic words to get the unique identifier (e.g. "Prospect Cleaners" not "Prospect Cleaners Laundromat")
    const cleanName = name
      ? name.replace(/(laundromat|laundry|coin laundry|coin wash|wash & dry|wash and dry|dry cleaners|cleaners)/gi, '').replace(/\s+/g, ' ').trim()
      : null;

    const searches = [
      cleanName || null,                          // "Prospect" from "Prospect Cleaners Laundromat"
      name || null,                               // full name as fallback
      cleanName && city ? cleanName + ' ' + city : null, // name + city
      streetNum && streetName ? streetNum + ' ' + streetName : null, // street address only
    ].filter(Boolean);

    for (const q of searches) {
      if (results.length >= 8) break;
      try {
        const url = 'https://api.opencorporates.com/v0.4/companies/search?q=' +
          encodeURIComponent(q) +
          '&jurisdiction_code=' + jurisdiction +
          '&per_page=5&inactive=false';
        const r = await fetch(url, {
          headers: { 'User-Agent': 'LaundroLeadFinder/1.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (r.ok) {
          const d = await r.json();
          for (const c of (d?.results?.companies || [])) {
            const co = c.company;
            if (co && !results.some(x => x.companyNumber === co.company_number)) {
              results.push(buildResult(co));
            }
          }
        }
      } catch(e) { /* timeout or network error — skip */ }
    }

    // Build smart search links — OpenCorporates name-only is most reliable
    const googleSearches = [
      {
        label: '⭐ OpenCorporates: name only search (most reliable)',
        url: 'https://opencorporates.com/companies?q=' + encodeURIComponent(cleanName || name || street),
      },
      {
        label: 'CT SOTS: State business registry',
        url: 'https://www.concord-sots.ct.gov/CONCORD/online?sn=PublicInquiry&eid=9740',
      },
      {
        label: 'Google: LLC by street address',
        url: 'https://www.google.com/search?q=' + encodeURIComponent('"' + street + '" "' + city + '" LLC'),
      },
      {
        label: 'Google: Owner + registered agent',
        url: 'https://www.google.com/search?q=' + encodeURIComponent((name || '') + ' ' + city + ' owner "registered agent"'),
      },
      {
        label: 'Property tax records',
        url: 'https://www.google.com/search?q=' + encodeURIComponent(street + ' ' + city + ' ' + stateCode + ' property owner assessor'),
      },
    ];

    return res.status(200).json({ results, googleSearches });

  } catch(err) {
    console.error('Owner lookup error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function buildResult(co) {
  const incDate = co.incorporation_date;
  let ownershipYears = null;
  let ownershipLabel = null;
  if (incDate) {
    ownershipYears = Math.floor((Date.now() - new Date(incDate).getTime()) / (1000 * 60 * 60 * 24 * 365));
    ownershipLabel = ownershipYears >= 20
      ? ownershipYears + ' yrs — strong distress signal'
      : ownershipYears + ' yrs ownership';
  }
  return {
    llcName: co.name,
    jurisdiction: co.jurisdiction_code,
    companyNumber: co.company_number,
    incorporationDate: incDate || null,
    status: co.current_status || null,
    registeredAddress: co.registered_address_in_full || null,
    opencorporatesUrl: co.opencorporates_url || null,
    ownershipYears,
    ownershipLabel,
  };
}
