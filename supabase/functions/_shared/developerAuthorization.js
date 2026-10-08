// Server-only identity. Never import this module from src/ or return its configuration.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REAUTH_SECONDS = 300;

export function createSupabaseTokenVerifier(createClient, readSecret) {
  return async token => {
    const url = readSecret('SUPABASE_URL');
    const key = readSecret('SUPABASE_ANON_KEY');
    if (!url || !key) return null;
    // A separate, nonpersistent client per request. No service role is needed.
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const identity = await client.auth.getUser(token);
    if (identity.error || !identity.data?.user) return null;
    // getClaims verifies signature/expiry; never authorize from a decoded JWT alone.
    const verified = await client.auth.getClaims(token);
    if (verified.error || !verified.data?.claims) return null;
    return { user: identity.data.user, claims: verified.data.claims };
  };
}

export async function authorizeDeveloper(request, { verifyToken, readSecret, now = () => Date.now() }) {
  try {
    const expectedId = String(readSecret('CRAYTHRIVE_DEVELOPER_USER_ID') || '').trim();
    // Exactly one UUID: absent/malformed values and lists deny everyone.
    if (!UUID.test(expectedId)) return null;
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '');
    if (!match) return null;
    const verified = await verifyToken(match[1]);
    const user = verified?.user;
    const claims = verified?.claims;
    const seconds = Math.floor(now() / 1000);
    if (!user || !UUID.test(user.id || '') || user.id.toLowerCase() !== expectedId.toLowerCase() ||
      !claims || claims.sub !== user.id || claims.role !== 'authenticated' ||
      !(claims.aud === 'authenticated' || (Array.isArray(claims.aud) && claims.aud.includes('authenticated'))) ||
      !Number.isFinite(claims.exp) || claims.exp <= seconds ||
      (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > seconds)) ||
      user.is_anonymous === true || claims.is_anonymous === true) return null;
    const expectedEmail = String(readSecret('CRAYTHRIVE_DEVELOPER_EMAIL') || '').trim().toLowerCase();
    // Optional additional check; it can never replace the mandatory UUID match.
    if (expectedEmail && (expectedEmail.includes(',') || user.email?.toLowerCase() !== expectedEmail || !user.email_confirmed_at)) return null;
    const timestamps = claims.aal === 'aal2' && Array.isArray(claims.amr)
      ? claims.amr.filter(method => ['totp', 'mfa/totp'].includes(method?.method) && Number.isFinite(method.timestamp) && method.timestamp <= seconds)
        .map(method => method.timestamp) : [];
    const verifiedUntil = timestamps.length ? Math.max(...timestamps) + REAUTH_SECONDS : 0;
    return { userId: user.id, reauthenticated: verifiedUntil > seconds, verifiedUntil };
  } catch {
    // No provider internals, configured identity, token or credentials in responses/logs.
    return null;
  }
}
