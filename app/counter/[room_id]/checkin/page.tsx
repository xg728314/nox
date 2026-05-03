"use client"

import { useState } from "react"
import { useRouter, useParams, useSearchParams } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Category = {
  label: string
  code: string
  fullTime: number
  halfTime: number
  fullPrice: number
  halfPrice: number
}

type StaffMember = {
  id: string
  membership_id: string
  name: string
  role: string
}

const BASE_CATEGORIES: Category[] = [
  { label: "퍼블릭", code: "퍼블릭", fullTime: 90, halfTime: 45, fullPrice: 130000, halfPrice: 70000 },
  { label: "셔츠",   code: "셔츠",   fullTime: 60, halfTime: 30, fullPrice: 140000, halfPrice: 70000 },
  { label: "하퍼",   code: "하퍼",   fullTime: 60, halfTime: 30, fullPrice: 120000, halfPrice: 60000 },
]

type Step = "category" | "cha3_base" | "duration" | "staff" | "manager" | "confirm"

export default function CheckinPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const roomId = params.room_id as string
  const existingSessionId = searchParams.get("session_id")

  const [step, setStep] = useState<Step>("category")
  const [isCha3, setIsCha3] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [durationType, setDurationType] = useState<"full" | "half">("full")
  const [selectedStaff, setSelectedStaff] = useState<StaffMember[]>([])
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [selectedManager, setSelectedManager] = useState<StaffMember | null>(null)
  const [isExternalManagerMode, setIsExternalManagerMode] = useState(false)
  const [externalManagerName, setExternalManagerName] = useState("")
  const [loading, setLoading] = useState(false)
  const [staffLoading, setStaffLoading] = useState(false)
  const [error, setError] = useState("")

  async function loadStaff() {
    setStaffLoading(true)
    try {
      const roomRes = await apiFetch(`/api/rooms/${roomId}`)
      const roomData = await roomRes.json()
      if (!roomRes.ok || !roomData?.store_uuid) {
        setStaffList([])
        return
      }

      const res = await apiFetch(`/api/store/staff?store_uuid=${encodeURIComponent(roomData.store_uuid)}`)
      const data = await res.json()
      setStaffList(res.ok ? (data.staff || []) : [])
    } catch {
      setStaffList([])
    } finally {
      setStaffLoading(false)
    }
  }

  // Step 1: 종목 선택 (퍼블릭/셔츠/하퍼/차3)
  function handleCategorySelect(code: string) {
    if (code === "차3") {
      setIsCha3(true)
      setSelectedCategory(null)
      setStep("cha3_base")
    } else {
      setIsCha3(false)
      const cat = BASE_CATEGORIES.find(c => c.code === code)!
      setSelectedCategory(cat)
      setStep("duration")
    }
  }

  // Step 2a: 차3일 때 기본 종목 선택 (퍼블릭/셔츠/하퍼)
  function handleCha3BaseSelect(cat: Category) {
    setSelectedCategory(cat)
    setStep("staff")
    loadStaff()
  }

  // Step 2b: 일반일 때 완티/반티 선택
  async function handleDurationSelect(type: "full" | "half") {
    setDurationType(type)
    setStep("staff")
    await loadStaff()
  }

  function toggleStaff(staff: StaffMember) {
    setSelectedStaff(prev =>
      prev.find(s => s.membership_id === staff.membership_id)
        ? prev.filter(s => s.membership_id !== staff.membership_id)
        : [...prev, staff]
    )
  }

  function handleBack() {
    if (step === "category") router.push("/counter")
    else if (step === "cha3_base") setStep("category")
    else if (step === "duration") setStep("category")
    else if (step === "staff") isCha3 ? setStep("cha3_base") : setStep("duration")
    else if (step === "manager") setStep("staff")
    else if (step === "confirm") setStep(existingSessionId ? "staff" : "manager")
  }

  // 실장 단계: 새 체크인 때만 노출, 참가자 추가 시 건너뜀
  function handleStaffNext() {
    if (existingSessionId) {
      setStep("confirm")
    } else {
      setStep("manager")
    }
  }

  function handleManagerNext() {
    setStep("confirm")
  }

  function handleSelectManager(staff: StaffMember) {
    setSelectedManager(staff)
    setIsExternalManagerMode(false)
    setExternalManagerName("")
  }

  async function handleConfirm() {
    if (!selectedCategory) return
    setLoading(true)
    setError("")

    // 차3: time_minutes=15, time_type="차3", price=30000
    // 일반: time_minutes=완티/반티, time_type 자동
    const timeMinutes = isCha3 ? 15 : (durationType === "full" ? selectedCategory.fullTime : selectedCategory.halfTime)
    const timeType = isCha3 ? "차3" : undefined

    try {
      let sessionId = existingSessionId

      if (!sessionId) {
        const checkinBody: Record<string, unknown> = { room_uuid: roomId }
        if (isExternalManagerMode && externalManagerName.trim()) {
          checkinBody.is_external_manager = true
          checkinBody.manager_name = externalManagerName.trim()
        } else if (selectedManager) {
          checkinBody.is_external_manager = false
          checkinBody.manager_membership_id = selectedManager.membership_id
          checkinBody.manager_name = selectedManager.name
        }
        const checkinRes = await apiFetch("/api/sessions/checkin", {
          method: "POST",
          body: JSON.stringify(checkinBody),
        })
        const checkinData = await checkinRes.json()
        if (!checkinRes.ok) {
          if (checkinRes.status === 409 && checkinData.session_id) {
            sessionId = checkinData.session_id
          } else {
            setError(checkinData.message || "체크인 실패")
            return
          }
        } else {
          sessionId = checkinData.session_id
        }
      }

      if (selectedStaff.length > 0) {
        // 2026-05-01 R-Counter-Speed: 직렬 for-of → Promise.all. N명 × ~300ms → ~300ms.
        const results = await Promise.all(
          selectedStaff.map((staff) => {
            const body: Record<string, unknown> = {
              session_id: sessionId,
              membership_id: staff.membership_id,
              role: staff.role,
              category: selectedCategory.code,
              time_minutes: timeMinutes,
            }
            if (timeType) body.time_type = timeType
            return apiFetch("/api/sessions/participants", {
              method: "POST",
              body: JSON.stringify(body),
            }).then((res) => ({ staff, res }))
          }),
        )
        for (const { staff, res } of results) {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            setError(data.message || `참여자 등록 실패: ${staff.name}`)
          }
        }
      }

      router.push("/counter")
    } catch {
      setError("요청 오류")
    } finally {
      setLoading(false)
    }
  }

  // 표시용 금액/시간
  const displayTime = isCha3 ? 15 : (selectedCategory ? (durationType === "full" ? selectedCategory.fullTime : selectedCategory.halfTime) : 0)
  const displayPrice = isCha3 ? 30000 : (selectedCategory ? (durationType === "full" ? selectedCategory.fullPrice : selectedCategory.halfPrice) : 0)

  const stepIndex = { category: 0, cha3_base: 1, duration: 1, staff: 2, manager: 3, confirm: 4 }[step]

  return (
    <div className="min-h-screen bg-[#030814] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={handleBack} className="text-cyan-400 text-sm">← 뒤로</button>
          <span className="font-semibold">{existingSessionId ? "참가자 추가" : "체크인"}</span>
          <div />
        </div>

        {/* 진행 바 */}
        <div className="px-4 py-4">
          <div className="flex gap-1">
            {["종목", "시간", "스태프", "실장", "확인"].map((label, i) => (
              <div key={label} className="flex-1">
                <div className={`h-1 rounded-full mb-1 ${i <= stepIndex ? "bg-cyan-400" : "bg-white/10"}`} />
                <div className={`text-xs text-center ${i <= stepIndex ? "text-cyan-300" : "text-slate-500"}`}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-4 mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="px-4 pb-8">

          {/* Step 1: 종목 선택 */}
          {step === "category" && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold mb-4">종목 선택</h2>
              {BASE_CATEGORIES.map(cat => (
                <button
                  key={cat.code}
                  onClick={() => handleCategorySelect(cat.code)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-lg">{cat.label}</div>
                      <div className="text-xs text-slate-400 mt-1">완티 {cat.fullTime}분 / 반티 {cat.halfTime}분</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-emerald-300">₩{cat.fullPrice.toLocaleString()}</div>
                      <div className="text-xs text-slate-400">₩{cat.halfPrice.toLocaleString()}</div>
                    </div>
                  </div>
                </button>
              ))}
              {/* 차3 */}
              <button
                onClick={() => handleCategorySelect("차3")}
                className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 text-left hover:border-amber-500/50 hover:bg-amber-500/10 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-lg text-amber-300">차3</div>
                    <div className="text-xs text-slate-400 mt-1">15분 고정</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-amber-300">₩30,000</div>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Step 2a: 차3 기본 종목 선택 */}
          {step === "cha3_base" && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold mb-1">차3 — 기본 종목 선택</h2>
              <p className="text-sm text-slate-400 mb-4">차3 · 15분 · ₩30,000</p>
              {BASE_CATEGORIES.map(cat => (
                <button
                  key={cat.code}
                  onClick={() => handleCha3BaseSelect(cat)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all"
                >
                  <div className="font-semibold text-lg">{cat.label}</div>
                </button>
              ))}
            </div>
          )}

          {/* Step 2b: 완티/반티 선택 */}
          {step === "duration" && selectedCategory && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold mb-1">{selectedCategory.label}</h2>
              <p className="text-sm text-slate-400 mb-4">시간을 선택해주세요</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleDurationSelect("full")}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center hover:border-cyan-500/30 transition-all"
                >
                  <div className="text-2xl font-semibold mb-1">완티</div>
                  <div className="text-sm text-slate-400">{selectedCategory.fullTime}분</div>
                  <div className="text-lg font-semibold text-emerald-300 mt-2">₩{selectedCategory.fullPrice.toLocaleString()}</div>
                </button>
                <button
                  onClick={() => handleDurationSelect("half")}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center hover:border-cyan-500/30 transition-all"
                >
                  <div className="text-2xl font-semibold mb-1">반티</div>
                  <div className="text-sm text-slate-400">{selectedCategory.halfTime}분</div>
                  <div className="text-lg font-semibold text-emerald-300 mt-2">₩{selectedCategory.halfPrice.toLocaleString()}</div>
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 스태프 선택 */}
          {step === "staff" && selectedCategory && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold mb-1">스태프 배정</h2>
              <p className="text-sm text-slate-400 mb-2">
                {isCha3 ? `차3 · ${selectedCategory.label}` : `${selectedCategory.label} ${durationType === "full" ? "완티" : "반티"}`}
                {" · "}{displayTime}분 · ₩{displayPrice.toLocaleString()}
              </p>

              {staffLoading && (
                <div className="p-6 text-center text-cyan-400 text-sm animate-pulse">스태프 목록 불러오는 중...</div>
              )}

              {!staffLoading && staffList.length === 0 && (
                <div className="p-6 text-center text-slate-500 text-sm">스태프 목록이 없습니다.</div>
              )}

              {staffList.map(staff => {
                const selected = selectedStaff.find(s => s.membership_id === staff.membership_id)
                return (
                  <button
                    key={staff.membership_id}
                    onClick={() => toggleStaff(staff)}
                    className={`w-full rounded-2xl border p-4 text-left transition-all ${
                      selected ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-lg border flex items-center justify-center text-xs ${
                        selected ? "border-cyan-400 bg-cyan-400 text-white" : "border-white/20"
                      }`}>
                        {selected && "✓"}
                      </div>
                      <span className="font-medium">{staff.name}</span>
                      <span className={`text-xs ${staff.role === "manager" ? "text-purple-300" : "text-pink-300"}`}>
                        {staff.role === "manager" ? "실장" : "스태프"}
                      </span>
                    </div>
                  </button>
                )
              })}

              <button
                onClick={handleStaffNext}
                className="w-full h-14 rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold shadow-[0_8px_30px_rgba(37,99,235,0.35)]"
              >
                {selectedStaff.length > 0 ? `${selectedStaff.length}명 선택 → 다음` : "스태프 없이 다음"}
              </button>
            </div>
          )}

          {/* Step 3.5: 담당 실장 (새 체크인일 때만) */}
          {step === "manager" && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold mb-1">담당 실장</h2>
              <p className="text-sm text-slate-400 mb-2">선택사항입니다. 건너뛸 수 있습니다.</p>

              {/* 외부 실장 토글 */}
              <button
                onClick={() => {
                  setIsExternalManagerMode(prev => !prev)
                  setSelectedManager(null)
                }}
                className={`w-full rounded-xl border p-3 text-sm font-medium transition-all ${
                  isExternalManagerMode
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-white/10 bg-white/[0.04] text-slate-300"
                }`}
              >
                {isExternalManagerMode ? "✓ 외부 실장 (이름 직접 입력)" : "외부 실장 (이름 직접 입력)"}
              </button>

              {isExternalManagerMode ? (
                <input
                  type="text"
                  value={externalManagerName}
                  onChange={e => setExternalManagerName(e.target.value)}
                  placeholder="실장 이름"
                  className="w-full rounded-xl border border-white/10 bg-[#030814] px-4 py-3 text-sm text-white focus:border-cyan-500/40 outline-none"
                />
              ) : (
                <>
                  {staffLoading && (
                    <div className="p-6 text-center text-cyan-400 text-sm animate-pulse">목록 불러오는 중...</div>
                  )}
                  {!staffLoading && staffList.filter(s => s.role === "manager").length === 0 && (
                    <div className="p-6 text-center text-slate-500 text-sm">등록된 실장이 없습니다.</div>
                  )}
                  {staffList.filter(s => s.role === "manager").map(staff => {
                    const isSelected = selectedManager?.membership_id === staff.membership_id
                    return (
                      <button
                        key={staff.membership_id}
                        onClick={() => handleSelectManager(staff)}
                        className={`w-full rounded-2xl border p-4 text-left transition-all ${
                          isSelected ? "border-purple-500/40 bg-purple-500/10" : "border-white/10 bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-lg border flex items-center justify-center text-xs ${
                            isSelected ? "border-purple-400 bg-purple-400 text-white" : "border-white/20"
                          }`}>
                            {isSelected && "✓"}
                          </div>
                          <span className="font-medium">{staff.name}</span>
                          <span className="text-xs text-purple-300">실장</span>
                        </div>
                      </button>
                    )
                  })}
                </>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => {
                    setSelectedManager(null)
                    setIsExternalManagerMode(false)
                    setExternalManagerName("")
                    handleManagerNext()
                  }}
                  className="h-14 rounded-2xl border border-white/10 bg-white/[0.04] text-base font-semibold text-slate-300"
                >
                  건너뛰기
                </button>
                <button
                  onClick={handleManagerNext}
                  disabled={!selectedManager && !(isExternalManagerMode && externalManagerName.trim())}
                  className="h-14 rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold disabled:opacity-40 shadow-[0_8px_30px_rgba(37,99,235,0.35)]"
                >
                  다음
                </button>
              </div>
            </div>
          )}

          {/* Step 4: 확인 */}
          {step === "confirm" && selectedCategory && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold mb-4">확인</h2>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">종목</span>
                  <span className="font-medium">{isCha3 ? `차3 (${selectedCategory.label})` : selectedCategory.label}</span>
                </div>
                {!isCha3 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">타입</span>
                    <span className="font-medium">{durationType === "full" ? "완티" : "반티"}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">시간</span>
                  <span className="font-medium">{displayTime}분</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">금액</span>
                  <span className="font-semibold text-emerald-300">₩{displayPrice.toLocaleString()}</span>
                </div>
                {!existingSessionId && (selectedManager || (isExternalManagerMode && externalManagerName.trim())) && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">담당 실장</span>
                    <span className="font-medium">
                      {isExternalManagerMode
                        ? `${externalManagerName.trim()} (외부)`
                        : selectedManager?.name}
                    </span>
                  </div>
                )}
                {selectedStaff.length > 0 && (
                  <div className="border-t border-white/10 pt-3">
                    <span className="text-xs text-slate-400">배정 스태프</span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedStaff.map(s => (
                        <span key={s.membership_id} className="text-xs px-3 py-1 rounded-full bg-white/10 text-slate-300">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="w-full h-14 rounded-2xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold disabled:opacity-50 shadow-[0_8px_30px_rgba(37,99,235,0.35)]"
              >
                {loading ? "처리 중..." : existingSessionId ? "참여자 등록" : "체크인 완료"}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
