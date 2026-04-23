import { headers } from "next/headers"
import { redirect } from "next/navigation"
import Link from "next/link"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * /settlements/summary — 운영 검산용 집계 화면 (읽기 전용).
 *
 * 표시:
 *   1) 상단 카드: 전체 지급 합계 / 전체 수령 합계 / 전체 item 수
 *   2) from 기준 매장별 총 지급 합계
 *   3) to 기준 매장별 총 수령 합계
 *   4) manager 기준 총 금액 / 총 건수
 *
 * 범위:
 *   - owner:       from=auth.store OR to=auth.store 인 헤더만 집계.
 *   - super_admin: 모든 헤더 집계 (store 필터 있으면 그에 한정).
 *
 * "settled 기준": Phase 4 aggregate 로 편입된 모든 아이템은 header+item
 *   이 DB 에 존재하는 순간 이미 staff_work_logs.status='settled' 로 전이된
 *   후이다 (aggregate route 의 Step 6). 따라서 `deleted_at IS NULL` 인
 *   모든 item = settled 상태의 금액 원장. 별도 status 필터는 hedge 로만
 *   유지 (header.deleted_at IS NULL 사용).
 *
 * 금지 (본 페이지는 100% 조회):
 *   - 원장/상태/재정산 mutation 없음
 *   - 금액 재계산 없음 (DB 값 그대로 합산만)
 */

type SearchParams = Promise<{
  from?: string
  to?: string
  store_uuid?: string
}>

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function SettlementsSummaryPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  // ── Auth ───────────────────────────────────────────────────
  const h = await headers()
  const cookie = h.get("cookie") ?? ""
  const syntheticReq = new Request("http://internal/settlements/summary", {
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

  const sp = await searchParams
  const fromDate = sp.from && ISO_DATE_RE.test(sp.from) ? sp.from : ""
  const toDate = sp.to && ISO_DATE_RE.test(sp.to) ? sp.to : ""
  const storeFilter =
    sp.store_uuid && UUID_RE.test(sp.store_uuid) ? sp.store_uuid : ""

  const fromIso = fromDate ? `${fromDate}T00:00:00.000Z` : ""
  const toIso = toDate ? `${toDate}T23:59:59.999Z` : ""

  // ── Stores (필터 셀렉트 + 이름 매핑) ─────────────────────
  const supabase = getServiceClient()
  const { data: allStoresRaw } = await supabase
    .from("stores")
    .select("id, store_name")
    .is("deleted_at", null)
    .order("store_name", { ascending: true })
  type StoreRow = { id: string; store_name: string }
  const allStores = (allStoresRaw ?? []) as StoreRow[]
  const storeNameMap = new Map<string, string>()
  for (const s of allStores) storeNameMap.set(s.id, s.store_name)
  const storeName = (id: string) => storeNameMap.get(id) ?? id.slice(0, 8)

  // ── Headers (scope + 필터) ────────────────────────────────
  let headerQuery = supabase
    .from("cross_store_settlements")
    .select("id, from_store_uuid, to_store_uuid, total_amount, status, created_at")
    .is("deleted_at", null)

  if (!auth.is_super_admin) {
    // owner 는 본인 매장이 from 또는 to 인 헤더만.
    headerQuery = headerQuery.or(
      `from_store_uuid.eq.${auth.store_uuid},to_store_uuid.eq.${auth.store_uuid}`,
    )
  }
  if (storeFilter) {
    headerQuery = headerQuery.or(
      `from_store_uuid.eq.${storeFilter},to_store_uuid.eq.${storeFilter}`,
    )
  }
  if (fromIso) headerQuery = headerQuery.gte("created_at", fromIso)
  if (toIso) headerQuery = headerQuery.lte("created_at", toIso)

  const { data: headersRaw, error: headerErr } = await headerQuery.limit(2000)

  type HeaderRow = {
    id: string
    from_store_uuid: string
    to_store_uuid: string
    total_amount: number | string | null
    status: string
    created_at: string
  }
  const headerRows = (headersRaw ?? []) as HeaderRow[]

  // ── Items (한 번에 in() 로 로드) ─────────────────────────
  const headerIds = headerRows.map((h) => h.id)
  type ItemRow = {
    cross_store_settlement_id: string
    manager_membership_id: string | null
    amount: number | string | null
  }
  let itemRows: ItemRow[] = []
  let itemErr: { message: string } | null = null
  if (headerIds.length > 0) {
    const { data, error } = await supabase
      .from("cross_store_settlement_items")
      .select("cross_store_settlement_id, manager_membership_id, amount")
      .in("cross_store_settlement_id", headerIds)
      .is("deleted_at", null)
    itemRows = (data ?? []) as ItemRow[]
    itemErr = error ? { message: error.message } : null
  }

  // ── manager 이름 enrichment ──────────────────────────────
  const managerIds = Array.from(
    new Set(
      itemRows
        .map((i) => i.manager_membership_id)
        .filter((v): v is string => !!v),
    ),
  )
  const managerNameMap = new Map<string, string>()
  if (managerIds.length > 0) {
    const { data: mRows } = await supabase
      .from("managers")
      .select("membership_id, name")
      .in("membership_id", managerIds)
    for (const m of (mRows ?? []) as { membership_id: string; name: string | null }[]) {
      managerNameMap.set(m.membership_id, m.name ?? "")
    }
  }

  // ── 헤더 id → {from, to} 맵 ──────────────────────────────
  const headerMap = new Map<string, HeaderRow>()
  for (const hr of headerRows) headerMap.set(hr.id, hr)

  // ── 집계 ─────────────────────────────────────────────────
  type Agg = { amount: number; count: number }
  const perFromStore = new Map<string, Agg>()
  const perToStore = new Map<string, Agg>()
  const perManager = new Map<string, Agg>()
  let totalAmount = 0
  let totalItems = 0

  for (const it of itemRows) {
    const header = headerMap.get(it.cross_store_settlement_id)
    if (!header) continue
    const amt = Number(it.amount ?? 0)
    if (!Number.isFinite(amt) || amt <= 0) continue
    totalAmount += amt
    totalItems += 1

    const f = perFromStore.get(header.from_store_uuid) ?? { amount: 0, count: 0 }
    f.amount += amt
    f.count += 1
    perFromStore.set(header.from_store_uuid, f)

    const t = perToStore.get(header.to_store_uuid) ?? { amount: 0, count: 0 }
    t.amount += amt
    t.count += 1
    perToStore.set(header.to_store_uuid, t)

    const mid = it.manager_membership_id ?? "__unassigned__"
    const m = perManager.get(mid) ?? { amount: 0, count: 0 }
    m.amount += amt
    m.count += 1
    perManager.set(mid, m)
  }

  // owner 관점: 내 매장이 from 이면 outgoing, to 이면 incoming.
  //   super_admin 은 "전체 지급/수령" 자체가 total 과 동일하므로 단순히
  //   total 만 노출하되 카드 2장은 구분 유지 (super_admin 도 모든 from/to
  //   sum 이 각각 total_amount 와 같음 — 레이블만 다름).
  const totalPaid = auth.is_super_admin
    ? totalAmount
    : perFromStore.get(auth.store_uuid)?.amount ?? 0
  const totalReceived = auth.is_super_admin
    ? totalAmount
    : perToStore.get(auth.store_uuid)?.amount ?? 0

  const fromArr = Array.from(perFromStore.entries())
    .map(([store_uuid, v]) => ({ store_uuid, ...v }))
    .sort((a, b) => b.amount - a.amount)
  const toArr = Array.from(perToStore.entries())
    .map(([store_uuid, v]) => ({ store_uuid, ...v }))
    .sort((a, b) => b.amount - a.amount)
  const managerArr = Array.from(perManager.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.amount - a.amount)

  const fmtKrw = (n: number) => n.toLocaleString("ko-KR") + "원"

  const anyError = headerErr || itemErr

  // ── Render ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">
              <Link href="/settlements" className="hover:text-slate-300">
                ← 정산 목록
              </Link>
            </div>
            <h1 className="mt-1 text-2xl font-bold">정산 집계</h1>
            <p className="mt-1 text-sm text-slate-400">
              settled 기준 / 조회 전용 · 매장·실장별 합계 검산용.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            내 매장:{" "}
            <span className="text-slate-300">
              {storeName(auth.store_uuid)}
            </span>
            {auth.is_super_admin && (
              <span className="ml-2 rounded bg-indigo-500/10 px-2 py-0.5 text-indigo-300">
                super_admin
              </span>
            )}
          </div>
        </div>

        {/* Filters */}
        <form
          method="get"
          className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4"
        >
          <div>
            <label className="block text-xs text-slate-400 mb-1">시작일</label>
            <input
              type="date"
              name="from"
              defaultValue={fromDate}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">종료일</label>
            <input
              type="date"
              name="to"
              defaultValue={toDate}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">매장 (from 또는 to)</label>
            <select
              name="store_uuid"
              defaultValue={storeFilter}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 min-w-[14rem]"
            >
              <option value="">전체</option>
              {allStores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.store_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
            >
              조회
            </button>
            <Link
              href="/settlements/summary"
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              초기화
            </Link>
          </div>
        </form>

        {/* Error */}
        {anyError && (
          <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            조회 실패: {anyError.message}
          </div>
        )}

        {/* Top cards */}
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs text-slate-400">전체 지급 합계</div>
            <div className="mt-1 font-mono text-2xl text-slate-100">
              {fmtKrw(totalPaid)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {auth.is_super_admin
                ? "전체 헤더 Σ amount"
                : `from_store_uuid = ${storeName(auth.store_uuid)}`}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs text-slate-400">전체 수령 합계</div>
            <div className="mt-1 font-mono text-2xl text-slate-100">
              {fmtKrw(totalReceived)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {auth.is_super_admin
                ? "전체 헤더 Σ amount"
                : `to_store_uuid = ${storeName(auth.store_uuid)}`}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs text-slate-400">전체 item 수</div>
            <div className="mt-1 font-mono text-2xl text-slate-100">
              {totalItems.toLocaleString("ko-KR")}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              헤더 {headerRows.length.toLocaleString("ko-KR")} 건
            </div>
          </div>
        </div>

        {/* From-store breakdown */}
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">
            from 기준 매장별 총 지급
          </h2>
          {fromArr.length === 0 ? (
            <div className="rounded border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
              해당 조건의 데이터가 없습니다.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">매장</th>
                    <th className="px-3 py-2 text-right font-medium">건수</th>
                    <th className="px-3 py-2 text-right font-medium">총 지급</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950">
                  {fromArr.map((r) => (
                    <tr key={r.store_uuid} className="hover:bg-slate-900/40">
                      <td className="px-3 py-2">
                        <div className="text-slate-100">{storeName(r.store_uuid)}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {r.store_uuid.slice(0, 8)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {r.count.toLocaleString("ko-KR")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-100">
                        {fmtKrw(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* To-store breakdown */}
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">
            to 기준 매장별 총 수령
          </h2>
          {toArr.length === 0 ? (
            <div className="rounded border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
              해당 조건의 데이터가 없습니다.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">매장</th>
                    <th className="px-3 py-2 text-right font-medium">건수</th>
                    <th className="px-3 py-2 text-right font-medium">총 수령</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950">
                  {toArr.map((r) => (
                    <tr key={r.store_uuid} className="hover:bg-slate-900/40">
                      <td className="px-3 py-2">
                        <div className="text-slate-100">{storeName(r.store_uuid)}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {r.store_uuid.slice(0, 8)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {r.count.toLocaleString("ko-KR")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-100">
                        {fmtKrw(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Manager breakdown */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">
            실장별 합계
          </h2>
          {managerArr.length === 0 ? (
            <div className="rounded border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
              해당 조건의 데이터가 없습니다.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">실장</th>
                    <th className="px-3 py-2 text-right font-medium">건수</th>
                    <th className="px-3 py-2 text-right font-medium">총 금액</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950">
                  {managerArr.map((r) => {
                    const isUnassigned = r.id === "__unassigned__"
                    const label = isUnassigned
                      ? "(미지정)"
                      : managerNameMap.get(r.id) || r.id.slice(0, 8)
                    return (
                      <tr key={r.id} className="hover:bg-slate-900/40">
                        <td className="px-3 py-2">
                          <div
                            className={
                              isUnassigned
                                ? "text-slate-500 italic"
                                : "text-slate-100"
                            }
                          >
                            {label}
                          </div>
                          {!isUnassigned && (
                            <div className="text-[11px] text-slate-500 font-mono">
                              {r.id.slice(0, 8)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">
                          {r.count.toLocaleString("ko-KR")}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-100">
                          {fmtKrw(r.amount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
