export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { location } = req.query;
  if (!location) return res.status(400).json({ error: 'Location parameter is required' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured' });

  try {
    // Step 1: Geocode the location
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`
    );
    const geoData = await geoRes.json();
    if (!geoData.results || geoData.results.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }
    const { lat, lng } = geoData.results[0].geometry.location;

    // Step 2: Extract zip code from geocode result for Census lookup
    const zipComponent = geoData.results[0].address_components?.find(c => c.types.includes('postal_code'));
    const zipCode = zipComponent?.short_name || null;

    // Step 3: Fetch Census data for this zip (population density + housing)
    const censusData = zipCode ? await fetchCensusData(zipCode) : null;

    // Step 4: Search for laundromats nearby (5km radius)
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&type=laundry&keyword=laundromat&key=${apiKey}`
    );
    const searchData = await searchRes.json();
    const places = (searchData.results || []).slice(0, 20);

    if (places.length === 0) {
      return res.status(200).json({ leads: [], censusData, mapsKey: apiKey });
    }

    // Step 5: Get details for each place
    const leads = await Promise.all(
      places.map(async (place) => {
        try {
          const detailRes = await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,reviews,opening_hours,geometry,photos&key=${apiKey}`
          );
          const detailData = await detailRes.json();
          const d = detailData.result || {};

          // Only keep negative reviews with real text (1-3 stars)
          const negativeReviews = (d.reviews || [])
            .filter(r => r.rating <= 3 && r.text && r.text.trim().length > 15)
            .map(r => ({ text: r.text.slice(0, 200), author: r.author_name || 'Anonymous' }))
            .slice(0, 5);

          // Check if owner has responded to any reviews
          const hasOwnerResponses = (d.reviews || []).some(r => r.owner_answer);

          const reviewCount = d.user_ratings_total || place.user_ratings_total || 0;

          // Get up to 3 photo URLs
          const photos = (d.photos || place.photos || [])
            .slice(0, 3)
            .map(p => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${p.photo_reference}&key=${apiKey}`);

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
            censusData,
            zipCode,
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

async function fetchCensusData(zip) {
  try {
    // Census ACS 5-year estimates for zip code tabulation area (ZCTA)
    // B01003_001E = total population
    // B25024_001E = total housing units
    // B25024_002E = 1-unit detached (single family)
    // B25024_003E = 1-unit attached
    // B25024_004E = 2 units
    // B25024_005E = 3-4 units
    // B25024_006E = 5-9 units
    // B25024_007E = 10-19 units
    // B25024_008E = 20-49 units
    // B25024_009E = 50+ units
    // B01001_001E = total population (cross check)
    const url = `https://api.census.gov/data/2022/acs/acs5?get=B01003_001E,B25024_001E,B25024_002E,B25024_003E,B25024_004E,B25024_005E,B25024_006E,B25024_007E,B25024_008E,B25024_009E&for=zip%20code%20tabulation%20area:${zip}`;
    const censusRes = await fetch(url);
    if (!censusRes.ok) return null;
    const data = await censusRes.json();
    if (!data || data.length < 2) return null;

    const row = data[1];
    const totalPop = parseInt(row[0]) || 0;
    const totalUnits = parseInt(row[1]) || 0;
    const singleFamilyDetached = parseInt(row[2]) || 0;
    const singleFamilyAttached = parseInt(row[3]) || 0;
    const units2 = parseInt(row[4]) || 0;
    const units3to4 = parseInt(row[5]) || 0;
    const units5to9 = parseInt(row[6]) || 0;
    const units10to19 = parseInt(row[7]) || 0;
    const units20to49 = parseInt(row[8]) || 0;
    const units50plus = parseInt(row[9]) || 0;

    const multiFamilyUnits = units2 + units3to4 + units5to9 + units10to19 + units20to49 + units50plus;
    const multiFamilyPct = totalUnits > 0 ? Math.round((multiFamilyUnits / totalUnits) * 100) : 0;
    const singleFamilyPct = totalUnits > 0 ? Math.round(((singleFamilyDetached + singleFamilyAttached) / totalUnits) * 100) : 0;

    return {
      zip,
      totalPopulation: totalPop,
      totalHousingUnits: totalUnits,
      multiFamilyUnits,
      multiFamilyPct,
      singleFamilyPct,
    };
  } catch (e) {
    return null;
  }
}
