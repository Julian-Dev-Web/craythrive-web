import { authorizeDeveloper } from './developerAuthorization.js';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

export function createDeveloperHandler({ purpose, verifyToken, readSecret, now, operation }) {
  if (!['access', 'backup', 'restore'].includes(purpose)) throw new Error('Unsupported developer handler.');
  return async request => {
    // Preflight performs no data operation. CORS is not an authorization boundary.
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const authorization = await authorizeDeveloper(request, { verifyToken, readSecret, now });
    if (!authorization) return json({ authorized: false }, 403);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (purpose === 'access') return json({ authorized: true, reauthenticationRequired: !authorization.reauthenticated,
      verifiedUntil: authorization.reauthenticated ? authorization.verifiedUntil : null });
    // Enforce a recent Auth-verified OTP for EVERY operation, regardless of UI state.
    if (!authorization.reauthenticated) return json({ authorized: false, reauthenticationRequired: true }, 403);
    // This branch contains no existing backup engine. Never invent destructive restore behavior.
    if (!operation) return json({ error: 'This developer operation is not configured.' }, 501);
    try {
      return json(await operation({ request, userId: authorization.userId }));
    } catch {
      return json({ error: 'The developer operation could not be completed.' }, 503);
    }
  };
}
