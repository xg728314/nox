import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * Supabase service-role client helper.
 *
 * 2026-04-30 cleanup: 이전엔 동일 함수에 대해 `getAnonSupabaseOrError` alias
 *   를 추가로 export 하고 있었으나 외부 사용처 0건 + knip duplicate exports
 *   경고 → alias 제거. 향후 anon 클라이언트가 진짜 필요하면 별도 함수로
 *   추가하되 anon key 를 명시적으로 사용해야 함.
 *
 * 2026-05-05 R-Speed-x10: createClient(url, key) 직접 호출 → singleton 재사용.
 *   warm 인스턴스에서 client 생성 비용 0 으로 수렴. 모든 session route + 본
 *   helper 호출자가 자동 혜택. SERVER_CONFIG_ERROR 처리는 getServiceClient 가
 *   throw 하므로 try/catch 로 호환.
 */
export function getServerSupabaseOrError() {
  try {
    return { supabase: getServiceClient() }
  } catch {
    return { error: "SERVER_CONFIG_ERROR" as const }
  }
}
