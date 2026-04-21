import { createClient } from "@supabase/supabase-js"
export function getServerSupabaseOrError() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { error: "SERVER_CONFIG_ERROR" as const }
  return { supabase: createClient(url, key) }
}
export const getAnonSupabaseOrError = getServerSupabaseOrError
