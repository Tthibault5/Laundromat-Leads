/**
 * GET /api/auth?p=yourpassword
 * Returns 200 + { token } on success, 401 on failure.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.APP_SECRET;
  if (!secret) return res.status(500).json({ error: 'APP_SECRET not configured' });

  const provided = req.query.p;
  if (!provided) return res.status(400).json({ error: 'Password required' });

  if (provided !== secret) {
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ error: 'Incorrect password' });
  }

  return res.status(200).json({ token: secret });
}
