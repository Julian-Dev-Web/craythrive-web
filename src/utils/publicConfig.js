export const PUBLIC_ENV_NAMES = new Set([
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_APP_SITE_URL",
]);

// Vercel injects these public framework variables during Vite builds.
// Keep an explicit list: VERCEL-prefixed tokens/secrets must not be exempted.
// https://vercel.com/docs/environment-variables/framework-environment-variables
export const VERCEL_PUBLIC_ENV_NAMES = new Set([
  "VITE_VERCEL_ENV",
  "VITE_VERCEL_TARGET_ENV",
  "VITE_VERCEL_URL",
  "VITE_VERCEL_BRANCH_URL",
  "VITE_VERCEL_PROJECT_PRODUCTION_URL",
  "VITE_VERCEL_HASH_SALT",
  "VITE_VERCEL_GIT_PROVIDER",
  "VITE_VERCEL_GIT_REPO_SLUG",
  "VITE_VERCEL_GIT_REPO_OWNER",
  "VITE_VERCEL_GIT_REPO_ID",
  "VITE_VERCEL_GIT_COMMIT_REF",
  "VITE_VERCEL_GIT_COMMIT_SHA",
  "VITE_VERCEL_GIT_COMMIT_MESSAGE",
  "VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN",
  "VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME",
  "VITE_VERCEL_GIT_PULL_REQUEST_ID",
]);

// This checks the key type, not JWT authenticity. Supabase verifies sessions.
export function isPublicSupabaseKey(value) {
  if (typeof value !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  try {
    const parts = value.split(".");
    if (parts.length !== 3) return false;
    const payload = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).role === "anon";
  } catch {
    return false;
  }
}

export function validatePublicEnv(env) {
  for (const name of Object.keys(env)) {
    if (name.startsWith("VITE_") && !PUBLIC_ENV_NAMES.has(name) && !VERCEL_PUBLIC_ENV_NAMES.has(name)) {
      throw new Error(`Unsupported public environment variable: ${name}. Keep private credentials server-side.`);
    }
  }
  for (const name of ["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"]) {
    if (env[name] && !isPublicSupabaseKey(env[name])) {
      throw new Error(`${name} must contain a Supabase publishable or legacy anon key. Private keys are forbidden.`);
    }
  }
  for (const name of ["VITE_SUPABASE_URL", "VITE_APP_SITE_URL"]) {
    if (!env[name]) continue;
    try {
      const url = new URL(env[name]);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
        throw new Error("Invalid public URL");
      }
    } catch {
      throw new Error(`${name} must be an HTTPS URL without credentials, query strings or fragments (HTTP localhost is allowed).`);
    }
  }
}
