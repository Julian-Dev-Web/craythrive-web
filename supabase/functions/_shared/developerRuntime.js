import { createClient } from 'npm:@supabase/supabase-js@2.105.4';
import { createSupabaseTokenVerifier } from './developerAuthorization.js';
import { createDeveloperHandler } from './developerHandlers.js';

export function serveDeveloperFunction(purpose) {
  const readSecret = name => Deno.env.get(name);
  Deno.serve(createDeveloperHandler({ purpose, readSecret, verifyToken: createSupabaseTokenVerifier(createClient, readSecret) }));
}
