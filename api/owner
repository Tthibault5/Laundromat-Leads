export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address, name } = req.query;
  if (!address) return res.status(400).json({ error: 'Address is required' });

  try {
    const results = [];

    // Parse address components
    const parts = address.split(',').map(p => p.trim());
    const street = parts[0] || '';
    const city = parts[1] || '';
    const stateZip = (parts[2] || '').trim();
    const stateCode = stateZip.split(' ')[0] || 'CT';
    const jurisdiction = 'us_' + stateCode.toLowerCase();

    // ── Search 1: OpenCorporates by business name ──
    if (name) {
      const cleanName = name
        .replace(/laundromat|laundry|coin\s*laundry|wash\s*&\s*dry|coin\s*wash|dry\s*cleaning/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanName.length > 2) {
        try {
          const url = 'https://api.opencorporates.com/v0.4/companies/search?q=' +
            encodeURIComponent(cleanName) +
            '&jurisdiction_code=' + jurisdiction +
            '&per_page=5';
          const r = await fetch(url, { headers: { 'User-Agent': 'LaundroLeadFinder/1.0' } });
          if (r.ok) {
            const d = await r.json();
            for (const c of (d?.results?.companies || [])) {
              const co = c.company;
              if (co) results.push(buildResult(co, 'name_search'));
            }
          }
        } catch(e) { /* skip */ }
      }
    }

    // ── Search 2: OpenCorporates by street + city ──
    try {
      const q = street + (city ? ' ' + city : '');
      const url = 'https://api.opencorporates.com/v0.4/companies/search?q=' +
        encodeURIComponent(q) +
        '&jurisdiction_code=' + jurisdiction +
        '&per_page=5';
      const r = await fetch(url, { headers: { 'User-Agent': 'LaundroLeadFinder/1.0' } });
      if (r.ok) {
        const d = await r.json();
        for (const c of (d?.results?.companies || [])) {
          const co = c.company;
          if (co && !results.some(x => x.companyNumber === co.company_number)) {
            results.push(buildResult(co, 'address_search'));
          }
        }
      }
    } catch(e) { /* skip */ }

    // ── Search 3: OpenCorporates full-text by just street number + city ──
    try {
      const streetNum = street.match(/^\d+/)?.[0];
      if (streetNum && city) {
        const url = 'https://api.opencorporates.com/v0.4/companies/search?q=' +
          encodeURIComponent(streetNum + ' ' + city) +
          '&jurisdiction_code=' + jurisdiction +
          '&per_page=5';
        const r = await fetch(url, { headers: { 'User-Agent': 'LaundroLeadFinder/1.0' } });
        if (r.ok) {
          const d = await r.json();
          for (const c of (d?.results?.companies || [])) {
            const co = c.company;
            if (co && !results.some(x => x.companyNumber === co.company_number)) {
              results.push(buildResult(co, 'street_search'));
            }
          }
        }
      }
    } catch(e) { /* skip */ }

    // ── Build Google search links ──
    const googleSearches = [
      {
        label: 'LLC by address',
        url: 'https://www.google.com/search?q=' + encodeURIComponent('"' + street + '" "' + city + '" LLC'),
      },
      {
        label: 'Owner name search',
        url: 'https://www.google.com/search?q=' + encodeURIComponent((name || '') + ' ' + city + ' owner LLC registered agent'),
      },
      {
        label: 'CT SOTS registry',
        url: 'https://www.concord-sots.ct.gov/CONCORD/online?sn=PublicInquiry&eid=9740',
      },
      {
        label: 'OpenCorporates direct',
        url: 'https://opencorporates.com/companies?q=' + encodeURIComponent((name || street) + ' ' + city) + '&jurisdiction_code=' + jurisdiction,
      },
    ];

    return res.status(200).json({ results, googleSearches });

  } catch(err) {
    console.error('Owner lookup error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function buildResult(co, source) {
  const incDate = co.incorporation_date;
  let ownershipYears = null;
  let ownershipLabel = null;
  if (incDate) {
    ownershipYears = Math.floor((Date.now() - new Date(incDate).getTime()) / (1000 * 60 * 60 * 24 * 365));
    ownershipLabel = ownershipYears >= 20
      ? ownershipYears + ' yrs — strong distress signal'
      : ownershipYears >= 10
        ? ownershipYears + ' yrs ownership'
        : ownershipYears + ' yrs';
  }
  return {
    source,
    llcName: co.name,
    jurisdiction: co.jurisdiction_code,
    companyNumber: co.company_number,
    incorporationDate: incDate || null,
    status: co.current_status || null,
    registeredAddress: co.registered_address_in_full || null,
    opencorporatesUrl: co.opencorporates_url || null,
    ownershipYears,
    ownershipLabel,
    confidence: source === 'name_search' ? 'medium' : 'low',
  };
}
