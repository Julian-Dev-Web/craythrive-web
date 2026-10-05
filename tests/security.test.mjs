import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validatePublicEnv, isPublicSupabaseKey, PUBLIC_ENV_NAMES } from "../src/utils/publicConfig.js";
import { resolveConfig } from "vite";
import { normalizeExternalUrl } from "../src/utils/safeUrls.js";
import { logDiagnostic, getSafeErrorMessage } from "../src/utils/securityDiagnostics.js";
import { downloadCsv } from "../src/utils/exportPrintUtils.js";

const jwt = role => [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({role})).toString('base64url'), 'test'].join('.');

test("Vercel build metadata is accepted without exempting secrets", () => {
  assert.doesNotThrow(() => validatePublicEnv({VITE_VERCEL_GIT_REPO_ID:'123456'}));
  const metadata = {
    VITE_VERCEL_GIT_REPO_ID: '123456',
    VITE_VERCEL_ENV: 'production',
    VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG: JSON.stringify({analytics:{scriptSrc:'/_vercel/insights/script.js'}}),
    VITE_VERCEL_FUTURE_METADATA: 'unused-build-metadata',
  };
  assert.doesNotThrow(() => validatePublicEnv(metadata));
  for (const name of ['VITE_VERCEL_OIDC_TOKEN', 'VITE_VERCEL_API_KEY', 'VITE_VERCEL_AI_API_KEY', 'VITE_UNKNOWN_CONFIG']) {
    assert.throws(() => validatePublicEnv({...metadata, [name]:'test-only-value'}));
  }
  assert.throws(() => validatePublicEnv({...metadata, VITE_SUPABASE_ANON_KEY:jwt('service_role')}));
  assert.throws(() => validatePublicEnv({VITE_SUPABASE_URL_PRIVATE_TOKEN:'test-only-value'}));
});

test("Vite exposes app configuration but excludes present and future Vercel metadata", async () => {
  const fixture = {
    VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG:'unused-platform-marker',
    VITE_VERCEL_FUTURE_METADATA:'unused-platform-marker',
    VITE_APP_SITE_URL:'https://example.com',
  };
  const previous = Object.fromEntries(Object.keys(fixture).map(name=>[name,process.env[name]]));
  try {
    Object.assign(process.env,fixture);
    const config = await resolveConfig({},'build','production');
    assert.deepEqual(config.envPrefix,[...PUBLIC_ENV_NAMES]);
    assert.equal(config.env.VITE_APP_SITE_URL,fixture.VITE_APP_SITE_URL);
    assert.equal(Object.hasOwn(config.env,'VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG'),false);
    assert.equal(Object.hasOwn(config.env,'VITE_VERCEL_FUTURE_METADATA'),false);
  } finally {
    for (const [name,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("public config rejects service-role and unknown public secret variables", () => {
  assert.equal(isPublicSupabaseKey(jwt('anon')), true);
  assert.equal(isPublicSupabaseKey(jwt('service_role')), false);
  assert.equal(isPublicSupabaseKey('sb_secret_' + 'x'.repeat(30)), false);
  assert.equal(isPublicSupabaseKey('sb_publishable_' + 'x'.repeat(30)), true);
  assert.throws(() => validatePublicEnv({VITE_AI_API_KEY: 'do-not-bundle'}));
  assert.throws(() => validatePublicEnv({VITE_SUPABASE_ANON_KEY: jwt('service_role')}));
  assert.doesNotThrow(() => validatePublicEnv({VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_' + 'x'.repeat(30)}));
});

test("public URLs reject embedded credentials and secret query parameters", () => {
  for (const value of ['https://' + 'user:password' + '@example.com','https://example.com?token=sensitive','javascript:alert(1)']) {
    assert.throws(() => validatePublicEnv({VITE_SUPABASE_URL:value}));
  }
  assert.doesNotThrow(() => validatePublicEnv({VITE_SUPABASE_URL:'http://127.0.0.1:54321'}));
});

test("seller links accept HTTP/HTTPS and reject executable and obfuscated schemes", () => {
  assert.equal(normalizeExternalUrl('example.com/store'), 'https://example.com/store');
  assert.equal(normalizeExternalUrl('https://example.com/store'), 'https://example.com/store');
  for (const value of ['javascript:alert(1)','data:text/html,test','java\nscript:alert(1)','https:\\evil.example','https://' + 'user:secret' + '@example.com']) {
    assert.equal(normalizeExternalUrl(value), null);
  }
});

test("diagnostics and user errors never return provider tokens or internals", () => {
  const error = {code:'42501',status:403,message:'private database detail',access_token:'private session value'};
  const previous = console.warn;
  const output = [];
  try {
    console.warn = (...args) => output.push(args);
    logDiagnostic('Operation failed', error);
  } finally {console.warn = previous;}
  assert.deepEqual(output, [['Operation failed', {code:'42501',status:403}]]);
  assert.equal(JSON.stringify(output).includes(error.access_token), false);
  assert.equal(getSafeErrorMessage({message:'database internals'}, 'Please retry.'), 'Please retry.');
});

test("password recovery does not query private profiles or reveal account existence", () => {
  const source = fs.readFileSync(new URL('../src/pages/auth/ForgotPassword.jsx',import.meta.url),'utf8');
  assert.equal(source.includes('checkRegisteredProfileByEmail'), false);
  assert.equal(source.includes('resetPasswordForEmail'), true);
  assert.equal(source.includes('If an account exists'), true);
});

test("Vercel framing restrictions preserve the existing SPA rewrite", () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.rewrites[0].destination,'/index.html');
  const headers = new Map(config.headers[0].headers.map(({key,value})=>[key,value]));
  assert.equal(headers.get('X-Content-Type-Options'),'nosniff');
  assert.match(headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
});

test("CSV makes untrusted spreadsheet formulas literal while preserving signed numbers", async () => {
  const previousDocument = globalThis.document;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  let savedBlob;
  try {
    globalThis.document = {createElement: () => ({click() {}, remove() {}, style: {}, setAttribute() {}}), body: {appendChild() {}, removeChild() {}}};
    URL.createObjectURL = blob => { savedBlob = blob; return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    downloadCsv('test.csv', [{Title:'=1+1',Reading:-0.6}]);
    const output = await savedBlob.text();
    assert.equal(output.includes("'=1+1"), true);
    assert.equal(output.includes('-0.6'), true);
    assert.equal(output.includes("'-0.6"), false);
  } finally {
    globalThis.document = previousDocument;
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});
