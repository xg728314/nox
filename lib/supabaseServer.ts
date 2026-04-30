import { createClient } from "@supabase/supabase-js"

/**
 * Supabase service-role client helper.
 *
 * 2026-04-30 cleanup: 이전엔 동일 함수에 대해 `getAnonSupabaseOrError` alias
 *   를 추가로 export 하고 있었으나 외부 사용처 0건 + knip duplicate exports
 *   경고 → alias 제거. 향후 anon 클라이언트가 진짜 필요하면 별도 함수로
 *   추가하되 anon key 를 명시적으로 사용해야 함.
 */
export function getServerSupabaseOrError() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { error: "SERVER_CONFIG_ERROR" as const }
  return { supabase: createClient(url, key) }
}
