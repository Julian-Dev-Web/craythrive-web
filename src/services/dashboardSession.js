// Read-only access verification. Temporary failures are not sign-out events.
const invalidSession = error => error?.status === 401 || error?.name === 'AuthSessionMissingError'
  || ['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt',
    'user_not_found', 'user_banned', 'invalid_token', 'session_expired'].includes(error?.code);
const profileUnavailable = 'Could not verify your CrayThrive profile. Reconnect and retry.';

export async function readDashboardProfile(client, userId) {
  try {
    for (const column of ['id', 'user_id']) {
      const { data, error } = await client.from('profiles').select('*').eq(column, userId).maybeSingle();
      if (error) {
        // Only an absent legacy column permits trying the alternate schema.
        if (['42703', 'PGRST204'].includes(error.code)) continue;
        return { profile: null, status: 'unavailable', error: profileUnavailable };
      }
      if (data) return (data.user_id || data.id) === userId
        ? { profile: data, status: 'ready', error: null }
        : { profile: null, status: 'unavailable', error: profileUnavailable };
    }
    return { profile: null, status: 'missing', error: 'Your CrayThrive account does not have a profile record yet.' };
  } catch {
    return { profile: null, status: 'unavailable', error: profileUnavailable };
  }
}

export async function readDashboardSession(client, hasAccess) {
  if (!client) return { status: 'not-configured', userId: null };
  try {
    // SDK getSession waits for initialization/refresh; never manually copy tokens.
    const { data: restored, error: restoreError } = await client.auth.getSession();
    if (restoreError) return { status: invalidSession(restoreError) ? 'unauthenticated' : 'unavailable', userId: null };
    if (!restored?.session) return { status: 'unauthenticated', userId: null };
    const { data, error } = await client.auth.getUser();
    if (error) return { status: invalidSession(error) ? 'unauthenticated' : 'unavailable', userId: null };
    const user = data?.user;
    if (!user?.id || user.id !== restored.session.user?.id) return { status: 'unavailable', userId: null };
    const result = await readDashboardProfile(client, user.id);
    if (result.status === 'unavailable') return { status: 'unavailable', userId: user.id };
    return { status: hasAccess(result.profile) ? 'authorized' : 'forbidden', userId: user.id };
  } catch {
    return { status: 'unavailable', userId: null };
  }
}

export const signOutLocalSession = client => client.auth.signOut({ scope: 'local' });
