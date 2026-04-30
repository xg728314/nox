/**
 * R-Perf-PrefBundle (2026-04-30): preferences 다중 scope 한 번에 fetch.
 *
 * 운영자 의도:
 *   "카운터 페이지 진입 시 5개 preferences 호출 (각 1.2초+) 으로 답답함."
 *
 * 동작:
 *   - user (user_preferences) 또는 forced (forced_preferences) 에서
 *     주어진 scope 목록을 한 번의 SELECT in() 으로 가져옴.
 *   - Caller (bootstrap route) 가 응답 객체로 변환해 client 에게 전달.
 *   - client preferencesStore.hydrateBundle 이 받아서 ensureLoaded skip.
 *
 * 응답 shape (같은 scope 단일 fetch 와 동일):
 *   { [scope]: { global: T|null, per_store: Record<store_uuid, T> } }
 *
 * 권한:
 *   - user kind: auth.user_id 본인 row 만.
 *   - forced kind: store_uuid scope. caller 가 해당 store 멤버십 가졌을 때만.
 *     bootstrap route 가 이미 auth 검증한 상태에서 호출.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

export type PrefBundleEntry = {
  global: unknown
  per_store: Record<string, unknown>
}

export type PrefBundle = Record<string, PrefBundleEntry>

type PrefRow = {
  store_uuid: string | null
  scope: string
  layout_config: unknown
}

/**
 * Fetch user preferences for multiple scopes in one query.
 * Returns map keyed by scope. Missing scopes get { global:null, per_store:{} }.
 */
export async function getUserPreferencesBundle(
  supabase: SupabaseClient,
  auth: AuthContext,
  scopes: string[],
): Promise<PrefBundle> {
  const out: PrefBundle = {}
  for (const s of scopes) out[s] = { global: null, per_store: {} }
  if (scopes.length === 0) return out

  const { data, error } = await supabase
    .from("user_preferences")
    .select("store_uuid, scope, layout_config")
    .eq("user_id", auth.user_id)
    .in("scope", scopes)
    .is("deleted_at", null)

  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[preferences-bundle] user fetch failed:", error.message)
    return out
  }

  for (const r of (data ?? []) as PrefRow[]) {
    const entry = out[r.scope]
    if (!entry) continue
    if (r.store_uuid == null) entry.global = r.layout_config
    else entry.per_store[r.store_uuid] = r.layout_config
  }
  return out
}

/**
 * Fetch forced (admin-pushed) preferences for multiple scopes in one query.
 * 테이블: admin_preference_overrides.
 *
 * 보안: caller 의 store_uuid 와 일치하는 row + global (store_uuid IS NULL)
 *   만 응답. 다른 매장의 forced override 는 노출 X (단일 scope endpoint 와
 *   동일 정책).
 */
export async function getForcedPreferencesBundle(
  supabase: SupabaseClient,
  auth: AuthContext,
  scopes: string[],
): Promise<PrefBundle> {
  const out: PrefBundle = {}
  for (const s of scopes) out[s] = { global: null, per_store: {} }
  if (scopes.length === 0) return out

  // 테이블 미적용 환경 가능성 → try-catch.
  try {
    const callerStore = auth.store_uuid
    const { data, error } = await supabase
      .from("admin_preference_overrides")
      .select("store_uuid, scope, layout_config")
      .in("scope", scopes)
      .is("deleted_at", null)
      .or(`store_uuid.is.null,store_uuid.eq.${callerStore}`)

    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[preferences-bundle] forced fetch failed:", error.message)
      return out
    }

    for (const r of (data ?? []) as PrefRow[]) {
      const entry = out[r.scope]
      if (!entry) continue
      if (r.store_uuid == null) entry.global = r.layout_config
      else if (r.store_uuid === callerStore) entry.per_store[r.store_uuid] = r.layout_config
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[preferences-bundle] forced exception:", (e as Error).message)
  }
  return out
}
