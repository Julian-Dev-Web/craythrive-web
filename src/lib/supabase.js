import { createClient } from "@supabase/supabase-js";
import { validatePublicEnv } from "../utils/publicConfig";

validatePublicEnv(import.meta.env);

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabasePublicKey
);

export const supabase = isSupabaseConfigured ? createClient(
  supabaseUrl,
  supabasePublicKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
) : null;
