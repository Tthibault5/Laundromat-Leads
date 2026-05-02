export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
  // Return the key as JSON so the client can build the script tag directly
  // This avoids redirect-based callback timing issues
  return res.status(200).json({ key: apiKey });
}
