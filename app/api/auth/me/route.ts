import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { cached } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: 페이지 진입 / route 변경 시마다 호출 → 매우 빈번.
//   MFA 상태 / store 이름·floor 는 거의 안 바뀜. 30초 TTL 안전.
//   user_id + store_uuid 조합 key — super_admin 매장 전환 시 즉시 다른 cache.
const ME_TTL_MS = 30_000

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    type Extras = {
      mfa_enabled: boolean
      backup_codes_remaining: number
      store_name: string | null
      store_floor: number | null
      // 2026-05-08: 매장별 라벨 customization. 빈 객체면 빌드 모드 default.
      display_labels: Record<string, string>
      // R-mobile (2026-06-01): 스태프동기화 모바일 앱이 헤더에 표시할 이름.
      //   profiles.full_name. 없으면 null.
      full_name: string | null
    }

    // R26: mfa_enabled + backup_codes_remaining 노출 (additive). /me/security
    //   페이지가 현재 상태를 알아야 적절한 UI 분기. 둘 다 booleans/숫자라
    //   민감한 secret 노출 위험 없음.
    const extras = await cached<Extras>(
      "auth_me_extras",
      `${authContext.user_id}:${authContext.store_uuid}`,
      ME_TTL_MS,
      async () => {
        let mfaEnabled = false
        let backupCodesRemaining = 0
        let storeName: string | null = null
        let storeFloor: number | null = null
        let displayLabels: Record<string, string> = {}
        let fullName: string | null = null
        try {
          const url = process.env.NEXT_PUBLIC_SUPABASE_URL
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY
          if (url && key) {
            const sb = createClient(url, key)
            // 2026-05-08: store_settings.display_labels 도 동시 fetch.
            //   migration 110 미적용 시 42703 → 빈 객체로 fallback.
            // R-mobile (2026-06-01): profiles.full_name 도 함께 fetch.
            const [mfaRes, storeRes, settingsRes, profileRes] = await Promise.all([
              sb
                .from("user_mfa_settings")
                .select("is_enabled, backup_codes_hashed")
                .eq("user_id", authContext.user_id)
                .is("deleted_at", null)
                .maybeSingle(),
              // 2026-05-02 R-Cafe: floor 도 함께 노출 (카페 owner UI 분기용).
              sb
                .from("stores")
                .select("store_name, floor")
                .eq("id", authContext.store_uuid)
                .maybeSingle(),
              sb
                .from("store_settings")
                .select("display_labels")
                .eq("store_uuid", authContext.store_uuid)
                .is("deleted_at", null)
                .maybeSingle(),
              sb
                .from("profiles")
                .select("full_name")
                .eq("id", authContext.user_id)
                .maybeSingle(),
            ])
            const r = mfaRes.data as
              | { is_enabled?: boolean; backup_codes_hashed?: string[] }
              | null
            mfaEnabled = !!r?.is_enabled
            backupCodesRemaining = Array.isArray(r?.backup_codes_hashed)
              ? r!.backup_codes_hashed!.length
              : 0
            const s = storeRes.data as
              | { store_name?: string; floor?: number }
              | null
            storeName = s?.store_name ?? null
            storeFloor = typeof s?.floor === "number" ? s.floor : null
            // settings.display_labels 가 객체면 채택. 42703 (migration 미적용)
            //   이거나 NULL 이면 빈 객체 (빌드 모드 default 사용).
            const ds = settingsRes.data as { display_labels?: unknown } | null
            if (ds?.display_labels && typeof ds.display_labels === "object" && !Array.isArray(ds.display_labels)) {
              displayLabels = ds.display_labels as Record<string, string>
            }
            const p = profileRes.data as { full_name?: string | null } | null
            fullName = (p?.full_name ?? null) || null
          }
        } catch {
          // best-effort — me 응답은 MFA / store 조회 실패해도 정상 동작.
        }
        return {
          mfa_enabled: mfaEnabled,
          backup_codes_remaining: backupCodesRemaining,
          store_name: storeName,
          store_floor: storeFloor,
          display_labels: displayLabels,
          full_name: fullName,
        }
      },
    )

    const res = NextResponse.json({
      user_id: authContext.user_id,
      membership_id: authContext.membership_id,
      store_uuid: authContext.store_uuid,
      store_name: extras.store_name,
      store_floor: extras.store_floor,
      role: authContext.role,
      membership_status: authContext.membership_status,
      is_super_admin: authContext.is_super_admin,
      mfa_enabled: extras.mfa_enabled,
      backup_codes_remaining: extras.backup_codes_remaining,
      // 2026-05-08: 매장별 라벨. 클라이언트의 LabelsProvider 가 hydrate.
      display_labels: extras.display_labels,
      // R-mobile (2026-06-01): 스태프동기화 모바일 앱이 헤더에 표시.
      full_name: extras.full_name,
    })
    // 짧은 max-age + 긴 SWR — 페이지 전환마다 호출되어도 즉시 반환.
    res.headers.set("Cache-Control", "private, max-age=10, stale-while-revalidate=60")
    return res
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
