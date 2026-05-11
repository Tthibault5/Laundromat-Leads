/**
 * POST /api/auth
 * Body: { password: "..." }
 * Returns 200 + { token } on success, 401 on failure.
 *
 * The "token" returned is just the secret itself — the client stores it
 * in sessionStorage and sends it as x-app-key on every subsequent request.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.APP_SECRET;
  if (!secret) return res.status(500).json({ error: 'APP_SECRET not configured' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });

  if (password !== secret) {
    // Small delay to slow down brute-force attempts
    await new Promise(r => setTimeout(r, 500));
    return res.status(401).json({ error: 'Incorrect password' });
  }

  return res.status(200).json({ token: secret });
}
