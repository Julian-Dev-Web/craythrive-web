// Browser-tab explanation cache, not a safety policy or an authorization source.
export const AI_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
export const AI_HISTORY_LIMIT = 5;
const PREFIX = 'craythrive:ai-explanations:v1:';
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const ownerPrefix = ownerId => `${PREFIX}${encodeURIComponent(ownerId)}:`;
const keyFor = (ownerId, tankId) => validId(ownerId) && validId(tankId) ? `${ownerPrefix(ownerId)}${encodeURIComponent(tankId)}` : null;

export function recommendationFingerprint(context, recommendations) {
  return JSON.stringify({ ownerId: context.tank.user_id, tankId: context.tank.id,
    waterId: context.snapshot.waterRecord?.reading?.id || null,
    ammoniaId: context.snapshot.ammoniaRecord?.reading?.id || null,
    thresholds: context.snapshot.safety.activeThresholds, recommendations });
}

export function createRecommendationHistory(getStorage = () => globalThis.sessionStorage) {
  const memory = new Map(), pending = new Map();
  const storage = () => { try { return getStorage(); } catch { return null; } };
  const read = (ownerId, tankId, nowMs) => {
    const key = keyFor(ownerId, tankId);
    if (!key || !Number.isFinite(nowMs)) return [];
    try {
      const saved = memory.get(key) || JSON.parse(storage()?.getItem(key) || 'null');
      if (saved?.version !== 1 || saved.ownerId !== ownerId || saved.tankId !== tankId || !Array.isArray(saved.entries)) return [];
      const entries = saved.entries.filter(entry => entry && validId(entry.id) && typeof entry.text === 'string' && entry.text.trim()
        && entry.text.length <= 5000 && typeof entry.fingerprint === 'string' && entry.fingerprint.length <= 25000
        && typeof entry.generatedAt === 'string' && /Z$/.test(entry.generatedAt)
        && Number.isFinite(Date.parse(entry.generatedAt)) && Date.parse(entry.generatedAt) <= nowMs
        && nowMs - Date.parse(entry.generatedAt) < AI_HISTORY_RETENTION_MS)
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, AI_HISTORY_LIMIT)
        .map(({ id, text, fingerprint, generatedAt }) => ({ id, text, fingerprint, generatedAt }));
      if (entries.length !== saved.entries.length) {
        try {
          if (!entries.length) { memory.delete(key); storage()?.removeItem(key); }
          else { const cleaned = { ...saved, entries }; memory.set(key, cleaned); storage()?.setItem(key, JSON.stringify(cleaned)); }
        } catch { /* A cleanup/quota failure must not hide valid in-memory entries. */ }
      }
      return entries;
    } catch { return []; }
  };
  const append = (ownerId, tankId, entry) => {
    const key = keyFor(ownerId, tankId), nowMs = Date.parse(entry.generatedAt);
    if (!key || !Number.isFinite(nowMs)) throw new Error('Recommendation time could not be verified. Please retry.');
    const saved = { version: 1, ownerId, tankId, entries: [entry, ...read(ownerId, tankId, nowMs)].slice(0, AI_HISTORY_LIMIT) };
    memory.set(key, saved);
    try { storage()?.setItem(key, JSON.stringify(saved)); } catch { /* In-memory history survives while this app is open. */ }
    return saved.entries;
  };
  const clear = ownerId => {
    if (!validId(ownerId)) return;
    const prefix = ownerPrefix(ownerId);
    for (const key of memory.keys()) if (key.startsWith(prefix)) memory.delete(key);
    for (const [key, request] of pending) if (key.startsWith(prefix)) { request.controller.abort(); pending.delete(key); }
    try {
      const target = storage(), keys = [];
      for (let i = 0; i < (target?.length || 0); i++) { const key = target.key(i); if (key?.startsWith(prefix)) keys.push(key); }
      for (const key of keys) target.removeItem(key);
    } catch { /* Storage can be unavailable in private/limited browser contexts. */ }
  };
  const run = ({ ownerId, tankId, fingerprint, generate, timestamp, verifyOwner }) => {
    const key = keyFor(ownerId, tankId);
    if (!key) return Promise.reject(new Error('Select a verified tank before requesting an explanation.'));
    if (typeof fingerprint !== 'string' || fingerprint.length > 25000) return Promise.reject(new Error('Recommendation context could not be saved. Reload and retry.'));
    if (pending.has(key)) return pending.get(key).promise;
    const controller = new AbortController();
    const request = { controller };
    request.promise = Promise.resolve().then(async () => {
      const deadline = setTimeout(() => controller.abort(), 30000);
      try {
        const work = (async () => {
          if (!await verifyOwner()) throw new Error('Your account could not be verified. Reconnect and retry.');
          const text = await generate(controller.signal);
          const generatedAt = new Date(await timestamp()).toISOString();
          if (!await verifyOwner() || controller.signal.aborted) throw new Error('This recommendation request is no longer active.');
          const entry = { id: crypto.randomUUID(), text: text.trim().slice(0, 5000), generatedAt, fingerprint };
          if (!entry.text) throw new Error('AI Guide returned no explanation. Please retry later.');
          return append(ownerId, tankId, entry);
        })();
        return await Promise.race([work, new Promise((_, reject) => controller.signal.addEventListener('abort',
          () => reject(new Error('AI Guide request ended or timed out. Please retry.')), { once: true }))]);
      } finally {
        clearTimeout(deadline);
        if (pending.get(key) === request) pending.delete(key);
      }
    });
    pending.set(key, request);
    return request.promise;
  };
  return { read, append, clear, run, pending: (ownerId, tankId) => pending.get(keyFor(ownerId, tankId))?.promise || null };
}

export const recommendationHistory = createRecommendationHistory();
