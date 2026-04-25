import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * NOX Supabase client factories (browser-safe).
 *
 * ── 현재 상태 (이 라운드 조사 결과) ─────────────────────────────────
 *   anon key 로 `createClient` 직접 호출:
 *     - app/counter/hooks/useRooms.ts:221                  (browser, realtime)
 *     - app/reset-password/confirm/page.tsx:70             (browser, auth session)
 *     - app/api/auth/login/route.ts:69                     (server, password)
 *     - app/api/auth/login/mfa/route.ts:109                (server, password)
 *     - app/api/auth/login/otp/verify/route.ts:100         (server, OTP verify)
 *     - app/api/auth/reset-password/route.ts:161           (server, password flow)
 *     - app/api/owner/accounts/[membership_id]/reset-password/route.ts (anon key 읽기만,
 *                                                          실제 client 는 admin 만 생성)
 *
 *   realtime 사용 (postgres_changes):
 *     - app/counter/hooks/useRooms.ts 만. anon key + 구독 3 테이블
 *       (room_sessions, session_participants, orders — 모두 RLS 미활성).
 *
 *   service_role 직접 createClient (30+ 파일, 스코프 외):
 *     - lib/session/createServiceClient.ts 또는 inline. 서버 route 전용.
 *       본 파일의 래퍼는 anon / authed 에 한정.
 *
 * ── 본 라운드에서 도입한 래퍼 (caller 미변경) ───────────────────────
 *   1) createAnonClient(options?)            — env 누락 검증 + 기본 autoRefresh/persist off
 *   2) createAuthedClient(accessToken)        — JWT 주입. realtime 을 authed 로 전환할 때 사용.
 *
 *   현재는 **도입만** 한다. 기존 `supabase` singleton 및 7개 호출부는
 *   그대로 둠 — 한 번에 교체 시 로그인/OTP/reset 플로우 regression 위험.
 *   다음 라운드에서 caller 단위로 옮겨간다.
 *
 * ── 수렴 로드맵 (다음 라운드) ────────────────────────────────────────
 *   Phase A  (저위험): app/counter/hooks/useRooms.ts realtime 을 authed 로 전환.
 *                     JWT 가 없으면 anon fallback (현 동작 유지).
 *   Phase B  (중위험): reset-password 플로우를 createAnonClient 로 수렴.
 *   Phase C  (고위험): login/OTP/MFA — 회귀 테스트 스크립트 확보 후.
 *   Phase D  (cleanup): `supabase` 기본 singleton export 제거.
 *
 * ── env 검증 원칙 ─────────────────────────────────────────────────
 *   팩토리는 URL/KEY 누락 시 **throw**. 기존 singleton 은 호환을 위해
 *   빈 문자열로 fallback 유지 (레거시). 새 호출부는 반드시 factory 사용.
 */

type ClientFactoryOptions = {
  /** default: false — server route / password flow 에서 세션 유지 안 함. */
  autoRefreshToken?: boolean
  /** default: false — 브라우저에서 cookie 로만 세션 유지. */
  persistSession?: boolean
}

function readAnonEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      "[supabaseClient] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    )
  }
  return { url, key }
}

/**
 * Anonymous Supabase client. RLS 정책이 켜진 테이블은 JWT 주입 없이
 * 0 rows 로 degrade 될 수 있으니 authed 경로가 필요하면 createAuthedClient 사용.
 *
 * @throws env 누락 시.
 */
export function createAnonClient(options?: ClientFactoryOptions): SupabaseClient {
  const { url, key } = readAnonEnv()
  return createClient(url, key, {
    auth: {
      autoRefreshToken: options?.autoRefreshToken ?? false,
      persistSession: options?.persistSession ?? false,
    },
  })
}

/**
 * Authenticated Supabase client — JWT 를 Authorization 헤더로 주입.
 *
 * 용도:
 *   1) realtime 을 authenticated 로 전환 (068/069/070 JWT RLS 정책 통과).
 *   2) 사용자 세션 컨텍스트로 PostgREST 쿼리 — RLS 정책이 app_metadata.store_uuid
 *      을 읽어 same-store 스코프를 자동 적용.
 *
 * 주의:
 *   - 넘기는 accessToken 은 정상 발급된 Supabase JWT 여야 함. 만료된 토큰을
 *     그대로 쓰면 PostgREST 가 401 반환. 세션 갱신은 호출측 책임.
 *   - apikey 는 여전히 anon key (Supabase 의 Gateway 요구). Authorization
 *     만 Bearer <JWT> 로 덮어씀.
 *
 * @throws env 누락 시. accessToken 빈 문자열도 throw.
 */
export function createAuthedClient(
  accessToken: string,
  options?: ClientFactoryOptions,
): SupabaseClient {
  if (!accessToken) {
    throw new Error("[supabaseClient] createAuthedClient requires a non-empty accessToken")
  }
  const { url, key } = readAnonEnv()
  return createClient(url, key, {
    auth: {
      autoRefreshToken: options?.autoRefreshToken ?? false,
      persistSession: options?.persistSession ?? false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })
}

/**
 * Legacy singleton anon client — **lazy** evaluated.
 *
 * ⚠️ 신규 코드에서 쓰지 말 것. caller 가 env 누락을 감지 못하며, realtime
 *    사용 시 RLS 정책 통과 보장 없음. createAnonClient() 또는
 *    createAuthedClient(token) 사용.
 *
 * 보존 이유: `_ble_wip/` (deprecated) 외 참조 0건. 호환 위해 export 유지.
 *
 * Lazy 평가 이유:
 *   본 모듈을 import 만 해도 즉시 `createClient` 가 호출되면, build 시 SSG
 *   prerender 단계에서 env 가 비어있는 경우 supabase-js 가 throw 하며 빌드
 *   실패. (realtime 전환 라운드에서 /counter 가 이 모듈을 import 하게 되어
 *   재현됨.) 접근 시점까지 초기화를 미뤄 import-time 부작용을 제거.
 */
let _supabase: SupabaseClient | null = null
function getLegacySupabase(): SupabaseClient {
  if (_supabase) return _supabase
  _supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  )
  return _supabase
}
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const client = getLegacySupabase() as unknown as Record<string | symbol, unknown>
    return client[prop]
  },
})
