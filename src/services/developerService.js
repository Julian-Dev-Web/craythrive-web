import { supabase } from '../lib/supabase';

const denied = () => new Error('Developer access could not be verified for this session.');
const factorName = 'CrayThrive Developer';

function authenticatorQrSource(value) {
  const qr = typeof value === 'string' ? value.trim() : '';
  const dataImage = /^data:image\/svg\+xml(?:;(?:utf-8|charset=utf-8|base64))?,/i.exec(qr);
  const svg = dataImage ? qr.slice(dataImage[0].length) : qr;
  // Auth JS wraps the raw SVG in a data URI. Encode only the SVG payload,
  // including any '#' characters; never wrap an existing URI a second time.
  if (/^\s*<(?:svg\b|\?xml\b)/i.test(svg)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  if (dataImage && svg) return qr; // Already encoded or base64 SVG image.
  throw new Error('Unable to load authenticator setup. Please try again.');
}

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
    return { factorId: enrolled.data.id, qrCode: authenticatorQrSource(enrolled.data.totp.qr_code) };
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

  async function invokeOperation(name, body) {
    if (!client) throw denied();
    const { data: auth, error: authError } = await client.auth.getSession();
    if (authError || !auth?.session?.access_token) throw denied();
    const { data, error } = await client.functions.invoke(name, {
      body, headers: { Authorization: `Bearer ${auth.session.access_token}` },
    });
    if (error) {
      const status = error.context?.status;
      if (status === 401 || status === 403) {
        const expired = new Error('Verify your identity again before continuing.');
        expired.reauthenticationRequired = true;
        throw expired;
      }
      if (status === 409) throw new Error('The database or preview changed. Preview the backup again.');
      if (status === 413) throw new Error('The dataset or file exceeds the app backup limit. Use a database-level backup.');
      if (status === 400 || status === 415) throw new Error('The backup file or confirmation is invalid. Use an unmodified CrayThrive backup from this project.');
      throw new Error('The operation could not be completed. No partial restore was applied. Please retry or check the server configuration.');
    }
    if (!data || typeof data !== 'object') throw new Error('The server did not confirm the operation.');
    return data;
  }

  return { checkAccess, beginVerification, verifyOtp,
    exportBackup: () => invokeOperation('developer-backup', { action: 'export' }),
    previewRestore: backup => invokeOperation('developer-restore', { action: 'preview', backup }),
    applyRestore: (backup, previewToken, confirmation) => invokeOperation('developer-restore', { action: 'apply', backup, previewToken, confirmation }),
  };
}

export const developerService = createDeveloperService(supabase);
