import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://dncmdvxcxizbcjacpkoe.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Hq66qtAVKFuJOtW8h1vu-w_xJyQqLe7';

export const isSupabaseConfigured = true;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
