"use client"

import { useState, useEffect, useRef } from "react"

type CustomerItem = {
  id: string
  name: string
  phone: string | null
  memo: string | null
}

type Props = {
  currentName: string | null
  currentPartySize: number
  busy: boolean
  onClose: () => void
  onSave: (data: {
    customer_id: string | null
    customer_name_snapshot: string
    customer_party_size: number
  }) => void
  onSearch: (q: string) => Promise<CustomerItem[]>
  onCreate: (data: { name: string; phone?: string }) => Promise<CustomerItem | null>
}

export default function CustomerModal({
  currentName, currentPartySize, busy,
  onClose, onSave, onSearch, onCreate,
}: Props) {
  const [tab, setTab] = useState<"search" | "new">("search")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<CustomerItem[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<CustomerItem | null>(null)
  const [nameInput, setNameInput] = useState(currentName ?? "")
  const [partySize, setPartySize] = useState(currentPartySize || 1)
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (searchRef.current) searchRef.current.focus()
  }, [])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await onSearch(query.trim())
        setResults(r)
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Load recent on mount
  useEffect(() => {
    onSearch("").then(r => setResults(r)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSelect(c: CustomerItem) {
    setSelected(c)
    setNameInput(c.name)
    setTab("search")
  }

  function handleSave() {
    const name = nameInput.trim()
    if (!name) return
    onSave({
      customer_id: selected?.id ?? null,
      customer_name_snapshot: name,
      customer_party_size: partySize,
    })
  }

  async function handleCreateAndSelect() {
    if (!newName.trim()) return
    const created = await onCreate({
      name: newName.trim(),
      phone: newPhone.trim() || undefined,
    })
    if (created) {
      handleSelect(created)
      setTab("search")
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed z-50 bg-[#0d1020] border border-white/10 rounded-xl overflow-hidden shadow-2xl shadow-black/60 flex flex-col left-1/2 -translate-x-1/2 top-[20%] w-[92vw] max-w-[420px]" style={{ maxHeight: "min(340px, 55vh)" }}>

        {/* Header — compact */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
          <span className="text-sm font-bold">손님 정보</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Name + party size — single compact row */}
        <div className="px-3 py-2 border-b border-white/10">
          <div className="flex gap-2 items-end">
            <div className="flex-1 min-w-0">
              <label className="text-[9px] text-slate-500 mb-px block">이름</label>
              <input
                value={nameInput}
                onChange={e => { setNameInput(e.target.value); setSelected(null) }}
                placeholder="손님 이름"
                className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
              />
            </div>
            <div className="w-20 flex-shrink-0">
              <label className="text-[9px] text-slate-500 mb-px block">인원</label>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setPartySize(p => Math.max(0, p - 1))}
                  className="w-7 h-[30px] rounded-md bg-white/5 border border-white/10 text-slate-300 text-sm hover:bg-white/10"
                >-</button>
                <span className="flex-1 text-center text-xs font-bold text-white">{partySize}</span>
                <button
                  onClick={() => setPartySize(p => p + 1)}
                  className="w-7 h-[30px] rounded-md bg-white/5 border border-white/10 text-slate-300 text-sm hover:bg-white/10"
                >+</button>
              </div>
            </div>
          </div>
          {selected && (
            <div className="text-[9px] text-cyan-400 mt-1">
              선택됨: {selected.name}{selected.phone ? ` (${selected.phone})` : ""}
            </div>
          )}
        </div>

        {/* Tabs — slim */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setTab("search")}
            className={`flex-1 py-1.5 text-[11px] font-semibold ${tab === "search" ? "text-cyan-300 border-b-2 border-cyan-400" : "text-slate-400"}`}
          >검색</button>
          <button
            onClick={() => setTab("new")}
            className={`flex-1 py-1.5 text-[11px] font-semibold ${tab === "new" ? "text-cyan-300 border-b-2 border-cyan-400" : "text-slate-400"}`}
          >신규 등록</button>
        </div>

        {/* Content — scrollable, compact */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === "search" ? (
            <div className="p-2 space-y-1.5">
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="이름 또는 전화번호..."
                className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[11px] outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
              />
              {searching && <div className="text-center text-slate-500 text-[10px] py-1 animate-pulse">검색 중...</div>}
              {results.length === 0 && !searching && (
                <div className="text-center text-slate-500 text-[10px] py-2">
                  {query ? "결과 없음" : "최근 손님 없음"}
                </div>
              )}
              {results.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-left text-[11px] transition-colors ${
                    selected?.id === c.id
                      ? "bg-cyan-500/15 border border-cyan-500/30"
                      : "bg-white/[0.03] border border-white/[0.06] hover:bg-white/5"
                  }`}
                >
                  <div className="min-w-0 truncate">
                    <span className="text-white font-medium">{c.name}</span>
                    {c.memo && <span className="text-slate-500 ml-1">{c.memo}</span>}
                  </div>
                  {c.phone && <span className="text-slate-400 flex-shrink-0 ml-2">{c.phone}</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-3 space-y-2">
              <div>
                <label className="text-[9px] text-slate-500 mb-px block">이름</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="손님 이름"
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                />
              </div>
              <div>
                <label className="text-[9px] text-slate-500 mb-px block">전화번호 (선택)</label>
                <input
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  placeholder="010-xxxx-xxxx"
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-xs outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
                />
              </div>
              <button
                onClick={handleCreateAndSelect}
                disabled={busy || !newName.trim()}
                className="w-full py-2 rounded-md bg-cyan-500/80 text-white text-xs font-semibold disabled:opacity-40 hover:bg-cyan-500 transition-colors"
              >등록 후 선택</button>
            </div>
          )}
        </div>

        {/* Footer — compact */}
        <div className="px-3 py-2 border-t border-white/10 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-md bg-white/5 text-slate-300 text-xs hover:bg-white/10"
          >취소</button>
          <button
            onClick={handleSave}
            disabled={busy || !nameInput.trim()}
            className="flex-1 py-2 rounded-md bg-cyan-500/80 text-white text-xs font-semibold disabled:opacity-40 hover:bg-cyan-500 transition-colors"
          >저장</button>
        </div>
      </div>
    </>
  )
}
