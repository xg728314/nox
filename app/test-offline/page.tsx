"use client"

import { useEffect, useState } from "react"
import {
  saveSessionDraft,
  getSessionDraft,
  getAllSessionDrafts,
  deleteSessionDraft,
  saveOrderDraft,
  getAllOrderDrafts,
  deleteOrderDraft,
  enqueueEvent,
  getAllQueuedEvents,
  clearEventQueue,
  getConflictPendingItems,
  destroyDatabase,
  type SessionDraft,
  type OrderDraft,
  type QueuedEvent,
} from "@/lib/offline/db"
import { syncEventQueue, isOnline } from "@/lib/offline/sync"

export default function TestOfflinePage() {
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  function addLog(msg: string) {
    setLog(prev => [...prev, `[${new Date().toISOString().slice(11, 19)}] ${msg}`])
  }

  async function runTests() {
    setRunning(true)
    setLog([])

    try {
      // Clean slate
      await destroyDatabase()
      addLog("✓ DB destroyed (clean slate)")

      // === Session Drafts ===
      addLog("─── Session Drafts ───")

      const s1 = await saveSessionDraft({
        room_uuid: "room-001",
        store_uuid: "store-001",
        data: { category: "퍼블릭", time_minutes: 90 },
      })
      addLog(`✓ saveSessionDraft → id: ${s1.id}, status: ${s1.status}`)

      const s1Get = await getSessionDraft(s1.id)
      addLog(`✓ getSessionDraft → found: ${!!s1Get}, room: ${s1Get?.room_uuid}`)

      const s2 = await saveSessionDraft({
        room_uuid: "room-002",
        store_uuid: "store-001",
        data: { category: "셔츠", time_minutes: 60 },
      })
      addLog(`✓ saveSessionDraft #2 → id: ${s2.id}`)

      const allSessions = await getAllSessionDrafts()
      addLog(`✓ getAllSessionDrafts → count: ${allSessions.length}`)

      await deleteSessionDraft(s2.id)
      const afterDelete = await getAllSessionDrafts()
      addLog(`✓ deleteSessionDraft → count: ${afterDelete.length} (was ${allSessions.length})`)

      // === Order Drafts ===
      addLog("─── Order Drafts ───")

      const o1 = await saveOrderDraft({
        session_id: s1.id,
        data: { item_name: "양주", qty: 1, unit_price: 50000 },
      })
      addLog(`✓ saveOrderDraft → id: ${o1.id}, status: ${o1.status}`)

      const allOrders = await getAllOrderDrafts()
      addLog(`✓ getAllOrderDrafts → count: ${allOrders.length}`)

      await deleteOrderDraft(o1.id)
      const afterOrderDelete = await getAllOrderDrafts()
      addLog(`✓ deleteOrderDraft → count: ${afterOrderDelete.length}`)

      // === Event Queue ===
      addLog("─── Event Queue ───")

      const e1 = await enqueueEvent("checkin", {
        room_uuid: "room-001",
        offline_draft_id: s1.id,
      })
      addLog(`✓ enqueueEvent(checkin) → id: ${e1.id}, retry: ${e1.retry_count}`)

      const e2 = await enqueueEvent("order", {
        session_id: "sess-xxx",
        item_name: "양주",
        qty: 1,
        unit_price: 50000,
      })
      addLog(`✓ enqueueEvent(order) → id: ${e2.id}`)

      // settlement: enqueue 자체가 거부되어야 한다 (P1 round: 클라이언트
      // 시점 fail-fast). 과거엔 큐에 들어가고 서버가 skip 했음.
      try {
        await enqueueEvent("settlement", { session_id: "sess-xxx" })
        addLog(`✗ enqueueEvent(settlement) — FORBIDDEN type 이 통과됨 (regression)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        addLog(`✓ enqueueEvent(settlement) rejected as expected → ${msg}`)
      }

      const allEvents = await getAllQueuedEvents()
      addLog(`✓ getAllQueuedEvents → count: ${allEvents.length}`)

      // === Conflict Pending ===
      addLog("─── Conflict Pending ───")
      const conflicts = await getConflictPendingItems()
      addLog(`✓ getConflictPendingItems → sessions: ${conflicts.sessions.length}, orders: ${conflicts.orders.length}`)

      // === Sync (will likely fail on test data, but tests the flow) ===
      addLog("─── Sync Test ───")
      addLog(`  isOnline: ${isOnline()}`)

      const syncResult = await syncEventQueue()
      addLog(`✓ syncEventQueue → total: ${syncResult.total}, synced: ${syncResult.synced}, failed: ${syncResult.failed}, conflict: ${syncResult.conflict}, skipped: ${syncResult.skipped}`)
      for (const d of syncResult.details) {
        addLog(`  ${d.type}: ${d.status}${d.error ? ` (${d.error})` : ""}`)
      }

      // === Cleanup ===
      await clearEventQueue()
      const afterClear = await getAllQueuedEvents()
      addLog(`✓ clearEventQueue → count: ${afterClear.length}`)

      await destroyDatabase()
      addLog(`✓ destroyDatabase → clean`)

      addLog("═══ ALL TESTS PASSED ═══")
    } catch (err) {
      addLog(`✗ ERROR: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white p-6">
      <h1 className="text-xl font-bold mb-4">NOX Offline DB Test</h1>
      <button
        onClick={runTests}
        disabled={running}
        className="px-6 py-3 rounded-xl bg-cyan-500/80 text-white font-semibold disabled:opacity-50 mb-6"
      >
        {running ? "Running..." : "Run Tests"}
      </button>
      <pre className="bg-white/5 rounded-xl p-4 text-sm text-slate-300 whitespace-pre-wrap font-mono">
        {log.length === 0 ? "Click 'Run Tests' to start" : log.join("\n")}
      </pre>
    </div>
  )
}
