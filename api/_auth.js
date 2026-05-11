/**
 * Shared auth middleware for all API routes.
 * Checks the x-app-key header against the APP_SECRET env variable.
 *
 * Usage in any route:
 *   import { requireAuth } from './_auth.js';
 *   export default async function handler(req, res) {
 *     if (!requireAuth(req, res)) return;
 *     // ... rest of handler
 *   }
 */

export function requireAuth(req, res) {
  // Always allow CORS preflight through
  if (req.method === 'OPTIONS') return true;

  const secret = process.env.APP_SECRET;
  if (!secret) {
    // If no secret is configured, lock everything down rather than open it up
    res.status(500).json({ error: 'APP_SECRET environment variable not configured.' });
    return false;
  }

  const provided = req.headers['x-app-key'];
  if (!provided || provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}
