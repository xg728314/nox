"use client"

/**
 * ManagerPermissionsModal — 사장이 실장별 메뉴 권한 토글.
 *
 * R-Manager-Permissions (2026-05-01):
 *   default ON. 사장이 OFF 토글 시 그 메뉴만 차단.
 *   ManagerBottomNav 가 mount 시 fetch 해서 hide.
 *
 * UX:
 *   - 9개 메뉴 한 줄씩 toggle.
 *   - "전체 ON / OFF" 버튼.
 *   - 즉시 PUT 저장 (optimistic).
 *   - 변경 audit_events 자동 기록 (server 측).
 */

import { useEffect, useState, useCallback } from "react"
import { apiFetch } from "@/lib/apiFetch"
import {
  MANAGER_MENU_KEYS,
  MANAGER_MENU_LABELS,
  type ManagerMenuKey,
} from "@/lib/auth/managerMenuPermissions"

type Props = {
  membership_id: string
  manager_name: string
  onClose: () => void
}

export default function ManagerPermissionsModal({ membership_id, manager_name, onClose }: Props) {
  const [menuMap, setMenuMap] = useState<Record<ManagerMenuKey, boolean> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const r = await apiFetch(`/api/store/managers/${membership_id}/menu-permissions`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.message || d.error || "권한 조회 실패")
        return
      }
      setMenuMap(d.menu_map as Record<ManagerMenuKey, boolean>)
    } catch {
      setError("네트워크 오류")
    } finally {
      setLoading(false)
    }
  }, [membership_id])

  useEffect(() => {
    void load()
  }, [load])

  async function saveAll(next: Record<ManagerMenuKey, boolean>) {
    setSaving(true)
    setError("")
    setMenuMap(next) // optimistic
    try {
      const r = await apiFetch(`/api/store/managers/${membership_id}/menu-permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions: next }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.message || d.error || "저장 실패")
        await load() // rollback
        return
      }
    } catch {
      setError("네트워크 오류")
      await load()
    } finally {
      setSaving(false)
    }
  }

  function toggle(key: ManagerMenuKey) {
    if (!menuMap) return
    const next = { ...menuMap, [key]: !menuMap[key] }
    void saveAll(next)
  }

  function setAll(value: boolean) {
    const next = {} as Record<ManagerMenuKey, boolean>
    for (const k of MANAGER_MENU_KEYS) next[k] = value
    void saveAll(next)
  }

  const enabledCount = menuMap
    ? Object.values(menuMap).filter((v) => v).length
    : 0

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#0a0c14] border border-white/10 rounded-2xl p-4 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold">🛡️ 메뉴 권한</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{manager_name} 실장</div>
          </div>
          <button onClick={onClose} className="text-slate-400 text-sm">✕</button>
        </div>

        <div className="text-[11px] text-slate-500 leading-relaxed mb-3 px-1">
          OFF 한 메뉴는 이 실장 화면 하단 네비에서 사라집니다. <br/>
          기본은 모든 메뉴 ON. 변경 즉시 저장됩니다.
        </div>

        {error && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">{error}</div>
        )}

        {loading ? (
          <div className="text-xs text-slate-500 py-6 text-center">불러오는 중...</div>
        ) : !menuMap ? (
          <div className="text-xs text-slate-500 py-6 text-center">권한 정보 없음</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/5">
              <span className="text-[11px] text-slate-400">
                활성 {enabledCount} / {MANAGER_MENU_KEYS.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setAll(true)}
                  disabled={saving}
                  className="text-[11px] px-2 py-1 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                >전체 ON</button>
                <button
                  onClick={() => setAll(false)}
                  disabled={saving}
                  className="text-[11px] px-2 py-1 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >전체 OFF</button>
              </div>
            </div>

            <div className="space-y-1">
              {MANAGER_MENU_KEYS.map((k) => {
                const on = menuMap[k]
                return (
                  <button
                    key={k}
                    onClick={() => toggle(k)}
                    disabled={saving}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors ${
                      on
                        ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-100"
                        : "bg-white/[0.03] border-white/10 text-slate-500"
                    } disabled:opacity-50`}
                  >
                    <span className="text-sm">{MANAGER_MENU_LABELS[k]}</span>
                    <span className={`relative w-9 h-5 rounded-full transition-colors ${on ? "bg-cyan-500" : "bg-slate-600"}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="text-[10px] text-slate-500 mt-3 text-center">
              {saving ? "저장 중..." : "변경 즉시 저장 · 다음 진입 시 반영"}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
