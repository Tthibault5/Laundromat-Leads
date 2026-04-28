export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { location } = req.query;
  if (!location) return res.status(400).json({ error: 'Location parameter is required' });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Google Places API key not configured' });

  try {
    // Step 1: Geocode the location to get lat/lng
    const geoRes = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}`
    );
    const geoData = await geoRes.json();
    if (!geoData.results || geoData.results.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }
    const { lat, lng } = geoData.results[0].geometry.location;

    // Step 2: Search for laundromats nearby
    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=8000&type=laundry&keyword=laundromat&key=${apiKey}`
    );
    const searchData = await searchRes.json();
    const places = (searchData.results || []).slice(0, 20);

    if (places.length === 0) {
      return res.status(200).json({ leads: [] });
    }

    // Step 3: Get details for each place (phone, website, reviews)
    const leads = await Promise.all(
      places.map(async (place) => {
        try {
          const detailRes = await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,reviews,opening_hours,geometry&key=${apiKey}`
          );
          const detailData = await detailRes.json();
          const d = detailData.result || {};

          // Estimate density based on location type from geocoding
          const density = estimateDensity(lat, lng, geoData.results[0]);

          // Filter reviews to only negative ones (1-3 stars)
          const negativeReviews = (d.reviews || [])
            .filter(r => r.rating <= 3)
            .map(r => ({ text: r.text?.slice(0, 200) || '', author: r.author_name || 'Anonymous' }))
            .slice(0, 5);

          return {
            id: place.place_id,
            name: d.name || place.name,
            address: d.formatted_address || place.vicinity,
            phone: d.formatted_phone_number || null,
            website: d.website || null,
            rating: d.rating || place.rating || null,
            reviewCount: d.user_ratings_total || place.user_ratings_total || 0,
            density: density,
            openNow: d.opening_hours?.open_now ?? null,
            reviews: negativeReviews,
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

function estimateDensity(lat, lng, geocodeResult) {
  // Use address components to estimate density
  const types = geocodeResult?.types || [];
  const components = geocodeResult?.address_components || [];

  // Check if it's a major city or urban area
  const isUrban = types.some(t => ['locality', 'sublocality', 'neighborhood'].includes(t));
  const addressStr = geocodeResult?.formatted_address?.toLowerCase() || '';

  // Major dense metros
  const denseCities = ['new york', 'chicago', 'philadelphia', 'boston', 'san francisco', 'washington', 'miami', 'los angeles', 'brooklyn', 'bronx', 'queens', 'newark', 'jersey city', 'detroit', 'baltimore', 'cleveland', 'pittsburgh', 'st. louis', 'new haven', 'hartford', 'manchester'];
  const mediumCities = ['suburbs', 'township', 'heights', 'park', 'village', 'falls', 'grove', 'hill'];

  if (denseCities.some(c => addressStr.includes(c))) return 'High';
  if (mediumCities.some(c => addressStr.includes(c))) return 'Medium';
  if (isUrban) return 'Medium';
  return 'Low';
}
