"use client"

/**
 * /owner/labels — 매장별 UI 라벨 customization 페이지.
 *
 * 점주가 본인 매장에서 보이는 단어를 자유롭게 설정.
 *   예: "실장" → "팀장" / "매니저" / "사장님"
 *       "퍼블릭" → "기본 코스" / "Type A" / "정규"
 *       "스태프" → "직원" / "선생님"
 *
 * 저장 후 즉시 반영 (LabelsProvider 가 새로고침 또는 setLabels 호출 시 hydrate).
 *
 * DB 영향: store_settings.display_labels 만 변경. service_type 등 영구 키는 그대로.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { listLabelKeys, type LabelKey } from "@/lib/labels"
import { useLabelsContext } from "@/lib/labels/LabelsProvider"

type LabelEntry = {
  key: LabelKey
  defaultValue: string  // 빌드 모드 default (앱 빌드면 generic, 웹이면 industry)
  webValue: string      // industry 라벨 (참고용)
  override: string      // 점주가 입력한 값 (빈 문자열이면 default 사용)
}

// 라벨 그룹 — UI 보기 좋게 분류.
const LABEL_GROUPS: Array<{ title: string; keys: LabelKey[] }> = [
  {
    title: "직책",
    keys: ["manager", "staff", "customer", "owner"],
  },
  {
    title: "서비스 종목 (DB 키 보존)",
    keys: ["service_p", "service_s", "service_h", "extra_time", "half_time", "full_time", "greeting_check"],
  },
  {
    title: "정산 / 금액",
    keys: [
      "manager_commission", "staff_payout", "manager_receivable", "manager_payable",
      "store_revenue", "store_margin", "pre_settlement", "post_settlement",
      "customer_total", "participant_total", "order_total", "liquor_total", "waiter_tip",
    ],
  },
  {
    title: "결제 / 후불",
    keys: ["cash_payment", "card_payment", "credit_payment", "card_fee", "credit", "credit_pending", "credit_collected"],
  },
  {
    title: "세션 / 룸",
    keys: ["session", "room", "active_session", "closed_session", "checkin", "checkout", "mid_out", "kick", "extend"],
  },
  {
    title: "영업 / 매출",
    keys: ["business_day", "open_day", "closed_day", "tc_count", "tc_amount"],
  },
  {
    title: "직원 관리 / 채팅",
    keys: ["attendance", "attendance_check", "staff_pool", "staff_chat", "global_chat", "group_chat", "direct_chat"],
  },
]

export default function LabelsSettingsPage() {
  const router = useRouter()
  const { setLabels: setProviderLabels } = useLabelsContext()
  const [entries, setEntries] = useState<LabelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await apiFetch("/api/store/settings")
        if (res.status === 401 || res.status === 403) {
          router.push("/login")
          return
        }
        const data = await res.json().catch(() => ({}))
        const dl: Record<string, string> =
          data?.settings?.display_labels && typeof data.settings.display_labels === "object"
            ? data.settings.display_labels
            : {}
        const allKeys = listLabelKeys()
        if (cancelled) return
        setEntries(
          allKeys.map((k) => ({
            key: k.key,
            defaultValue: k.defaultValue,
            webValue: k.webValue,
            override: dl[k.key] ?? "",
          })),
        )
      } catch {
        if (!cancelled) setError("설정을 불러오지 못했습니다.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [router])

  function updateOverride(key: LabelKey, value: string) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, override: value } : e)))
    setSuccess(false)
  }

  async function handleSave() {
    setSaving(true)
    setError("")
    setSuccess(false)
    try {
      const display_labels: Record<string, string> = {}
      for (const e of entries) {
        const v = e.override.trim()
        if (v.length > 0 && v !== e.defaultValue) {
          display_labels[e.key] = v
        }
      }
      const res = await apiFetch("/api/store/settings", {
        method: "PATCH",
        body: JSON.stringify({ display_labels }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "저장 실패")
        return
      }
      setProviderLabels(display_labels as Partial<Record<LabelKey, string>>)
      setSuccess(true)
    } catch {
      setError("네트워크 오류")
    } finally {
      setSaving(false)
    }
  }

  function handleResetAll() {
    if (!confirm("모든 라벨을 기본값으로 되돌리시겠습니까?")) return
    setEntries((prev) => prev.map((e) => ({ ...e, override: "" })))
    setSuccess(false)
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/owner")} className="text-cyan-400 text-sm">
            ← 사장 페이지
          </button>
          <span className="font-semibold">라벨 설정</span>
          <div className="w-20" />
        </div>

        <div className="px-4 py-4 space-y-2 text-xs text-slate-400 border-b border-white/10">
          <p>
            매장 안에서 보이는 단어를 본인이 익숙한 표현으로 바꿀 수 있습니다.
          </p>
          <p>
            빈 칸으로 두면 기본값을 사용합니다. <span className="text-cyan-300">DB 데이터는 영향받지 않습니다</span> —
            화면 표시만 바뀝니다.
          </p>
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm">
            저장됐습니다. 화면을 새로고침하면 모든 페이지에 반영됩니다.
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-slate-500 text-sm">불러오는 중...</div>
        ) : (
          <div className="px-4 py-4 space-y-6">
            {LABEL_GROUPS.map((group) => (
              <div key={group.title} className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                <div className="text-sm font-semibold text-slate-200 mb-3">{group.title}</div>
                <div className="space-y-2">
                  {group.keys
                    .map((k) => entries.find((e) => e.key === k))
                    .filter((x): x is LabelEntry => !!x)
                    .map((e) => (
                      <div key={e.key} className="grid grid-cols-[8rem_1fr_8rem] items-center gap-2 text-xs">
                        <span className="text-slate-500 truncate" title={e.key}>
                          {e.key}
                        </span>
                        <input
                          type="text"
                          value={e.override}
                          placeholder={e.defaultValue}
                          onChange={(ev) => updateOverride(e.key, ev.target.value)}
                          maxLength={30}
                          className="bg-white/[0.04] border border-white/10 rounded px-2 py-1.5 text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/50"
                        />
                        <span className="text-slate-500 truncate text-right" title={`기본: ${e.defaultValue}`}>
                          기본: {e.defaultValue}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}

            <div className="flex gap-2 pb-6">
              <button
                onClick={handleResetAll}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-sm text-slate-300 disabled:opacity-50"
              >
                전부 기본값으로
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="ml-auto px-6 py-2 rounded-xl bg-cyan-500/25 border border-cyan-500/40 text-sm font-semibold text-cyan-200 disabled:opacity-50"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
