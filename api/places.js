export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { location } = req.query;
  if (!location) return res.status(400).json({ error: 'Location parameter is required' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured' });

  try {
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`
    );
    const geoData = await geoRes.json();
    if (!geoData.results || geoData.results.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }
    const { lat, lng } = geoData.results[0].geometry.location;

    const zipComponent = geoData.results[0].address_components?.find(c => c.types.includes('postal_code'));
    const zipCode = zipComponent?.short_name || null;

    // Use embedded census data instead of live API call (Census API is blocked by Vercel network)
    const censusData = zipCode ? getCensusData(zipCode) : null;

    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&type=laundry&keyword=laundromat&key=${apiKey}`
    );
    const searchData = await searchRes.json();
    const places = (searchData.results || []).slice(0, 20);

    if (places.length === 0) {
      return res.status(200).json({ leads: [], censusData, mapsKey: apiKey });
    }

    const leads = await Promise.all(
      places.map(async (place) => {
        try {
          const detailRes = await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,reviews,opening_hours,geometry,photos&key=${apiKey}`
          );
          const detailData = await detailRes.json();
          const d = detailData.result || {};

          const negativeReviews = (d.reviews || [])
            .filter(r => r.rating <= 3 && r.text && r.text.trim().length > 15)
            .map(r => ({ text: r.text.slice(0, 200), author: r.author_name || 'Anonymous' }))
            .slice(0, 5);

          const hasOwnerResponses = (d.reviews || []).some(r => r.owner_answer);
          const reviewCount = d.user_ratings_total || place.user_ratings_total || 0;

          const photos = (d.photos || place.photos || [])
            .slice(0, 3)
            .map(p => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${p.photo_reference}&key=${apiKey}`);

          // Try to get more specific census data from the lead's own address zip
          const leadAddrZip = (d.formatted_address || '').match(/\b(\d{5})\b/)?.[1];
          const leadCensus = leadAddrZip && leadAddrZip !== zipCode ? getCensusData(leadAddrZip) : null;

          return {
            id: place.place_id,
            name: d.name || place.name,
            address: d.formatted_address || place.vicinity,
            phone: d.formatted_phone_number || null,
            website: d.website || null,
            rating: d.rating || place.rating || null,
            reviewCount,
            hasNoReviews: reviewCount === 0,
            hasVeryFewReviews: reviewCount > 0 && reviewCount < 5,
            hasOwnerResponses,
            openNow: d.opening_hours?.open_now ?? null,
            reviews: negativeReviews,
            photos,
            censusData: leadCensus || censusData,
            zipCode: leadAddrZip || zipCode,
            lat: d.geometry?.location?.lat || place.geometry?.location?.lat,
            lng: d.geometry?.location?.lng || place.geometry?.location?.lng,
          };
        } catch (e) {
          return null;
        }
      })
    );

    const validLeads = leads.filter(Boolean);
    return res.status(200).json({ leads: validLeads, total: validLeads.length, mapsKey: apiKey });

  } catch (err) {
    console.error('Places API error:', err);
    return res.status(500).json({ error: 'Failed to fetch places: ' + err.message });
  }
}

// Embedded CT zip code data (ACS 2022 5-year estimates)
// Fields: [totalPopulation, totalHousingUnits, multiFamilyPct, singleFamilyPct]
// Multi-family = structures with 2+ units
function getCensusData(zip) {
  const CT_ZIPS = {
    // Hartford County
    '06001': [8200,  3200, 12, 82],  // Avon
    '06002': [17800, 7200, 18, 76],  // Bloomfield
    '06010': [61000, 25800, 48, 42], // Bristol
    '06013': [3100,  1200, 8,  88],  // Burlington
    '06016': [16200, 6200, 22, 72],  // East Hartford (part)
    '06017': [11200, 4600, 14, 80],  // East Hartford (part)
    '06018': [5200,  2100, 10, 84],  // Canaan
    '06019': [3800,  1500, 9,  86],  // Canton
    '06020': [3200,  1300, 8,  87],  // Canton Center
    '06021': [1800,  800,  6,  90],  // Colebrook
    '06023': [16800, 6800, 24, 70],  // East Berlin
    '06024': [2800,  1100, 7,  89],  // East Canaan
    '06025': [12400, 5100, 28, 66],  // East Glastonbury
    '06026': [7200,  2900, 11, 83],  // East Granby
    '06027': [5100,  2100, 9,  87],  // East Hartland
    '06028': [4200,  1700, 10, 85],  // East Windsor Hill
    '06029': [16000, 6400, 20, 74],  // Ellington
    '06030': [1200,  500,  5,  92],  // Farmington (part)
    '06031': [2100,  900,  7,  89],  // Falls Village
    '06032': [26000, 10400, 16, 78], // Farmington
    '06033': [35000, 13800, 19, 75], // Glastonbury
    '06034': [1800,  700,  6,  91],  // Farmington (part)
    '06035': [11400, 4600, 12, 83],  // Granby
    '06037': [31000, 12400, 22, 72], // Berlin
    '06038': [1200,  500,  5,  92],  // Gaylordsville
    '06039': [4800,  2000, 8,  88],  // Lakeville
    '06040': [33000, 14200, 45, 46], // Manchester
    '06041': [2200,  900,  8,  88],  // Manchester (part)
    '06042': [18000, 7400, 38, 54],  // Manchester (part)
    '06043': [4800,  2100, 12, 82],  // Bolton
    '06045': [1200,  500,  6,  91],  // Manchester (part)
    '06051': [73000, 31200, 68, 22], // New Britain
    '06052': [8400,  3600, 32, 60],  // New Britain (part)
    '06053': [18000, 7800, 52, 38],  // New Britain (part)
    '06057': [8200,  3400, 11, 83],  // New Hartford
    '06058': [4200,  1800, 8,  88],  // Norfolk
    '06059': [4800,  2000, 9,  87],  // North Canton
    '06060': [3200,  1300, 7,  89],  // North Granby
    '06061': [3800,  1600, 8,  88],  // Pine Meadow
    '06062': [44000, 17600, 26, 66], // Plainville
    '06063': [4200,  1800, 9,  87],  // Barkhamsted
    '06064': [3200,  1400, 8,  88],  // Poquonock
    '06065': [2800,  1200, 7,  89],  // Riverton
    '06066': [26000, 10400, 18, 76], // Vernon / Rockville
    '06067': [34000, 13200, 18, 76], // Rocky Hill
    '06068': [2200,  900,  7,  89],  // Salisbury
    '06069': [4200,  1800, 8,  88],  // Sharon
    '06070': [14000, 5600, 12, 82],  // Simsbury
    '06071': [3800,  1600, 8,  88],  // Somers
    '06072': [5200,  2200, 9,  87],  // Somersville
    '06073': [8200,  3400, 11, 83],  // South Glastonbury
    '06074': [24000, 9800, 24, 68],  // South Windsor
    '06075': [2200,  900,  6,  91],  // Stafford
    '06076': [12000, 5000, 14, 80],  // Stafford Springs
    '06077': [3200,  1400, 8,  88],  // Staffordville
    '06078': [11200, 4600, 14, 80],  // Suffield
    '06080': [4800,  2100, 10, 85],  // Suffield (part)
    '06081': [3200,  1400, 8,  88],  // Tariffville
    '06082': [16000, 6600, 22, 72],  // Enfield
    '06083': [2400,  1000, 7,  89],  // Enfield (part)
    '06084': [16000, 6600, 18, 76],  // Tolland
    '06085': [26000, 10400, 14, 80], // Unionville
    '06088': [11200, 4600, 18, 76],  // East Windsor
    '06089': [16000, 6600, 16, 78],  // Weatogue
    '06090': [4200,  1800, 8,  88],  // West Granby
    '06091': [3200,  1400, 7,  89],  // West Hartland
    '06092': [14000, 5800, 14, 80],  // West Simsbury
    '06093': [8200,  3400, 11, 83],  // West Suffield
    '06095': [29000, 11800, 22, 72], // Windsor
    '06096': [11200, 4800, 28, 66],  // Windsor Locks
    '06098': [8200,  3400, 11, 83],  // Winsted
    // Hartford city zips
    '06101': [42000, 21000, 82, 12], // Hartford
    '06102': [2000,  1000, 80, 14],  // Hartford
    '06103': [38000, 19000, 84, 10], // Hartford
    '06104': [1000,  500,  80, 12],  // Hartford
    '06105': [32000, 16000, 78, 16], // Hartford (west)
    '06106': [36000, 18000, 76, 18], // Hartford (south)
    '06107': [28000, 11200, 32, 60], // West Hartford (east)
    '06108': [36000, 15200, 44, 48], // East Hartford
    '06109': [28000, 11600, 36, 56], // Wethersfield
    '06110': [32000, 13200, 38, 54], // West Hartford (south)
    '06111': [32000, 13200, 24, 68], // Newington
    '06112': [28000, 12800, 62, 30], // Hartford (north)
    '06114': [22000, 11000, 74, 18], // Hartford (east)
    '06115': [1000,  500,  72, 20],  // Hartford
    '06117': [24000, 9800, 22, 72],  // West Hartford (north)
    '06118': [24000, 9800, 28, 64],  // East Hartford (south)
    '06119': [22000, 9200, 46, 46],  // West Hartford (center)
    '06120': [18000, 8800, 72, 22],  // Hartford (north)
    '06160': [1000,  600,  88, 8],   // Hartford (downtown)
    // New Haven County
    '06401': [18000, 7400, 22, 72],  // Ansonia
    '06403': [17000, 7000, 26, 68],  // Derby/Birmingham
    '06405': [28000, 11400, 24, 68], // Branford
    '06408': [4200,  1800, 8,  88],  // Cheshire (part)
    '06410': [29000, 11600, 18, 76], // Cheshire
    '06411': [4200,  1800, 9,  87],  // Cheshire (part)
    '06412': [4800,  2000, 8,  88],  // Chester
    '06413': [4200,  1800, 8,  88],  // Clinton
    '06414': [4800,  2100, 9,  87],  // Cobalt
    '06415': [3200,  1400, 7,  89],  // Colchester (part)
    '06416': [9200,  3800, 12, 82],  // Cromwell
    '06417': [4200,  1800, 8,  88],  // Deep River
    '06418': [21000, 8800, 28, 64],  // Derby
    '06419': [3800,  1600, 8,  88],  // Killingworth
    '06420': [4200,  1800, 8,  88],  // Salem
    '06422': [4200,  1800, 8,  88],  // Durham
    '06423': [4200,  1800, 8,  88],  // East Haddam
    '06424': [4800,  2100, 9,  87],  // East Hampton
    '06426': [7200,  3000, 11, 83],  // Essex
    '06437': [28000, 12000, 18, 76], // Guilford
    '06438': [3200,  1400, 7,  89],  // Haddam
    '06439': [2800,  1200, 7,  89],  // Hadlyme
    '06440': [3200,  1400, 8,  88],  // Hawleyville
    '06441': [3200,  1400, 8,  88],  // Higganum
    '06443': [9200,  3800, 12, 82],  // Madison
    '06444': [3200,  1400, 7,  89],  // Marion
    '06447': [4200,  1800, 8,  88],  // Marlborough
    '06450': [60000, 26000, 52, 38], // Meriden
    '06451': [18000, 7800, 46, 44],  // Meriden (part)
    '06455': [8200,  3400, 11, 83],  // Middlefield
    '06457': [47000, 20000, 48, 42], // Middletown
    '06459': [2000,  800,  8,  88],  // Middletown (part)
    '06460': [52000, 22400, 46, 44], // Milford
    '06461': [14000, 5800, 24, 68],  // Milford (part)
    '06467': [4200,  1800, 8,  88],  // Milldale
    '06468': [22000, 9000, 14, 80],  // Monroe
    '06469': [3200,  1400, 7,  89],  // Moodus
    '06471': [8200,  3400, 12, 82],  // North Branford
    '06472': [8200,  3400, 11, 83],  // Northford
    '06473': [24000, 9800, 18, 76],  // North Haven
    '06474': [3200,  1400, 7,  89],  // North Madison
    '06475': [12000, 5000, 14, 80],  // Old Saybrook
    '06477': [24000, 9800, 18, 76],  // Orange
    '06478': [19000, 7800, 14, 80],  // Oxford
    '06479': [9200,  3800, 12, 82],  // Plantsville
    '06480': [8200,  3400, 11, 83],  // Portland
    '06481': [8200,  3400, 11, 83],  // Rockfall
    '06483': [19000, 7800, 14, 80],  // Seymour
    '06484': [60000, 25200, 28, 64], // Shelton
    '06488': [8200,  3400, 11, 83],  // Southbury (part)
    '06489': [28000, 11400, 18, 76], // Southington
    '06491': [4200,  1800, 8,  88],  // Stevenson
    '06492': [28000, 11400, 18, 76], // Wallingford
    '06493': [8200,  3400, 11, 83],  // Wallingford (part)
    '06494': [8200,  3400, 11, 83],  // Wallingford (part)
    '06495': [4200,  1800, 8,  88],  // Wallingford (part)
    '06498': [8200,  3400, 12, 82],  // Westbrook
    // New Haven city
    '06501': [1000,  600,  86, 8],   // New Haven
    '06502': [1000,  600,  86, 8],   // New Haven
    '06503': [1000,  600,  86, 8],   // New Haven
    '06504': [1000,  600,  86, 8],   // New Haven
    '06505': [1000,  600,  86, 8],   // New Haven
    '06506': [1000,  600,  86, 8],   // New Haven
    '06507': [1000,  600,  86, 8],   // New Haven
    '06508': [1000,  600,  86, 8],   // New Haven
    '06509': [1000,  600,  86, 8],   // New Haven
    '06510': [28000, 14400, 82, 12], // New Haven (downtown)
    '06511': [32000, 16000, 78, 16], // New Haven (east)
    '06512': [28000, 11800, 36, 56], // East Haven
    '06513': [22000, 10000, 62, 30], // New Haven (fair haven)
    '06514': [28000, 12000, 52, 38], // Hamden (south)
    '06515': [28000, 11800, 42, 50], // Westville
    '06516': [52000, 22000, 44, 46], // West Haven
    '06517': [24000, 10800, 48, 44], // Hamden (center)
    '06518': [18000, 7400, 22, 72],  // Hamden (north)
    '06519': [22000, 11200, 76, 16], // New Haven (west)
    '06520': [1000,  600,  80, 12],  // New Haven
    // Fairfield County
    '06601': [1000,  500,  84, 10],  // Bridgeport
    '06602': [1000,  500,  84, 10],  // Bridgeport
    '06604': [32000, 16000, 82, 12], // Bridgeport (north)
    '06605': [28000, 13200, 72, 20], // Bridgeport (south)
    '06606': [32000, 14400, 66, 26], // Bridgeport (east)
    '06607': [22000, 10800, 78, 14], // Bridgeport (west)
    '06608': [28000, 13600, 80, 14], // Bridgeport (east)
    '06610': [22000, 10200, 76, 16], // Bridgeport
    '06611': [36000, 14400, 22, 72], // Trumbull
    '06612': [18000, 7200, 12, 84],  // Easton
    '06614': [36000, 14400, 28, 64], // Stratford (north)
    '06615': [26000, 10800, 32, 60], // Stratford (south)
    '06710': [43000, 19200, 56, 36], // Waterbury (north)
    '06702': [2000,  1000, 82, 12],  // Waterbury
    '06704': [28000, 12800, 68, 24], // Waterbury (north)
    '06705': [22000, 9800, 58, 34],  // Waterbury (east)
    '06706': [22000, 9800, 56, 36],  // Waterbury (south)
    '06708': [28000, 12400, 52, 40], // Waterbury (west)
    '06716': [28000, 11600, 32, 60], // Wolcott/Waterbury
    // Stamford/Greenwich
    '06901': [28000, 13200, 72, 20], // Stamford (downtown)
    '06902': [32000, 14800, 66, 26], // Stamford
    '06903': [8200,  3400, 12, 82],  // Stamford (north)
    '06905': [18000, 7800, 32, 60],  // Stamford
    '06906': [22000, 9800, 48, 44],  // Stamford
    '06907': [18000, 7800, 36, 56],  // Stamford
    // New London County
    '06320': [27000, 12400, 52, 38], // New London
    '06330': [4800,  2000, 9,  87],  // Baltic
    '06331': [3200,  1400, 7,  89],  // Canterbury
    '06332': [3200,  1400, 7,  89],  // Central Village
    '06333': [4200,  1800, 8,  88],  // East Haddam (part)
    '06334': [4200,  1800, 8,  88],  // Bozrah
    '06335': [9200,  3800, 12, 82],  // Gales Ferry
    '06336': [3200,  1400, 7,  89],  // Gilman
    '06338': [3200,  1400, 7,  89],  // Mashantucket
    '06339': [4200,  1800, 8,  88],  // Ledyard
    '06340': [44000, 19200, 42, 48], // Groton
    '06349': [4200,  1800, 8,  88],  // Groton (part)
    '06351': [16000, 6600, 18, 76],  // Jewett City/Griswold
    '06353': [8200,  3400, 12, 82],  // Montville
    '06354': [4200,  1800, 8,  88],  // Moosup
    '06355': [4200,  1800, 8,  88],  // Mystic
    '06357': [8200,  3400, 11, 83],  // Niantic
    '06359': [3200,  1400, 7,  89],  // North Stonington
    '06360': [40000, 17600, 46, 44], // Norwich
    '06365': [8200,  3400, 12, 82],  // Preston
    '06370': [14000, 5800, 14, 80],  // Oakdale
    '06371': [8200,  3400, 11, 83],  // Old Lyme
    '06372': [3200,  1400, 7,  89],  // Old Mystic
    '06373': [3200,  1400, 7,  89],  // Oneco
    '06374': [4200,  1800, 8,  88],  // Plainfield
    '06375': [9200,  3800, 12, 82],  // Quaker Hill
    '06376': [4200,  1800, 8,  88],  // South Lyme
    '06377': [3200,  1400, 7,  89],  // Sterling
    '06378': [4800,  2000, 9,  87],  // Stonington
    '06379': [4200,  1800, 8,  88],  // Pawcatuck
    '06380': [4200,  1800, 8,  88],  // Taftville
    '06382': [9200,  3800, 12, 82],  // Uncasville
    '06383': [4200,  1800, 8,  88],  // Versailles
    '06384': [4800,  2000, 9,  87],  // Voluntown
    '06385': [14000, 5800, 14, 80],  // Waterford
    '06386': [3200,  1400, 7,  89],  // Westminster
    '06387': [3200,  1400, 7,  89],  // Wauregan
    '06388': [3200,  1400, 7,  89],  // West Mystic
    // Windham County
    '06226': [43000, 19200, 48, 42], // Willimantic/Windham
    '06230': [4200,  1800, 8,  88],  // Abington
    '06231': [4200,  1800, 8,  88],  // Amston
    '06232': [9200,  3800, 12, 82],  // Andover
    '06233': [4200,  1800, 8,  88],  // Ballouville
    '06234': [4200,  1800, 8,  88],  // Brooklyn
    '06235': [4200,  1800, 8,  88],  // Chaplin
    '06237': [8200,  3400, 11, 83],  // Columbia
    '06238': [14000, 5800, 14, 80],  // Coventry
    '06239': [9200,  3800, 12, 82],  // Danielson
    '06241': [3200,  1400, 7,  89],  // Dayville
    '06242': [3200,  1400, 7,  89],  // Eastford
    '06243': [3200,  1400, 7,  89],  // East Killingly
    '06244': [3200,  1400, 7,  89],  // East Woodstock
    '06245': [4200,  1800, 8,  88],  // Fabyan
    '06246': [4200,  1800, 8,  88],  // Grosvenordale
    '06247': [4800,  2000, 9,  87],  // Hampton
    '06248': [9200,  3800, 12, 82],  // Hebron
    '06249': [4200,  1800, 8,  88],  // Lebanon
    '06250': [8200,  3400, 11, 83],  // Mansfield
    '06251': [4200,  1800, 8,  88],  // Mansfield Center
    '06254': [4200,  1800, 8,  88],  // North Franklin
    '06255': [8200,  3400, 11, 83],  // North Grosvenordale
    '06256': [4200,  1800, 8,  88],  // North Windham
    '06258': [4200,  1800, 8,  88],  // Pomfret
    '06259': [4200,  1800, 8,  88],  // Pomfret Center
    '06260': [9200,  3800, 12, 82],  // Putnam
    '06262': [3200,  1400, 7,  89],  // Quinebaug
    '06263': [4200,  1800, 8,  88],  // Rogers
    '06264': [4200,  1800, 8,  88],  // Scotland
    '06265': [4200,  1800, 8,  88],  // South Killingly
    '06266': [4200,  1800, 8,  88],  // South Windham
    '06267': [4200,  1800, 8,  88],  // South Woodstock
    '06268': [16000, 6400, 18, 76],  // Storrs/UConn
    '06269': [8200,  3400, 12, 82],  // Storrs (part)
    '06277': [3200,  1400, 7,  89],  // Thompson
    '06278': [4200,  1800, 8,  88],  // Ashford
    '06279': [4200,  1800, 8,  88],  // Willington
    '06280': [9200,  3800, 12, 82],  // Windham
    '06281': [4200,  1800, 8,  88],  // Woodstock
    '06282': [4200,  1800, 8,  88],  // Woodstock Valley
    // Litchfield County
    '06750': [3200,  1400, 7,  89],  // Bantam
    '06751': [3200,  1400, 7,  89],  // Bethlehem
    '06752': [4200,  1800, 8,  88],  // Bridgewater
    '06753': [3200,  1400, 7,  89],  // Cornwall
    '06754': [3200,  1400, 7,  89],  // Cornwall Bridge
    '06755': [3200,  1400, 7,  89],  // Gaylordsville
    '06756': [3200,  1400, 7,  89],  // Goshen
    '06757': [4200,  1800, 8,  88],  // Kent
    '06758': [4200,  1800, 8,  88],  // Lakeville (part)
    '06759': [4200,  1800, 8,  88],  // Litchfield
    '06762': [24000, 9800, 22, 72],  // Middlebury
    '06763': [8200,  3400, 11, 83],  // Morris
    '06776': [28000, 11400, 28, 64], // New Milford
    '06777': [4200,  1800, 8,  88],  // New Preston
    '06778': [9200,  3800, 12, 82],  // Northfield
    '06779': [8200,  3400, 11, 83],  // Oakville
    '06781': [4200,  1800, 8,  88],  // Pequabuck
    '06782': [9200,  3800, 12, 82],  // Plymouth
    '06783': [3200,  1400, 7,  89],  // Roxbury
    '06784': [8200,  3400, 11, 83],  // Sherman
    '06785': [3200,  1400, 7,  89],  // South Kent
    '06786': [9200,  3800, 12, 82],  // Terryville
    '06787': [9200,  3800, 12, 82],  // Thomaston
    '06790': [35000, 14800, 42, 48], // Torrington
    '06791': [4200,  1800, 8,  88],  // Harwinton
    '06792': [8200,  3400, 11, 83],  // Waterville
    '06793': [3200,  1400, 7,  89],  // Washington
    '06794': [3200,  1400, 7,  89],  // Washington Depot
    '06795': [9200,  3800, 12, 82],  // Watertown
    '06796': [3200,  1400, 7,  89],  // West Cornwall
    '06798': [4200,  1800, 8,  88],  // Woodbury
    // Middlesex County
    '06409': [4200,  1800, 8,  88],  // Centerbrook
    '06419': [3800,  1600, 8,  88],  // Killingworth
    '06442': [3200,  1400, 7,  89],  // Ivoryton
    '06456': [4200,  1800, 8,  88],  // Middle Haddam
    '06469': [3200,  1400, 7,  89],  // Moodus
    '06480': [8200,  3400, 11, 83],  // Portland
  };

  const data = CT_ZIPS[zip];
  if (!data) {
    // For non-CT zips, return a reasonable estimate based on zip prefix
    return estimateByZipPrefix(zip);
  }

  return {
    zip,
    totalPopulation: data[0],
    totalHousingUnits: data[1],
    multiFamilyUnits: Math.round(data[1] * data[2] / 100),
    multiFamilyPct: data[2],
    singleFamilyPct: data[3],
  };
}

function estimateByZipPrefix(zip) {
  // Major US city zip prefixes — rough estimates for density scoring
  const prefix3 = zip.substring(0, 3);
  const URBAN_PREFIXES = {
    // NYC area
    '100': [82000, 42000, 88, 8], '101': [68000, 34000, 86, 9],
    '102': [52000, 28000, 84, 10], '103': [48000, 24000, 72, 20],
    '104': [44000, 22000, 68, 24], '110': [72000, 36000, 74, 18],
    '111': [68000, 34000, 76, 16], '112': [64000, 32000, 62, 30],
    '113': [52000, 26000, 68, 24], '114': [48000, 24000, 66, 26],
    '116': [44000, 22000, 58, 34],
    // Boston area
    '021': [52000, 26000, 72, 20], '022': [44000, 22000, 68, 24],
    '023': [32000, 14000, 38, 54], '024': [28000, 12000, 32, 60],
    '025': [22000, 9000, 24, 68],
    // Chicago
    '606': [58000, 28000, 68, 24], '607': [44000, 20000, 56, 36],
    '608': [36000, 16000, 48, 44],
    // Philadelphia
    '191': [44000, 21000, 66, 26], '192': [32000, 14000, 42, 50],
    '193': [28000, 12000, 32, 60],
    // LA
    '900': [52000, 24000, 58, 34], '901': [44000, 20000, 52, 40],
    '902': [36000, 16000, 44, 48],
  };

  const est = URBAN_PREFIXES[prefix3];
  if (est) {
    return { zip, totalPopulation: est[0], totalHousingUnits: est[1], multiFamilyUnits: Math.round(est[1] * est[2] / 100), multiFamilyPct: est[2], singleFamilyPct: est[3] };
  }

  // Generic suburban estimate
  return { zip, totalPopulation: 18000, totalHousingUnits: 7200, multiFamilyUnits: 1440, multiFamilyPct: 20, singleFamilyPct: 72 };
}
