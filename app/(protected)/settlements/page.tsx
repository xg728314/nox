import { headers } from "next/headers"
import { redirect } from "next/navigation"
import Link from "next/link"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * /settlements — cross_store_settlements 헤더 목록 (읽기 전용).
 *
 * ROUND-C canonical 규약:
 *   from_store_uuid = payer (지불 매장)
 *   to_store_uuid   = receiver (수취 매장)
 *
 * 한 매장은 양방향에 참여할 수 있으므로 이 페이지는 내 매장이 **from 이든 to 이든**
 * 모두 보여준다 (outbound = 내가 지불할 건, inbound = 내가 받을 건).
 * 각 행에 `direction` 배지 표시.
 */
export default async function SettlementsListPage() {
  // ── Auth (cookie → AuthContext) ─────────────────────────────
  const h = await headers()
  const cookie = h.get("cookie") ?? ""
  const syntheticReq = new Request("http://internal/settlements", {
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

  // ── Data load ──────────────────────────────────────────────
  // ROUND-C: 내 매장이 from 또는 to 에 참여한 모든 헤더.
  //   super_admin 은 scope 필터 생략 (전체). owner 는 본인 매장 양방향.
  const supabase = getServiceClient()
  let query = supabase
    .from("cross_store_settlements")
    .select(
      "id, from_store_uuid, to_store_uuid, total_amount, prepaid_amount, remaining_amount, status, memo, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500)
  if (!auth.is_super_admin) {
    query = query.or(
      `from_store_uuid.eq.${auth.store_uuid},to_store_uuid.eq.${auth.store_uuid}`,
    )
  }
  const { data: headersRaw, error } = await query

  type Header = {
    id: string
    from_store_uuid: string
    to_store_uuid: string
    total_amount: number | string | null
    prepaid_amount: number | string | null
    remaining_amount: number | string | null
    status: string
    memo: string | null
    created_at: string
  }
  const rows = ((headersRaw ?? []) as Header[]) ?? []

  // Store name enrichment
  const storeIds = Array.from(
    new Set(
      rows.flatMap((r) => [r.from_store_uuid, r.to_store_uuid]).filter(Boolean),
    ),
  )
  const storeNameMap = new Map<string, string>()
  if (storeIds.length > 0) {
    const { data: stRows } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", storeIds)
    for (const s of (stRows ?? []) as { id: string; store_name: string }[]) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  const fmtKrw = (v: number | string | null) => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) ? n.toLocaleString("ko-KR") + "원" : "-"
  }
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    })
  }
  const shortId = (id: string) => id.slice(0, 8)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">정산 조회</h1>
            <p className="text-sm text-slate-400 mt-1">
              cross-store settlement 헤더 목록 — 편입된 돈 흐름 검산용.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            총 <span className="text-slate-200 font-semibold">{rows.length}</span> 건 ·
            내 매장: <span className="text-slate-300">{storeNameMap.get(auth.store_uuid) ?? shortId(auth.store_uuid)}</span>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            정산 헤더 조회 실패: {error.message}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-12 text-center text-slate-400">
            아직 편입된 정산이 없습니다.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">방향</th>
                  <th className="px-3 py-2 text-left font-medium">지급 매장 (from)</th>
                  <th className="px-3 py-2 text-left font-medium">수령 매장 (to)</th>
                  <th className="px-3 py-2 text-right font-medium">총액</th>
                  <th className="px-3 py-2 text-right font-medium">잔액</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">생성일시</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950">
                {rows.map((r) => {
                  const isOutbound = r.from_store_uuid === auth.store_uuid
                  const isInbound = r.to_store_uuid === auth.store_uuid
                  const directionLabel = isOutbound
                    ? "지불"
                    : isInbound
                    ? "수취"
                    : "외부"
                  const directionClass = isOutbound
                    ? "bg-red-500/10 text-red-300 border-red-500/20"
                    : isInbound
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                    : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                  return (
                  <tr key={r.id} className="hover:bg-slate-900/50">
                    <td className="px-3 py-2">
                      <span className={`rounded border px-2 py-0.5 text-[11px] ${directionClass}`}>
                        {directionLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-200">
                        {storeNameMap.get(r.from_store_uuid) ?? shortId(r.from_store_uuid)}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {shortId(r.from_store_uuid)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-200">
                        {storeNameMap.get(r.to_store_uuid) ?? shortId(r.to_store_uuid)}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {shortId(r.to_store_uuid)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-100">
                      {fmtKrw(r.total_amount)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">
                      {fmtKrw(r.remaining_amount)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          r.status === "open"
                            ? "rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400"
                            : r.status === "partial"
                            ? "rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400"
                            : r.status === "completed"
                            ? "rounded bg-sky-500/10 px-2 py-0.5 text-xs text-sky-400"
                            : "rounded bg-slate-500/10 px-2 py-0.5 text-xs text-slate-400"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {fmtDate(r.created_at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/settlements/${r.id}`}
                        className="text-xs text-sky-400 hover:text-sky-300"
                      >
                        상세 →
                      </Link>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
