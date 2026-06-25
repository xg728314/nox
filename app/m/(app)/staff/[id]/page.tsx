"use client"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { useHostesses } from "../../../_hooks/useMobileData"
import { useApi } from "../../../_hooks/useApi"
import { initialOf } from "../../../_lib/format"
import { useToast, haptic } from "../../../_components/Toast"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../../../_lib/cn"

type TodaySession = {
  store_name: string | null
  category: string | null
  time_minutes: number | null
  hostess_payout_amount: number
  status: string
  room_name: string | null
  receipt_status: string | null
}
type InfoResponse = {
  hostess_name: string
  today: {
    business_day_id: string | null
    sessions: TodaySession[]
    total_count: number
    total_payout: number
    settlement_finalized: boolean
  }
  payout: {
    method: "account" | "cash"
    bank_name: string | null
    account_number: string | null
    holder_name: string | null
    default_manager_deduction: number
  }
}

export default function StaffDetailPage() {
  const params = useParams<{ id: string }>()
  const id = decodeURIComponent(params.id ?? "")
  const { data: hostessData, isLoading } = useHostesses()
  const info = useApi<InfoResponse>(`/api/manager/hostesses/${encodeURIComponent(id)}/info`, {
    ttl: 5000,
  })
  const toast = useToast()

  const h = (hostessData?.hostesses ?? []).find((x) => x.membership_id === id)

  // 지급 정보 편집 상태
  const [method, setMethod] = useState<"account" | "cash">("cash")
  const [bankName, setBankName] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [holderName, setHolderName] = useState("")
  const [deduction, setDeduction] = useState(0) // 1타임당 실장수익 (원)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // 서버 응답으로 form 초기화 (1회)
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (initialized || !info.data) return
    setMethod(info.data.payout.method)
    setBankName(info.data.payout.bank_name ?? "")
    setAccountNumber(info.data.payout.account_number ?? "")
    setHolderName(info.data.payout.holder_name ?? "")
    setDeduction(info.data.payout.default_manager_deduction ?? 0)
    setInitialized(true)
  }, [info.data, initialized])

  async function save() {
    if (saving) return
    setSaving(true)
    haptic([10, 20, 10])
    try {
      const res = await apiFetch(
        `/api/manager/hostesses/${encodeURIComponent(id)}/info`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payout_method: method,
            bank_name: bankName.trim() || null,
            account_number: accountNumber.trim() || null,
            holder_name: holderName.trim() || null,
            default_manager_deduction: deduction,
          }),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) {
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      toast("저장 완료", "success")
      setDirty(false)
      info.refresh()
    } catch (e) {
      toast(`저장 실패: ${(e as Error).message}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const todaySessions = info.data?.today.sessions ?? []
  const totalCount = info.data?.today.total_count ?? 0
  const totalPayout = info.data?.today.total_payout ?? 0
  const finalized = info.data?.today.settlement_finalized ?? false

  // 매장+종목 별 그룹화
  type Grp = { key: string; store_name: string | null; category: string | null; count: number; total: number }
  const groups: Grp[] = []
  const idx = new Map<string, number>()
  for (const s of todaySessions) {
    const key = `${s.store_name ?? "—"}|${s.category ?? "—"}`
    const i = idx.get(key)
    if (i === undefined) {
      idx.set(key, groups.length)
      groups.push({ key, store_name: s.store_name, category: s.category, count: 1, total: s.hostess_payout_amount })
    } else {
      groups[i].count += 1
      groups[i].total += s.hostess_payout_amount
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title={h?.hostess_name ?? info.data?.hostess_name ?? "스태프"} backHref="/m/staff" />

      <div className="px-5 pb-24">
        {isLoading && <div className="text-center text-[12px] text-[#7A746A] py-10">로딩 중...</div>}
        {!isLoading && !h && !info.data && (
          <div className="text-center text-[12px] text-[#7A746A] py-10">해당 스태프를 찾을 수 없습니다</div>
        )}
        {(h || info.data) && (
          <>
            <div className="bg-white rounded-3xl p-5 mb-3 flex items-center gap-4 border border-[#D8D2C8]/60">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white text-[26px] font-extrabold flex items-center justify-center shrink-0">
                {initialOf(h?.hostess_name ?? info.data?.hostess_name ?? "?")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-extrabold tracking-tight">
                  {h?.hostess_name ?? info.data?.hostess_name ?? "—"}
                </div>
                {h && (
                  <div className="text-[10px] font-semibold text-[#7A746A] mt-1">
                    {h.status === "approved" ? "✓ 승인됨" : h.status} · {h.role}
                  </div>
                )}
              </div>
            </div>

            {/* 오늘 활동 */}
            <Section title="오늘 활동">
              {info.isLoading && !info.data && (
                <div className="px-4 py-6 text-center text-[11px] text-[#7A746A] font-semibold">불러오는 중...</div>
              )}
              {info.data && totalCount === 0 && (
                <div className="px-4 py-6 text-center text-[12px] text-[#7A746A] font-bold">
                  오늘 활동 없음
                </div>
              )}
              {info.data && totalCount > 0 && (
                <>
                  {groups.map((g) => (
                    <div
                      key={g.key}
                      className="flex items-center justify-between px-4 py-3 border-b border-[#D8D2C8]/40 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-extrabold text-[#2D2B26] truncate">
                          {g.store_name ?? "—"}
                        </div>
                        <div className="text-[10px] font-semibold text-[#7A746A] mt-0.5">
                          {g.category ?? "—"} · {g.count}타임
                        </div>
                      </div>
                      <div className="text-[14px] font-extrabold text-[#A87D45] shrink-0">
                        {(g.total / 10000).toFixed(0)}만
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-3 bg-[#FAF5EC] border-t-2 border-[#C49B61]/30">
                    <div className="text-[12px] font-extrabold text-[#2D2B26]">
                      총 {totalCount}타임
                    </div>
                    <div className="text-[16px] font-extrabold text-[#A87D45]">
                      {(totalPayout / 10000).toFixed(0)}만원
                    </div>
                  </div>
                </>
              )}
            </Section>

            {/* 정산 상태 */}
            <Section title="정산 상태">
              <div className="px-4 py-3 flex items-center justify-between">
                <span className="text-[12px] font-bold text-[#7A746A]">상태</span>
                {totalCount === 0 ? (
                  <span className="text-[12px] font-extrabold text-[#7A746A]">— (활동 없음)</span>
                ) : finalized ? (
                  <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-green-100 text-green-700 border border-green-300">
                    ✓ 정산 완료
                  </span>
                ) : (
                  <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
                    ⏳ 진행 중 / 미확정
                  </span>
                )}
              </div>
            </Section>

            {/* 1타임당 실장수익 */}
            <Section title="1타임당 실장수익 (지급 공제)">
              <div className="px-4 py-3">
                <div className="text-[10px] font-bold text-[#7A746A] mb-2">
                  새 세션 등록 시 자동 적용 — 실장이 가져가는 금액 (0 / 5천원 / 1만원)
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[0, 5000, 10000].map((v) => {
                    const active = deduction === v
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => { setDeduction(v); setDirty(true) }}
                        className={cn(
                          "rounded-xl py-2.5 text-[13px] font-extrabold border-2 transition-all",
                          active
                            ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent shadow-sm"
                            : "bg-white border-[#D8D2C8] text-[#7A746A]",
                        )}
                      >
                        {v === 0 ? "0원" : `${(v / 1000).toFixed(0)}천원`}
                      </button>
                    )
                  })}
                </div>
                <div className="text-[10px] font-semibold text-[#7A746A] mt-2 leading-snug">
                  예: 14만원 종목 + 5천원 공제 → 식구 지급 13.5만원, 실장 0.5만원
                </div>
              </div>
            </Section>

            {/* 지급 정보 */}
            <Section title="지급 정보">
              <div className="px-4 py-3 border-b border-[#D8D2C8]/40">
                <div className="text-[11px] font-bold text-[#7A746A] mb-2">받는 방식</div>
                <div className="grid grid-cols-2 gap-2">
                  <PayoutBtn
                    label="💳 계좌"
                    active={method === "account"}
                    onClick={() => { setMethod("account"); setDirty(true) }}
                  />
                  <PayoutBtn
                    label="💵 현금"
                    active={method === "cash"}
                    onClick={() => { setMethod("cash"); setDirty(true) }}
                  />
                </div>
              </div>

              {method === "account" && (
                <>
                  <Field label="은행">
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => { setBankName(e.target.value); setDirty(true) }}
                      placeholder="예: 국민은행"
                      className="w-full bg-[#F8F4ED] border border-[#D8D2C8] rounded-lg px-3 py-2 text-[13px] font-semibold outline-none focus:border-[#C49B61]"
                    />
                  </Field>
                  <Field label="실명 (예금주)">
                    <input
                      type="text"
                      value={holderName}
                      onChange={(e) => { setHolderName(e.target.value); setDirty(true) }}
                      placeholder="예금주 실명"
                      className="w-full bg-[#F8F4ED] border border-[#D8D2C8] rounded-lg px-3 py-2 text-[13px] font-semibold outline-none focus:border-[#C49B61]"
                    />
                  </Field>
                  <Field label="계좌번호">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={accountNumber}
                      onChange={(e) => { setAccountNumber(e.target.value.replace(/[^\d-]/g, "")); setDirty(true) }}
                      placeholder="숫자만 (- 포함 가능)"
                      className="w-full bg-[#F8F4ED] border border-[#D8D2C8] rounded-lg px-3 py-2 text-[13px] font-semibold tracking-wider outline-none focus:border-[#C49B61]"
                    />
                  </Field>
                </>
              )}

              {method === "cash" && (
                <div className="px-4 py-3 text-[11px] font-semibold text-[#7A746A]">
                  현금 수령 — 정산일에 직접 전달
                </div>
              )}
            </Section>

            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className={cn(
                "w-full mt-4 rounded-2xl py-3.5 text-[14px] font-extrabold transition-all",
                dirty
                  ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white shadow-md active:scale-[0.98]"
                  : "bg-[#EFEBE3] text-[#A09A8E]",
              )}
            >
              {saving ? "저장 중..." : dirty ? "✓ 저장" : "변경사항 없음"}
            </button>
          </>
        )}
      </div>

      <TabBar />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider px-1 mb-1.5">{title}</div>
      <div className="bg-white rounded-2xl overflow-hidden border border-[#D8D2C8]/60">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-[#D8D2C8]/40 last:border-b-0">
      <div className="text-[10px] font-bold text-[#7A746A] mb-1">{label}</div>
      {children}
    </div>
  )
}

function PayoutBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl py-2.5 text-[13px] font-extrabold border-2 transition-all",
        active
          ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white border-transparent shadow-sm"
          : "bg-white border-[#D8D2C8] text-[#7A746A]",
      )}
    >
      {label}
    </button>
  )
}
