import { createClient } from '@supabase/supabase-js';
import { hasDashboardAccess } from '../src/utils/dashboardAccess.js';
import { validatePublicEnv } from '../src/utils/publicConfig.js';
import { publicTankContract, resolveTankContract, TankSetupError } from '../src/utils/tankPlanningSchema.js';

// The privileged key is used ONLY to read schema metadata, never user rows.
// All auth/profile reads use the caller JWT and normal public key (RLS).
export function createTankSchemaHandler({ env = process.env, fetcher = fetch, clientFactory = createClient } = {}) {
  return async function tankSchemaHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    const fail = (status, code, fields = []) => reply(status, { code, fields });
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return fail(405, 'TANK_METHOD_NOT_ALLOWED');
    }
    const operation = new URL(req.url, 'http://localhost').searchParams.get('operation') || 'create';
    if (!['create', 'edit'].includes(operation)) return fail(400, 'TANK_OPERATION_INVALID');
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer \S+$/i.test(authorization)) return fail(401, 'TANK_AUTH_REQUIRED');
    const token = authorization.slice(7);
    const url = env.VITE_SUPABASE_URL;
    const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
    try {
      if (!url || !publicKey) return fail(503, 'TANK_CONFIG_MISSING');
      validatePublicEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: publicKey });
    } catch { return fail(503, 'TANK_CONFIG_MISSING'); }

    try {
      const userFetch = async (input, options) => {
        try { return await fetcher(input, { ...options, signal: AbortSignal.timeout(8000) }); }
        catch {
          // Auth SDK logs thrown transport errors. Supply a safe service-error
          // response so URLs/provider details cannot enter function logs.
          return Response.json({ message: 'Account verification temporarily unavailable' }, { status: 503 });
        }
      };
      const userClient = clientFactory(url, publicKey, {
        global: { headers: { Authorization: `Bearer ${token}` }, fetch: userFetch },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await userClient.auth.getUser(token);
      if (error || !data?.user?.id) {
        // Provider outages/rate limiting are not an expired user session.
        return error && ![401, 403].includes(error.status)
          ? fail(503, 'TANK_SCHEMA_UNAVAILABLE') : fail(401, 'TANK_AUTH_REQUIRED');
      }
      const userId = data.user.id;
      let profile, profileRead = false;
      for (const column of ['id', 'user_id']) {
        const result = await userClient.from('profiles').select('*').eq(column, userId).maybeSingle();
        if (!result.error) profileRead = true;
        if (!result.error && result.data) { profile = result.data; break; }
      }
      if (!profile && !profileRead) return fail(503, 'TANK_SCHEMA_UNAVAILABLE');
      if (!hasDashboardAccess(profile)) return fail(403, 'TANK_ACCOUNT_NOT_ALLOWED');
      const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
      if (!secretKey) return fail(503, 'TANK_SERVER_SETUP_REQUIRED');
      const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/`, {
        headers: { apikey: secretKey, Accept: 'application/openapi+json' },
        signal: AbortSignal.timeout(8000),
      });
      // Schema gateway denial concerns server credentials, never the user JWT.
      if (!response.ok) return fail(503, [401, 403].includes(response.status) ? 'TANK_SCHEMA_ACCESS_DENIED' : 'TANK_SCHEMA_UNAVAILABLE');
      const contract = publicTankContract(resolveTankContract(await response.json(), { operation }));
      return reply(200, { userId, contract });
    } catch (error) {
      if (error instanceof TankSetupError) return fail(422, error.code, error.fields);
      return fail(503, 'TANK_SCHEMA_UNAVAILABLE');
    }
  };
}
