"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Settings = {
  id: string
  tc_rate: number
  rounding_unit: number
  updated_at: string
}

type ServiceType = {
  id: string
  service_type: string
  time_type: string
  time_minutes: number
  price: number
  manager_deduction: number
  has_greeting_check: boolean
  sort_order: number
}

const SERVICE_LABELS: Record<string, string> = {
  "퍼블릭": "퍼블릭",
  "셔츠": "셔츠",
  "하퍼": "하퍼",
}

const TIME_TYPE_LABELS: Record<string, string> = {
  "기본": "기본",
  "반티": "반티",
  "차3": "차3",
}

export default function OpsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [settings, setSettings] = useState<Settings | null>(null)
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])

  const [tcRate, setTcRate] = useState("")
  const [roundingUnit, setRoundingUnit] = useState("")

  // service type 편집 상태: id -> {price, manager_deduction}
  const [editedTypes, setEditedTypes] = useState<Record<string, { price: string; manager_deduction: string }>>({})

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    try {
      const [settingsRes, typesRes] = await Promise.all([
        apiFetch("/api/store/settings"),
        apiFetch("/api/store/service-types"),
      ])

      if (settingsRes.status === 401 || settingsRes.status === 403) { router.push("/login"); return }

      if (settingsRes.ok) {
        const data = await settingsRes.json()
        const s = data.settings
        if (s) {
          setSettings(s)
          setTcRate(String(s.tc_rate))
          setRoundingUnit(String(s.rounding_unit))
        }
      }

      if (typesRes.ok) {
        const data = await typesRes.json()
        const types = data.service_types ?? []
        setServiceTypes(types)
        // 초기 편집 상태
        const edits: Record<string, { price: string; manager_deduction: string }> = {}
        for (const t of types) {
          edits[t.id] = { price: String(t.price), manager_deduction: String(t.manager_deduction) }
        }
        setEditedTypes(edits)
      }
    } catch {
      setError("설정을 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveSettings() {
    setSaving(true)
    setError("")
    setSuccess("")

    const body: Record<string, number> = {}
    const tcNum = parseFloat(tcRate)
    const roundNum = parseInt(roundingUnit)
    if (!isNaN(tcNum)) body.tc_rate = tcNum
    if (!isNaN(roundNum)) body.rounding_unit = roundNum

    if (Object.keys(body).length === 0) {
      setError("변경할 값을 입력하세요.")
      setSaving(false)
      return
    }

    try {
      const res = await apiFetch("/api/store/settings", {
        method: "PATCH",
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        const s = data.settings
        if (s) {
          setSettings(s)
          setTcRate(String(s.tc_rate))
          setRoundingUnit(String(s.rounding_unit))
        }
        setSuccess("기본 설정이 저장되었습니다.")
        setTimeout(() => setSuccess(""), 3000)
      } else {
        const data = await res.json()
        setError(data.message || "설정 저장에 실패했습니다.")
      }
    } catch { setError("서버 오류가 발생했습니다.") }
    finally { setSaving(false) }
  }

  async function handleSaveServiceTypes() {
    setSaving(true)
    setError("")
    setSuccess("")

    // 변경된 항목만 수집
    const updates: { id: string; price: number; manager_deduction: number }[] = []
    for (const st of serviceTypes) {
      const edited = editedTypes[st.id]
      if (!edited) continue
      const newPrice = parseInt(edited.price)
      const newDed = parseInt(edited.manager_deduction)
      if (isNaN(newPrice) || isNaN(newDed)) {
        setError(`${st.service_type}/${st.time_type}: 숫자를 입력하세요.`)
        setSaving(false)
        return
      }
      if (newPrice !== st.price || newDed !== st.manager_deduction) {
        updates.push({ id: st.id, price: newPrice, manager_deduction: newDed })
      }
    }

    if (updates.length === 0) {
      setError("변경된 항목이 없습니다.")
      setSaving(false)
      return
    }

    try {
      const res = await apiFetch("/api/store/service-types", {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      })
      if (res.ok) {
        const data = await res.json()
        const types = data.service_types ?? []
        setServiceTypes(types)
        const edits: Record<string, { price: string; manager_deduction: string }> = {}
        for (const t of types) {
          edits[t.id] = { price: String(t.price), manager_deduction: String(t.manager_deduction) }
        }
        setEditedTypes(edits)
        setSuccess(`${updates.length}개 단가가 저장되었습니다.`)
        setTimeout(() => setSuccess(""), 3000)
      } else {
        const data = await res.json()
        setError(data.message || "단가 저장에 실패했습니다.")
      }
    } catch { setError("서버 오류가 발생했습니다.") }
    finally { setSaving(false) }
  }

  function updateType(id: string, field: "price" | "manager_deduction", value: string) {
    setEditedTypes((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  // 종목별 그룹
  const grouped = new Map<string, ServiceType[]>()
  for (const st of serviceTypes) {
    if (!grouped.has(st.service_type)) grouped.set(st.service_type, [])
    grouped.get(st.service_type)!.push(st)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/owner")} className="text-cyan-400 text-sm">← 사장</button>
          <span className="font-semibold">운영 설정</span>
          <div className="w-16" />
        </div>

        {/* 메시지 */}
        {error && <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
        {success && <div className="mx-4 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">{success}</div>}

        <div className="px-4 py-4 space-y-4">

          {/* ─── 종목별 단가 (핵심) ─── */}
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-cyan-300">종목별 단가</div>
              <div className="text-[10px] text-slate-500">고정 금액 방식</div>
            </div>

            {serviceTypes.length === 0 && (
              <div className="text-center py-4">
                <p className="text-slate-500 text-sm">종목별 단가가 설정되지 않았습니다.</p>
                <p className="text-slate-600 text-xs mt-1">seed 스크립트를 실행하세요.</p>
              </div>
            )}

            {[...grouped.entries()].map(([serviceType, types]) => (
              <div key={serviceType} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-300">{SERVICE_LABELS[serviceType] || serviceType}</span>
                  {types.some((t) => t.has_greeting_check) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">인사확인</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {types.sort((a, b) => a.sort_order - b.sort_order).map((st) => {
                    const edited = editedTypes[st.id]
                    return (
                      <div key={st.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">{TIME_TYPE_LABELS[st.time_type] || st.time_type}</span>
                            <span className="text-[10px] text-slate-600">{st.time_minutes}분</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-0.5">단가 (원)</label>
                            <input
                              type="number"
                              value={edited?.price ?? ""}
                              onChange={(e) => updateType(st.id, "price", e.target.value)}
                              className="w-full bg-transparent border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none font-mono focus:border-cyan-500/50"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-500 mb-0.5">실장수익 (원)</label>
                            <input
                              type="number"
                              value={edited?.manager_deduction ?? ""}
                              onChange={(e) => updateType(st.id, "manager_deduction", e.target.value)}
                              className="w-full bg-transparent border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none font-mono focus:border-cyan-500/50"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {serviceTypes.length > 0 && (
              <button
                onClick={handleSaveServiceTypes}
                disabled={saving}
                className="w-full h-10 rounded-xl bg-[linear-gradient(90deg,#00adf0,#0070f0)] text-xs font-semibold text-white shadow-[0_4px_20px_rgba(0,173,240,0.3)] disabled:opacity-50"
              >
                {saving ? "저장 중..." : "단가 저장"}
              </button>
            )}

            <div className="text-[10px] text-slate-600 space-y-0.5">
              <p>스태프 지급액 = 단가 - 실장수익</p>
              <p>실장수익: 0 / 5,000 / 10,000원 중 재량 선택</p>
              <p>% 기반 계산 없음 — 고정 금액만 사용</p>
            </div>
          </div>

          {/* ─── 기본 설정 (TC + 반올림) ─── */}
          {settings && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-4">
              <div className="text-sm font-medium text-slate-300">기본 설정</div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">TC 비율 (테이블차지)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tcRate}
                    onChange={(e) => setTcRate(e.target.value)}
                    className="w-full bg-transparent border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-mono"
                  />
                  <p className="text-xs text-slate-600 mt-1">예: 0.2 = 20% (매출에서 TC 공제)</p>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">반올림 단위</label>
                  <input
                    type="number"
                    step="1"
                    value={roundingUnit}
                    onChange={(e) => setRoundingUnit(e.target.value)}
                    className="w-full bg-transparent border border-white/10 rounded-xl p-3 text-sm text-white outline-none font-mono"
                  />
                  <p className="text-xs text-slate-600 mt-1">예: 1000 = 천원 단위 내림</p>
                </div>
              </div>

              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="w-full h-10 rounded-xl bg-white/10 text-xs font-semibold text-slate-300 hover:bg-white/20 disabled:opacity-50"
              >
                {saving ? "저장 중..." : "기본 설정 저장"}
              </button>

              <div className="text-xs text-slate-500 text-center">
                마지막 수정: {new Date(settings.updated_at).toLocaleString("ko-KR")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
