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

    // Step 2: Search for laundromats nearby (tighter 5km radius)
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&type=laundry&keyword=laundromat&key=${apiKey}`
    );
    const searchData = await searchRes.json();
    const places = (searchData.results || []).slice(0, 20);

    if (places.length === 0) {
      return res.status(200).json({ leads: [] });
    }

    // Step 3: Get details for each place
    const leads = await Promise.all(
      places.map(async (place) => {
        try {
          const detailRes = await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,reviews,opening_hours,geometry,photos&key=${apiKey}`
          );
          const detailData = await detailRes.json();
          const d = detailData.result || {};

          const density = estimateDensity(geoData.results[0]);

          // Only keep reviews that have real text content and are negative (1-3 stars)
          const negativeReviews = (d.reviews || [])
            .filter(r => r.rating <= 3 && r.text && r.text.trim().length > 15)
            .map(r => ({ text: r.text.slice(0, 200), author: r.author_name || 'Anonymous' }))
            .slice(0, 5);

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
            reviewCount: reviewCount,
            hasNoReviews: reviewCount === 0,
            hasVeryFewReviews: reviewCount > 0 && reviewCount < 5,
            density: density,
            openNow: d.opening_hours?.open_now ?? null,
            reviews: negativeReviews,
            photos: photos,
            lat: d.geometry?.location?.lat || place.geometry?.location?.lat,
            lng: d.geometry?.location?.lng || place.geometry?.location?.lng,
          };
        } catch (e) {
          return null;
        }
      })
    );

    const validLeads = leads.filter(Boolean);
    return res.status(200).json({ leads: validLeads, total: validLeads.length });

  } catch (err) {
    console.error('Places API error:', err);
    return res.status(500).json({ error: 'Failed to fetch places: ' + err.message });
  }
}

function estimateDensity(geocodeResult) {
  const addressStr = geocodeResult?.formatted_address?.toLowerCase() || '';
  const denseCities = ['new york', 'chicago', 'philadelphia', 'boston', 'san francisco', 'washington', 'miami', 'los angeles', 'brooklyn', 'bronx', 'queens', 'newark', 'jersey city', 'detroit', 'baltimore', 'cleveland', 'pittsburgh', 'st. louis', 'new haven', 'hartford', 'manchester', 'bridgeport', 'stamford'];
  const mediumTerms = ['suburbs', 'township', 'heights', 'park', 'village', 'falls', 'grove', 'hill'];
  if (denseCities.some(c => addressStr.includes(c))) return 'High';
  if (mediumTerms.some(c => addressStr.includes(c))) return 'Medium';
  return 'Low';
}
