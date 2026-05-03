import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"
import { lookupServiceType, lookupCategoryPricing } from "@/lib/session/services/pricingLookup"

/**
 * POST /api/sessions/participants/batch
 *
 * 2026-05-03 R-Speed-x10: 스태프 N명 한 번에 추가 endpoint.
 *
 * 운영자 호소: "스태프 추가 너무 느림 — 11명 추가에 6.8초."
 * 원인: 클라이언트가 11개 POST 를 Promise.all 로 fire 해도 Cloud Run
 *   단일 instance + cpu=1 이라 서버가 부분 직렬화. 각 ~620ms × 11 = 6.8초.
 *
 * 본 endpoint:
 *   - 1번의 POST 로 N개 entries 받음 (body.entries[]).
 *   - 서버 안에서 검증 1회 (session, business_day, store 매핑) + 가격 lookup 캐시.
 *   - INSERT 는 supabase.from(...).insert([rows]) 로 한 번에.
 *   - 응답 N개 participant rows.
 *   - audit, cache invalidate 모두 background.
 *
 * 호환:
 *   - 기존 단일 POST /api/sessions/participants 도 그대로 동작.
 *   - staff chat 입력 (다수) 만 batch 사용.
 *
 * 보안:
 *   - 모든 entry 가 동일 session_id 에 속해야 함 (auth.store_uuid scope).
 *   - 11명 entry 면 11번의 권한 체크 vs 1번 — 빠르고 더 안전 (ID 단일 검증).
 */

const VALID_ROLES = ["manager", "hostess"] as const
const VALID_CATEGORIES = ["퍼블릭", "셔츠", "하퍼", "차3"] as const
type ParticipantRole = typeof VALID_ROLES[number]
type ParticipantCategory = typeof VALID_CATEGORIES[number]

type BatchEntry = {
  membership_id?: string | null
  role?: string
  category?: string
  time_minutes?: number
  time_type?: string
  manager_deduction?: number
  greeting_confirmed?: boolean
  external_name?: string
  origin_store_uuid?: string | null
  origin_store_name?: string
}

type BatchResponseEntry =
  | { ok: true; participant_id: string; index: number; origin_store_uuid: string | null }
  | { ok: false; index: number; error: string }

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted." },
        { status: 403 },
      )
    }

    const parsed = await parseJsonBody<{
      session_id?: string
      entries?: BatchEntry[]
    }>(request)
    if (parsed.error) return parsed.error
    const { session_id, entries } = parsed.body

    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required UUID." },
        { status: 400 },
      )
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "entries array required." },
        { status: 400 },
      )
    }
    if (entries.length > 50) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Max 50 entries per batch." },
        { status: 400 },
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // ── 1. session + business_day + 모든 entries 의 origin_store_name 매핑을 1 wave 로 ──
    //   N명 entry 의 origin store name 을 unique 하게 모아서 IN-clause 1회로 조회.
    const distinctOriginNames = Array.from(
      new Set(
        (entries
          .map((e) => (typeof e.origin_store_name === "string" ? e.origin_store_name.trim() : ""))
          .filter((s) => s.length > 0)),
      ),
    )

    const [sessionRes, originStoresRes, recentBizDaysRes] = await Promise.all([
      supabase
        .from("room_sessions")
        .select("id, store_uuid, status, business_day_id")
        .eq("id", session_id)
        .maybeSingle(),
      distinctOriginNames.length > 0
        ? supabase
            .from("stores")
            .select("id, store_name")
            .in("store_name", distinctOriginNames)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] as Array<{ id: string; store_name: string }> }),
      supabase
        .from("store_operating_days")
        .select("id, status")
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
        .order("business_date", { ascending: false })
        .limit(2),
    ])

    const { data: session, error: sessionError } = sessionRes
    if (sessionError || !session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND", message: "Session not found." }, { status: 404 })
    }
    if (session.status !== "active") {
      return NextResponse.json({ error: "SESSION_NOT_ACTIVE", message: "Session is not active." }, { status: 400 })
    }
    if (session.store_uuid !== authContext.store_uuid) {
      return NextResponse.json({ error: "STORE_MISMATCH", message: "Session does not belong to your store." }, { status: 403 })
    }

    // business_day 검증 — Promise.all prefetch 매칭, fallback 추가 RTT.
    {
      const cached = (recentBizDaysRes.data ?? []) as Array<{ id: string; status: string }>
      const matched = cached.find((d) => d.id === session.business_day_id)
      if (matched) {
        if (matched.status === "closed") {
          return NextResponse.json(
            { error: "BUSINESS_DAY_CLOSED", message: "영업일이 마감되었습니다." },
            { status: 403 },
          )
        }
      } else {
        const guard = await assertBusinessDayOpen(supabase, session.business_day_id)
        if (guard) return guard
      }
    }

    // origin store name → uuid 맵 (대소문자/공백 미세 차이는 trim 했음).
    const originNameToUuid = new Map<string, string>()
    for (const r of (originStoresRes.data ?? []) as Array<{ id: string; store_name: string }>) {
      originNameToUuid.set(r.store_name.trim(), r.id)
    }

    // ── 2. entries 전부 검증 + INSERT row 빌드 ──
    //   pricing lookup 은 같은 store_uuid + category + time_type 이면 캐시.
    const PLACEHOLDER_MEMBERSHIP_ID = "00000000-0000-0000-0000-000000000000"
    const insertRows: Record<string, unknown>[] = []
    const responses: BatchResponseEntry[] = []

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const role = e.role
      const category = e.category
      const timeMinutes = e.time_minutes
      const externalNameRaw = e.external_name

      const isPlaceholder =
        e.membership_id === null ||
        e.membership_id === undefined ||
        e.membership_id === PLACEHOLDER_MEMBERSHIP_ID

      if (!role || !(VALID_ROLES as readonly string[]).includes(role)) {
        responses.push({ ok: false, index: i, error: `[${i}] role must be 'manager'|'hostess'` })
        continue
      }
      if (!isPlaceholder && (!isValidUUID(e.membership_id!))) {
        responses.push({ ok: false, index: i, error: `[${i}] membership_id must be UUID` })
        continue
      }
      if (!isPlaceholder && (!category || !(VALID_CATEGORIES as readonly string[]).includes(category))) {
        responses.push({ ok: false, index: i, error: `[${i}] category required` })
        continue
      }
      if (timeMinutes === undefined || timeMinutes === null || typeof timeMinutes !== "number") {
        responses.push({ ok: false, index: i, error: `[${i}] time_minutes required` })
        continue
      }

      // time_type resolution
      let resolvedTimeType = e.time_type || ""
      if (!resolvedTimeType) {
        if (timeMinutes <= 8) {
          resolvedTimeType = "무료"
        } else if (timeMinutes <= 15) {
          resolvedTimeType = "차3"
        } else {
          const halfTime = category === "퍼블릭" ? 45 : 30
          const boundaryEnd = halfTime + 10
          if (timeMinutes <= halfTime) {
            resolvedTimeType = "반티"
          } else if (timeMinutes <= boundaryEnd) {
            responses.push({ ok: false, index: i, error: `[${i}] BOUNDARY_TIME (${halfTime}~${boundaryEnd}분)` })
            continue
          } else {
            resolvedTimeType = "기본"
          }
        }
      }

      // pricing
      let priceAmount = 0
      let resolvedManagerDeduction = e.manager_deduction ?? 0
      let cha3Amount = 0
      let bantiAmount = 0

      if (resolvedTimeType !== "무료") {
        try {
          const serviceType = await lookupServiceType(
            supabase,
            authContext.store_uuid,
            category as string,
            resolvedTimeType,
          )
          if (!serviceType) {
            responses.push({ ok: false, index: i, error: `[${i}] SERVICE_TYPE_NOT_FOUND ${category}/${resolvedTimeType}` })
            continue
          }
          if (serviceType.has_greeting_check && !e.greeting_confirmed) {
            responses.push({ ok: false, index: i, error: `[${i}] GREETING_REQUIRED` })
            continue
          }
          priceAmount = serviceType.price
          if (e.manager_deduction === undefined || e.manager_deduction === null) {
            resolvedManagerDeduction = serviceType.manager_deduction
          }
          const pricing = await lookupCategoryPricing(
            supabase,
            authContext.store_uuid,
            category as string,
            resolvedTimeType,
          )
          cha3Amount = pricing.cha3Amount
          bantiAmount = pricing.bantiAmount
        } catch (err) {
          responses.push({
            ok: false,
            index: i,
            error: `[${i}] pricing failed: ${err instanceof Error ? err.message : "unknown"}`,
          })
          continue
        }
      }
      const hostessPayout = Math.max(0, priceAmount - resolvedManagerDeduction)

      // origin store resolve
      let resolvedOriginStoreUuid: string | null = null
      if (e.origin_store_uuid !== undefined && e.origin_store_uuid !== null) {
        resolvedOriginStoreUuid = e.origin_store_uuid
      } else if (typeof e.origin_store_name === "string" && e.origin_store_name.trim().length > 0) {
        const id = originNameToUuid.get(e.origin_store_name.trim())
        resolvedOriginStoreUuid = id ?? null
      }
      if (resolvedOriginStoreUuid === authContext.store_uuid) {
        resolvedOriginStoreUuid = null
      }

      const externalName =
        typeof externalNameRaw === "string" && externalNameRaw.trim().length > 0
          ? externalNameRaw.trim()
          : null
      const memoValue = isPlaceholder ? (externalName ?? "미지정") : null

      insertRows.push({
        session_id,
        membership_id: isPlaceholder ? null : e.membership_id,
        memo: memoValue,
        external_name: externalName,
        name_edited_at: externalName ? new Date().toISOString() : null,
        role: role as ParticipantRole,
        category: (isPlaceholder && !category) ? null : (category as ParticipantCategory),
        time_minutes: timeMinutes,
        price_amount: priceAmount,
        manager_payout_amount: resolvedManagerDeduction,
        hostess_payout_amount: hostessPayout,
        margin_amount: 0,
        cha3_amount: cha3Amount,
        banti_amount: bantiAmount,
        waiter_tip_received: false,
        waiter_tip_amount: 0,
        greeting_confirmed: e.greeting_confirmed ?? false,
        origin_store_uuid: resolvedOriginStoreUuid,
        transfer_request_id: null,
        status: "active",
        store_uuid: authContext.store_uuid,
        // batch entry index 추적용 — INSERT returning 후 매칭에 사용.
        external_name_idx: i,
      })

      responses.push({
        ok: true,
        participant_id: "", // 아래 INSERT 후 채움
        index: i,
        origin_store_uuid: resolvedOriginStoreUuid,
      })
    }

    if (insertRows.length === 0) {
      return NextResponse.json(
        { results: responses, ok_count: 0, fail_count: responses.length },
        { status: 200 },
      )
    }

    // ── 3. 단일 INSERT (1 RTT) ──
    //   external_name_idx 는 INSERT 후 응답 매칭용 임시 필드 — DB 컬럼 없으면 무시.
    //   안전하게 그냥 빼고 INSERT 하고, returning 으로 받은 row 의 순서를 신뢰.
    const cleanedRows = insertRows.map((r) => {
      const c = { ...r }
      delete c.external_name_idx
      return c
    })

    const { data: inserted, error: insertError } = await supabase
      .from("session_participants")
      .insert(cleanedRows)
      .select("id, session_id, role, category, time_minutes, price_amount, status, entered_at, external_name, origin_store_uuid")

    if (insertError || !inserted) {
      return NextResponse.json(
        {
          error: "BATCH_INSERT_FAILED",
          message: insertError?.message ?? "Failed to insert participants.",
          results: responses.map((r) => ("ok" in r && r.ok ? { ok: false, index: r.index, error: "batch failed" } : r)),
        },
        { status: 500 },
      )
    }

    // 응답 매칭 — INSERT returning 순서가 input 순서와 동일 (Supabase/PG 기본 동작).
    const okIndexes = responses
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => "ok" in r && r.ok)
      .map(({ idx }) => idx)
    for (let k = 0; k < inserted.length && k < okIndexes.length; k++) {
      const target = responses[okIndexes[k]] as BatchResponseEntry & { ok: true }
      target.participant_id = (inserted[k] as { id: string }).id
    }

    // ── 4. audit + cache invalidate background fire ──
    void Promise.all(
      inserted.map((row) =>
        writeSessionAudit(supabase, {
          auth: authContext,
          session_id,
          entity_table: "session_participants",
          entity_id: (row as { id: string }).id,
          action: "participant_registered",
          after: {
            role: (row as { role: string }).role,
            category: (row as { category: string }).category,
            time_minutes: (row as { time_minutes: number }).time_minutes,
            price_amount: (row as { price_amount: number }).price_amount,
            batch: true,
          },
        }),
      ),
    ).catch((e) => {
      console.warn("[participants/batch] audit failed:", e instanceof Error ? e.message : e)
    })
    invalidateCache("monitor")
    invalidateCache("rooms")

    const okCount = responses.filter((r) => "ok" in r && r.ok).length
    const failCount = responses.length - okCount

    return NextResponse.json(
      {
        results: responses,
        inserted: inserted.length,
        ok_count: okCount,
        fail_count: failCount,
      },
      { status: 201 },
    )
  } catch (error) {
    return handleRouteError(error, "participants/batch")
  }
}
