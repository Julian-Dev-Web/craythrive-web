import { supabase } from '../lib/supabase';

const denied = () => new Error('Developer access could not be verified for this session.');
const factorName = 'CrayThrive Developer';

export function createDeveloperService(client) {
  async function checkAccess() {
    if (!client) throw denied();
    const { data: auth, error: authError } = await client.auth.getSession();
    if (authError || !auth?.session?.access_token) throw denied();
    const { data, error } = await client.functions.invoke('developer-access', {
      body: {}, headers: { Authorization: `Bearer ${auth.session.access_token}` },
    });
    if (error || data?.authorized !== true) throw denied();
    const verifiedUntil = Number.isFinite(data.verifiedUntil) ? data.verifiedUntil : 0;
    return { authorized: true, reauthenticationRequired: data.reauthenticationRequired !== false || verifiedUntil <= Date.now() / 1000, verifiedUntil };
  }

  async function beginVerification(enroll = false) {
    await checkAccess(); // The server UUID gate always precedes factor access/setup.
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw new Error('Unable to load authenticator verification. Please try again.');
    const factor = data?.totp?.find(item => item.status === 'verified');
    if (factor) return { factorId: factor.id, qrCode: null };
    if (!enroll) return { factorId: null, qrCode: null };
    // Clean up only this account's abandoned, unverified Developer enrollment.
    for (const pending of (data?.all || []).filter(item => item.factor_type === 'totp' && item.status === 'unverified' && item.friendly_name === factorName)) {
      const cleanup = await client.auth.mfa.unenroll({ factorId: pending.id });
      if (cleanup.error) throw new Error('Unable to restart authenticator setup. Please try again.');
    }
    const enrolled = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: factorName });
    if (enrolled.error || !enrolled.data?.id || !enrolled.data?.totp?.qr_code) throw new Error('Unable to set up authenticator verification. Please try again.');
    return { factorId: enrolled.data.id, qrCode: enrolled.data.totp.qr_code };
  }

  async function verifyOtp(factorId, code) {
    await checkAccess();
    if (!factorId || !/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code from your authenticator app.');
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new Error('Verification failed. Please use a current authenticator code and try again.');
    const access = await checkAccess(); // Use the newly issued JWT, not a local verified flag.
    if (access.reauthenticationRequired) throw new Error('Verification could not be confirmed. Please try again.');
    return access;
  }

  return { checkAccess, beginVerification, verifyOtp };
}

export const developerService = createDeveloperService(supabase);
