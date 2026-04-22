import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Module-level singleton Supabase service-role client.
 *
 * P0-1 (perf recovery round):
 *   기존에는 `middleware.ts`, `resolveAuthContext.ts`, bootstrap routes,
 *   그리고 모든 `/api/...` 라우트가 요청마다 `createClient(url, key)` 를
 *   새로 호출했다. `@supabase/supabase-js` 의 client 생성 자체는 순수
 *   로컬 연산이지만, 내부 auth/realtime sub-client 초기화 + HTTP keep-
 *   alive 리셋 등이 반복 수행돼 매 요청마다 수 ms 씩 누적됐다.
 *
 *   이 싱글톤은 **같은 function instance (warm invocation) 내에서 모든
 *   호출자가 공유**한다. Next.js (Node runtime) 의 module-level 캐시는
 *   warm 인스턴스 생애 동안 유지되므로, 반복 요청이 모두 동일 instance
 *   를 재사용할 때 client 생성 비용을 0 으로 수렴시킨다. cold start 에서
 *   한 번만 지불하면 그 이후는 공짜.
 *
 *   ⚠ Auth 의미 완전히 동일: service-role key 를 사용하며, 사용자 토큰
 *   검증은 여전히 `supabase.auth.getUser(token)` 로 명시 호출한다.
 *   싱글톤 공유로 어떤 권한 우회도 발생하지 않는다.
 */
let _instance: SupabaseClient | null = null

export function getServiceClient(): SupabaseClient {
  if (_instance) return _instance
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("SERVER_CONFIG_ERROR")
  }
  _instance = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _instance
}
