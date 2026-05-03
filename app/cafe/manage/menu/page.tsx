"use client"

/**
 * /cafe/manage/menu — 카페 메뉴 관리 (이미지 업로드 + 옵션 그룹).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"
import type { CafeMenuItem } from "@/lib/cafe/types"
import { useCafeManage } from "@/components/cafe/CafeManageContext"

type OptInput = { name: string; price_delta: number; is_default?: boolean }
type GroupDraft = { name: string; is_required: boolean; max_select: number; min_select: number; options: OptInput[] }
type RecipeLine = { supply_id: string | null; display_name: string; qty: number; unit: string; note: string }
type SupplyLite = { id: string; name: string; unit: string }

export default function CafeManageMenuPage() {
  const { data: bootstrap } = useCafeManage()
  const storeUuid = bootstrap?.profile.store_uuid ?? ""
  const [menu, setMenu] = useState<CafeMenuItem[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  // 새 메뉴 입력
  const [name, setName] = useState("")
  const [category, setCategory] = useState("커피")
  const [price, setPrice] = useState<number | "">("")
  const [description, setDescription] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [uploading, setUploading] = useState(false)
  const [groups, setGroups] = useState<GroupDraft[]>([])
  const [recipes, setRecipes] = useState<RecipeLine[]>([])
  const [prepNotes, setPrepNotes] = useState("")
  const [supplies, setSupplies] = useState<SupplyLite[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!storeUuid) return
    setLoading(true); setError("")
    try {
      const [menuR, supR] = await Promise.all([
        apiFetch(`/api/cafe/menu?store_uuid=${storeUuid}`),
        apiFetch(`/api/cafe/supplies?store_uuid=${storeUuid}`),
      ])
      const d = await menuR.json()
      if (!menuR.ok) { setError(d.message || "로드 실패"); return }
      setMenu(d.menu ?? [])
      if (supR.ok) {
        const sd = await supR.json()
        setSupplies(((sd.supplies ?? []) as Array<{id:string; name:string; unit:string}>).map((s) => ({ id: s.id, name: s.name, unit: s.unit })))
      }
    } finally { setLoading(false) }
  }, [storeUuid])

  useEffect(() => { load() }, [load])

  async function uploadImage(file: File) {
    setUploading(true); setError("")
    try {
      if (file.size > 5 * 1024 * 1024) { setError("파일 5MB 초과 — 작게 줄여주세요"); return }
      const fd = new FormData()
      fd.append("file", file)
      const r = await fetch("/api/cafe/upload", { method: "POST", credentials: "include", body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.message || `업로드 실패 (${r.status})`)
        return
      }
      setImageUrl(d.url as string)
    } catch (e) {
      setError("네트워크 오류 — 사진 업로드 실패")
    } finally { setUploading(false) }
  }

  function addGroup() {
    setGroups((gs) => [...gs, { name: "", is_required: false, max_select: 1, min_select: 0, options: [{ name: "", price_delta: 0 }] }])
  }
  function setGroup(i: number, patch: Partial<GroupDraft>) {
    setGroups((gs) => gs.map((g, idx) => idx === i ? { ...g, ...patch } : g))
  }
  function addOption(gi: number) {
    setGroups((gs) => gs.map((g, idx) => idx === gi ? { ...g, options: [...g.options, { name: "", price_delta: 0 }] } : g))
  }
  function setOption(gi: number, oi: number, patch: Partial<OptInput>) {
    setGroups((gs) => gs.map((g, idx) => idx === gi
      ? { ...g, options: g.options.map((o, j) => j === oi ? { ...o, ...patch } : o) }
      : g
    ))
  }
  function removeOption(gi: number, oi: number) {
    setGroups((gs) => gs.map((g, idx) => idx === gi
      ? { ...g, options: g.options.filter((_, j) => j !== oi) }
      : g
    ))
  }
  function removeGroup(i: number) {
    setGroups((gs) => gs.filter((_, idx) => idx !== i))
  }

  async function add() {
    if (!name.trim() || typeof price !== "number" || price < 0) { setError("이름/가격 필수"); return }
    setError("")
    const r = await apiFetch("/api/cafe/menu", {
      method: "POST",
      body: JSON.stringify({
        name, category, price,
        description: description || null,
        image_url: imageUrl || null,
        thumbnail_url: imageUrl || null,
      }),
    })
    const d = await r.json()
    if (!r.ok) { setError(d.message || "추가 실패"); return }
    const newId = d.item.id as string

    // 옵션 그룹들 한번씩 POST
    for (const g of groups) {
      if (!g.name.trim() || g.options.length === 0) continue
      await apiFetch(`/api/cafe/menu/${newId}/options`, {
        method: "POST",
        body: JSON.stringify({
          name: g.name.trim(),
          is_required: g.is_required,
          max_select: g.max_select,
          min_select: g.min_select,
          options: g.options.filter((o) => o.name.trim()).map((o) => ({
            name: o.name.trim(),
            price_delta: o.price_delta,
            is_default: o.is_default ?? false,
          })),
        }),
      })
    }

    // 레시피 PUT
    if (recipes.length > 0 || prepNotes.trim()) {
      await apiFetch(`/api/cafe/menu/${newId}/recipes`, {
        method: "PUT",
        body: JSON.stringify({
          prep_notes: prepNotes.trim() || null,
          lines: recipes
            .filter((l) => l.qty > 0 && (l.supply_id || l.display_name.trim()))
            .map((l, i) => ({
              supply_id: l.supply_id || null,
              display_name: l.display_name.trim() || null,
              qty: l.qty,
              unit: l.unit.trim() || null,
              note: l.note.trim() || null,
              sort_order: i,
            })),
        }),
      })
    }

    setName(""); setPrice(""); setDescription(""); setImageUrl(""); setGroups([])
    setRecipes([]); setPrepNotes("")
    if (fileInputRef.current) fileInputRef.current.value = ""
    await load()
  }

  function addRecipeLine() {
    setRecipes((r) => [...r, { supply_id: null, display_name: "", qty: 1, unit: "", note: "" }])
  }
  function setRecipeLine(i: number, patch: Partial<RecipeLine>) {
    setRecipes((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  function removeRecipeLine(i: number) {
    setRecipes((rs) => rs.filter((_, idx) => idx !== i))
  }

  async function toggleActive(id: string, is_active: boolean) {
    await apiFetch(`/api/cafe/menu/${id}`, { method: "PATCH", body: JSON.stringify({ is_active: !is_active }) })
    await load()
  }
  async function remove(id: string) {
    if (!confirm("삭제?")) return
    await apiFetch(`/api/cafe/menu/${id}`, { method: "DELETE" })
    await load()
  }

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <Link href="/cafe/manage" className="text-xs text-cyan-400">← 홈</Link>
          <h1 className="text-lg font-semibold mt-1">📦 메뉴 관리</h1>
        </div>

        {error && <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>}

        {/* 새 메뉴 */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 space-y-3">
          <div className="text-sm font-semibold text-cyan-200">+ 새 메뉴 추가</div>

          <div className="grid grid-cols-2 gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (예: 아메리카노)"
              className="rounded bg-[#030814] border border-white/10 px-2 py-2 text-sm" />
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="카테고리"
              className="rounded bg-[#030814] border border-white/10 px-2 py-2 text-sm" />
            <input type="number" value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="가격 (원)"
              className="rounded bg-[#030814] border border-white/10 px-2 py-2 text-sm" />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="짧은 설명"
              className="rounded bg-[#030814] border border-white/10 px-2 py-2 text-sm" />
          </div>

          {/* 이미지 — 큰 드롭존 */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">메뉴 사진</label>
            {imageUrl ? (
              <div className="flex gap-3 items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="preview" className="w-32 h-32 rounded-xl object-cover border border-white/10 flex-shrink-0" />
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-xs"
                    >🖼️ 다른 사진</button>
                    <button
                      type="button"
                      onClick={() => { setImageUrl(""); if (fileInputRef.current) fileInputRef.current.value = "" }}
                      className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 text-xs"
                    >✕ 제거</button>
                  </div>
                  <div className="text-[10px] text-slate-500 break-all">{imageUrl}</div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full h-32 rounded-xl border-2 border-dashed border-cyan-500/40 bg-cyan-500/[0.04] hover:bg-cyan-500/10 transition-colors flex flex-col items-center justify-center gap-1 disabled:opacity-50"
              >
                <span className="text-3xl">📸</span>
                <span className="text-sm text-cyan-200 font-semibold">
                  {uploading ? "업로드 중…" : "사진 선택 또는 카메라"}
                </span>
                <span className="text-[10px] text-slate-400">JPG / PNG / WEBP · 최대 5MB</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f) }}
              className="hidden" />
            {/* URL 직접 입력 — 접힘 */}
            <details className="mt-1.5">
              <summary className="text-[10px] text-slate-500 cursor-pointer">URL 로 직접 입력 (선택)</summary>
              <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..."
                className="w-full mt-1 rounded bg-[#030814] border border-white/10 px-2 py-1.5 text-xs" />
            </details>
          </div>

          {/* 옵션 그룹 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">옵션 그룹 (샷, 시럽, 사이즈 등)</span>
              <button onClick={addGroup} className="text-xs px-2 py-1 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-200">+ 그룹</button>
            </div>
            {groups.map((g, gi) => (
              <div key={gi} className="rounded-lg bg-white/[0.03] border border-white/10 p-2.5 mb-2 space-y-2">
                <div className="flex gap-1.5 items-center">
                  <input value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} placeholder="그룹 이름 (예: 샷)"
                    className="flex-1 rounded bg-[#030814] border border-white/10 px-2 py-1.5 text-xs" />
                  <label className="text-[10px] text-slate-400 flex items-center gap-1">
                    <input type="checkbox" checked={g.is_required} onChange={(e) => setGroup(gi, { is_required: e.target.checked })} />
                    필수
                  </label>
                  <input type="number" value={g.max_select} onChange={(e) => setGroup(gi, { max_select: Math.max(1, Number(e.target.value)) })}
                    className="w-12 rounded bg-[#030814] border border-white/10 px-1 py-1 text-xs text-center" title="최대 선택 수" />
                  <button onClick={() => removeGroup(gi)} className="text-xs text-red-400">✕</button>
                </div>
                <div className="space-y-1 pl-2">
                  {g.options.map((o, oi) => (
                    <div key={oi} className="flex gap-1 items-center">
                      <input value={o.name} onChange={(e) => setOption(gi, oi, { name: e.target.value })}
                        placeholder="옵션 이름"
                        className="flex-1 rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs" />
                      <input type="number" value={o.price_delta} onChange={(e) => setOption(gi, oi, { price_delta: Number(e.target.value) })}
                        placeholder="+가격" className="w-20 rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs" />
                      <button onClick={() => removeOption(gi, oi)} className="text-[10px] text-red-400 px-1">−</button>
                    </div>
                  ))}
                  <button onClick={() => addOption(gi)} className="text-[10px] text-cyan-300 px-1">+ 옵션</button>
                </div>
              </div>
            ))}
          </div>

          {/* 레시피 (BOM) */}
          <div className="border-t border-white/10 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">📋 레시피 (소모품 + 조리법) — 출력 영수증 + 자동 차감용</span>
              <button onClick={addRecipeLine} className="text-xs px-2 py-1 rounded bg-orange-500/20 border border-orange-500/40 text-orange-200">+ 라인</button>
            </div>
            {recipes.map((r, i) => (
              <div key={i} className="rounded-lg bg-white/[0.03] border border-white/10 p-2 mb-1.5 flex gap-1.5 items-center">
                <select
                  value={r.supply_id ?? ""}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) {
                      setRecipeLine(i, { supply_id: null })
                    } else {
                      const sup = supplies.find((s) => s.id === v)
                      setRecipeLine(i, { supply_id: v, display_name: sup?.name ?? "", unit: sup?.unit ?? "" })
                    }
                  }}
                  className="rounded bg-[#030814] border border-white/10 px-1.5 py-1 text-xs"
                >
                  <option value="">정보용 (차감 X)</option>
                  {supplies.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                </select>
                <input value={r.display_name} onChange={(e) => setRecipeLine(i, { display_name: e.target.value })}
                  placeholder="이름 (자유 텍스트도 가능)"
                  className="flex-1 rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs" />
                <input type="number" step="0.1" value={r.qty}
                  onChange={(e) => setRecipeLine(i, { qty: Number(e.target.value) })}
                  className="w-16 rounded bg-[#030814] border border-white/10 px-1.5 py-1 text-xs text-right" />
                <input value={r.unit} onChange={(e) => setRecipeLine(i, { unit: e.target.value })}
                  placeholder="단위"
                  className="w-12 rounded bg-[#030814] border border-white/10 px-1.5 py-1 text-xs" />
                <input value={r.note} onChange={(e) => setRecipeLine(i, { note: e.target.value })}
                  placeholder="비고 (예: 70도 스팀)"
                  className="w-32 rounded bg-[#030814] border border-white/10 px-1.5 py-1 text-xs" />
                <button onClick={() => removeRecipeLine(i)} className="text-red-400 text-xs">✕</button>
              </div>
            ))}
            <textarea value={prepNotes} onChange={(e) => setPrepNotes(e.target.value)}
              placeholder="조리 가이드 (영수증 출력 시 함께 인쇄됨)"
              rows={2}
              className="w-full mt-1.5 rounded bg-[#030814] border border-white/10 px-2 py-1.5 text-xs" />
          </div>

          <button onClick={add}
            className="w-full py-2.5 rounded-lg bg-cyan-500/30 border border-cyan-500/50 text-cyan-100 font-semibold text-sm">
            메뉴 추가
          </button>
        </div>

        {/* 메뉴 list */}
        {loading ? (
          <div className="p-10 text-center text-cyan-400 animate-pulse">불러오는 중…</div>
        ) : (
          <div className="space-y-2">
            {menu.map((m) => (
              <div key={m.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-2.5 flex items-center gap-3">
                {m.thumbnail_url || m.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbnail_url || m.image_url || ""} alt={m.name} className="w-14 h-14 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded bg-white/10 flex items-center justify-center text-xl flex-shrink-0">🍴</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{m.category} · {m.name}</div>
                  {m.description && <div className="text-[10px] text-slate-500 truncate">{m.description}</div>}
                  <div className="text-xs text-cyan-300 tabular-nums">₩{m.price.toLocaleString()}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => toggleActive(m.id, m.is_active)}
                    className={`px-2 py-1 rounded text-xs ${m.is_active ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-500/20 text-slate-400"}`}>
                    {m.is_active ? "활성" : "비활성"}
                  </button>
                  <button onClick={() => remove(m.id)}
                    className="px-2 py-1 rounded bg-red-500/20 text-red-300 text-xs">삭제</button>
                </div>
              </div>
            ))}
            {menu.length === 0 && <div className="p-6 text-center text-slate-500 text-sm">등록된 메뉴 없음</div>}
          </div>
        )}
      </div>
    </div>
  )
}
