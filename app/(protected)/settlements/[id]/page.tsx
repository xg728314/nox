import { headers } from "next/headers"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * /settlements/[id] — 헤더 한 건 + 라인 아이템 전체 (읽기 전용).
 *
 * Phase 4 편입 아이템은 다음 컬럼이 1:1 로 채워져 있다:
 *   staff_work_log_id / hostess_membership_id / manager_membership_id
 *   / category / work_type / amount
 * Legacy (manager 집계) 라인은 위 컬럼이 NULL 인 경우가 있으므로
 * 화면에서 "-" 로 표시한다.
 *
 * ROUND-C canonical 규약:
 *   from_store_uuid = payer  (working_store — 손님이 돈 낸 곳)
 *   to_store_uuid   = receiver (origin_store — hostess 소속)
 * 화면 표시도 이 의미로 통일.
 */
export default async function SettlementDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // ── Auth ───────────────────────────────────────────────────
  const h = await headers()
  const cookie = h.get("cookie") ?? ""
  const syntheticReq = new Request(`http://internal/settlements/${id}`, {
    headers: { cookie },
  })
  let auth
  try {
    auth = await resolveAuthContext(syntheticReq)
  } catch (e) {
    if (e instanceof AuthError) redirect("/login")
    throw e
  }
  if (auth.role !== "owner" && !auth.is_super_admin) {
    redirect("/")
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) notFound()

  // ── Header ─────────────────────────────────────────────────
  // ROUND-C: 내 매장이 from 또는 to 이면 조회 허용. super_admin 은 scope 무시.
  const supabase = getServiceClient()
  let headerQuery = supabase
    .from("cross_store_settlements")
    .select(
      "id, from_store_uuid, to_store_uuid, total_amount, prepaid_amount, remaining_amount, status, memo, created_at, updated_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
  if (!auth.is_super_admin) {
    headerQuery = headerQuery.or(
      `from_store_uuid.eq.${auth.store_uuid},to_store_uuid.eq.${auth.store_uuid}`,
    )
  }
  const { data: headerRow } = await headerQuery.maybeSingle()

  if (!headerRow) notFound()

  type HeaderRow = {
    id: string
    from_store_uuid: string
    to_store_uuid: string
    total_amount: number | string | null
    prepaid_amount: number | string | null
    remaining_amount: number | string | null
    status: string
    memo: string | null
    created_at: string
    updated_at: string | null
  }
  const header = headerRow as HeaderRow

  // ── Items ──────────────────────────────────────────────────
  // ROUND-C: items scope 는 parent header 로부터 이미 attested.
  //   header가 auth.store_uuid 를 from 또는 to 에 포함함이 위에서 검증됨.
  //   items.store_uuid 는 **payer (from)** 고정이라, 내가 receiver(to) 일 때는
  //   일치하지 않음. 따라서 store_uuid 조건은 제거하고 cross_store_settlement_id
  //   스코프로만 필터 (header 가 이미 내 매장 소속 입증).
  const { data: itemsRaw } = await supabase
    .from("cross_store_settlement_items")
    .select(
      "id, staff_work_log_id, hostess_membership_id, manager_membership_id, category, work_type, amount, paid_amount, remaining_amount, status, created_at",
    )
    .eq("cross_store_settlement_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })

  type ItemRow = {
    id: string
    staff_work_log_id: string | null
    hostess_membership_id: string | null
    manager_membership_id: string | null
    category: string | null
    work_type: string | null
    amount: number | string | null
    paid_amount: number | string | null
    remaining_amount: number | string | null
    status: string
    created_at: string
  }
  const items = (itemsRaw ?? []) as ItemRow[]

  // ── Enrichment: store / hostess / manager names ───────────
  const storeIds = Array.from(new Set([header.from_store_uuid, header.to_store_uuid]))
  const hostessIds = Array.from(
    new Set(items.map((i) => i.hostess_membership_id).filter((v): v is string => !!v)),
  )
  const managerIds = Array.from(
    new Set(items.map((i) => i.manager_membership_id).filter((v): v is string => !!v)),
  )

  const storeNameMap = new Map<string, string>()
  if (storeIds.length > 0) {
    const { data: sts } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", storeIds)
    for (const s of (sts ?? []) as { id: string; store_name: string }[]) {
      storeNameMap.set(s.id, s.store_name)
    }
  }
  const hostessNameMap = new Map<string, string>()
  if (hostessIds.length > 0) {
    const { data: hs } = await supabase
      .from("hostesses")
      .select("membership_id, name, stage_name")
      .in("membership_id", hostessIds)
    for (const h of (hs ?? []) as {
      membership_id: string
      name: string | null
      stage_name: string | null
    }[]) {
      hostessNameMap.set(h.membership_id, h.stage_name || h.name || "")
    }
  }
  const managerNameMap = new Map<string, string>()
  if (managerIds.length > 0) {
    const { data: ms } = await supabase
      .from("managers")
      .select("membership_id, name")
      .in("membership_id", managerIds)
    for (const m of (ms ?? []) as { membership_id: string; name: string | null }[]) {
      managerNameMap.set(m.membership_id, m.name ?? "")
    }
  }

  // ── Sanity: items.amount 합 vs header.total_amount ────────
  const itemsSum = items.reduce((s, i) => s + Number(i.amount ?? 0), 0)
  const headerTotal = Number(header.total_amount ?? 0)
  const sumMatches = Math.abs(itemsSum - headerTotal) < 0.5

  const fmtKrw = (v: number | string | null) => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) ? n.toLocaleString("ko-KR") + "원" : "-"
  }
  const fmtDate = (iso: string | null) => {
    if (!iso) return "-"
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString("ko-KR", {
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit",
        })
  }
  const shortId = (id: string | null) => (id ? id.slice(0, 8) : "-")

  const CATEGORY_LABEL: Record<string, string> = {
    public: "퍼블릭",
    shirt: "셔츠",
    hyper: "하퍼",
    etc: "기타",
  }
  const WORK_TYPE_LABEL: Record<string, string> = {
    full: "기본",
    half: "반티",
    cha3: "차3",
    half_cha3: "반티+차3",
  }

  // ROUND-C canonical: from=payer=working_store, to=receiver=origin_store.
  const workingStoreUuid = header.from_store_uuid
  const originStoreUuid = header.to_store_uuid

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Breadcrumb */}
        <div className="mb-4 text-xs text-slate-500">
          <Link href="/settlements" className="hover:text-slate-300">
            ← 정산 목록
          </Link>
        </div>

        {/* Header card */}
        <div className="mb-6 rounded-lg border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold">정산 상세</h1>
              <div className="mt-1 text-xs text-slate-500 font-mono">{header.id}</div>
            </div>
            <span
              className={
                header.status === "open"
                  ? "rounded bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400"
                  : header.status === "partial"
                  ? "rounded bg-amber-500/10 px-3 py-1 text-xs text-amber-400"
                  : header.status === "completed"
                  ? "rounded bg-sky-500/10 px-3 py-1 text-xs text-sky-400"
                  : "rounded bg-slate-500/10 px-3 py-1 text-xs text-slate-400"
              }
            >
              {header.status}
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">지급 매장 (from / working)</dt>
              <dd className="mt-0.5 font-medium text-slate-100">
                {storeNameMap.get(header.from_store_uuid) ?? shortId(header.from_store_uuid)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">수령 매장 (to / origin)</dt>
              <dd className="mt-0.5 font-medium text-slate-100">
                {storeNameMap.get(header.to_store_uuid) ?? shortId(header.to_store_uuid)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">총액</dt>
              <dd className="mt-0.5 font-mono text-slate-100">
                {fmtKrw(header.total_amount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">잔액</dt>
              <dd className="mt-0.5 font-mono text-slate-100">
                {fmtKrw(header.remaining_amount)}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-slate-500">메모</dt>
              <dd className="mt-0.5 text-slate-200">{header.memo ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">생성일시</dt>
              <dd className="mt-0.5 text-slate-200">{fmtDate(header.created_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">수정일시</dt>
              <dd className="mt-0.5 text-slate-200">{fmtDate(header.updated_at)}</dd>
            </div>
          </dl>

          {/* Sum check banner */}
          <div
            className={
              "mt-5 rounded px-3 py-2 text-xs " +
              (sumMatches
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-red-500/10 text-red-300")
            }
          >
            Σ items.amount = <span className="font-mono">{fmtKrw(itemsSum)}</span> ·
            header.total_amount = <span className="font-mono">{fmtKrw(header.total_amount)}</span>
            {sumMatches ? " · 합계 일치 ✓" : " · 합계 불일치 ✗ (운영자 확인 필요)"}
          </div>
        </div>

        {/* Items */}
        <h2 className="mb-3 text-sm font-semibold text-slate-300">
          라인 아이템 <span className="text-slate-500 font-normal">({items.length} 건)</span>
        </h2>
        {items.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-400">
            아이템이 없습니다.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">아가씨</th>
                  <th className="px-3 py-2 text-left font-medium">실장</th>
                  <th className="px-3 py-2 text-left font-medium">원소속 (origin)</th>
                  <th className="px-3 py-2 text-left font-medium">근무매장 (working)</th>
                  <th className="px-3 py-2 text-left font-medium">종목</th>
                  <th className="px-3 py-2 text-left font-medium">근무형태</th>
                  <th className="px-3 py-2 text-right font-medium">금액</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">로그</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950">
                {items.map((it) => {
                  const hostessName =
                    it.hostess_membership_id
                      ? hostessNameMap.get(it.hostess_membership_id) || shortId(it.hostess_membership_id)
                      : "-"
                  const managerName =
                    it.manager_membership_id
                      ? managerNameMap.get(it.manager_membership_id) || shortId(it.manager_membership_id)
                      : "-"
                  return (
                    <tr key={it.id} className="hover:bg-slate-900/40">
                      <td className="px-3 py-2">
                        <div className="text-slate-100">{hostessName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {shortId(it.hostess_membership_id)}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-slate-100">{managerName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {shortId(it.manager_membership_id)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {storeNameMap.get(originStoreUuid) ?? shortId(originStoreUuid)}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {storeNameMap.get(workingStoreUuid) ?? shortId(workingStoreUuid)}
                      </td>
                      <td className="px-3 py-2 text-slate-200">
                        {it.category ? (CATEGORY_LABEL[it.category] ?? it.category) : "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-200">
                        {it.work_type ? (WORK_TYPE_LABEL[it.work_type] ?? it.work_type) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-100">
                        {fmtKrw(it.amount)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-slate-500/10 px-2 py-0.5 text-xs text-slate-300">
                          {it.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-500 font-mono">
                        {shortId(it.staff_work_log_id)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-900/60">
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-right text-xs text-slate-400">
                    합계
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-100">
                    {fmtKrw(itemsSum)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
