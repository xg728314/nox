"use client"
import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"

/**
 * 인라인 아가씨 이름 수정 컴포넌트.
 *
 * 채팅 파싱 자동 등록 결과에서 오탈자 즉시 정정 용도.
 * membership_id 확정된 아가씨만 편집 가능 (unmatched 는 자동 provisioning 완료 후 편집).
 *
 * 권한 판정은 서버 (PATCH /api/hostesses/[membership_id]/rename) 에서.
 * 클라이언트는 시도만 · FORBIDDEN 시 toast.
 *
 * R-rename-ui (2026-08-23)
 */
export function InlineRename({
  membershipId,
  currentName,
  onSaved,
}: {
  membershipId: string
  currentName: string
  onSaved?: (newName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  async function save() {
    const newName = value.trim()
    if (!newName || newName === currentName) {
      setEditing(false)
      setValue(currentName)
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch(`/api/hostesses/${membershipId}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: newName, reason: "chat_inline_edit" }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast(`이름 수정 실패: ${j.message || j.error || res.status}`, "error")
        setValue(currentName)
      } else {
        toast(`이름 수정: ${currentName} → ${newName}`, "success")
        onSaved?.(newName)
      }
    } catch (e) {
      toast(`이름 수정 실패: ${(e as Error).message}`, "error")
      setValue(currentName)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(ev) => { ev.stopPropagation(); setEditing(true); setValue(currentName) }}
        className="text-[9px] text-[#7A746A] hover:text-[#A87D45] px-1"
        title="이름 수정 (오탈자 정정)"
      >
        ✏️
      </button>
    )
  }

  return (
    <input
      type="text"
      autoFocus
      value={value}
      onChange={(ev) => setValue(ev.target.value)}
      onBlur={save}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); save() }
        else if (ev.key === "Escape") { ev.preventDefault(); setEditing(false); setValue(currentName) }
      }}
      disabled={saving}
      className="text-[11px] font-extrabold text-[#2D2B26] bg-white border border-[#C49B61] rounded px-1 w-20 disabled:opacity-40"
      maxLength={40}
    />
  )
}
