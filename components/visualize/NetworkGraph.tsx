"use client"

/**
 * NetworkGraph — Jarvis-style 2D force-directed graph for the visualize
 * layer. Wraps `react-force-graph-2d` with NOX node/edge taxonomy.
 *
 * - Dark canvas background (page sets bg-[#0a0f1c]).
 * - Node color by `type` (store/manager/hostess/staff/session/settlement/payout/audit).
 * - Node tone by `status` (normal=type-color, warning=amber overlay, risk=red glow).
 * - Edge stroke by `type`+`status` — `risk`/`warning`/cross-store distinct.
 * - Click node → `onNodeSelect(node)`.
 * - Hover node → 1-hop neighbours emphasized, others dimmed.
 *
 * Performance:
 * - Caller must pre-cap nodes/edges (server already does ≤1500/≤5000).
 * - cooldownTicks bounded so the simulation settles quickly.
 * - Sticky positions across re-renders (react-force-graph re-uses the
 *   internal sim while the same node ids are kept).
 */

import { useEffect, useMemo, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import {
  edgeDash,
  edgeStatusColor,
  nodeBaseColor,
  nodeOverlayColor,
} from "@/lib/visualize/graph/legendConfig"
import type {
  NetworkEdge,
  NetworkNode,
  NetworkNodeType,
  NetworkStatus,
} from "@/lib/visualize/shapes"

// react-force-graph-2d's generic types are extremely strict and don't
// reconcile pre-mount string-id link endpoints with post-tick resolved
// node refs. We treat the component as an untyped boundary inside this
// wrapper — TypeScript doesn't help us here, the library's runtime API
// is what matters. All access is read-only / canvas drawing.
const ForceGraph2DAny = ForceGraph2D as unknown as React.ComponentType<
  Record<string, unknown>
>

type ForceMethods = {
  zoomToFit: (durationMs?: number, padding?: number) => void
  centerAt: (x?: number, y?: number, durationMs?: number) => void
  zoom: (k?: number, durationMs?: number) => void
}

type Props = {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  width: number
  height: number
  selectedNodeId?: string | null
  onNodeSelect?: (node: NetworkNode | null) => void
  /** P2.1u: parent-incremented counter — when it changes, the graph
   *  fits the full data set into the viewport. Pass a fresh number each
   *  time the user hits "전체 보기"; pass `undefined` to disable. */
  fitTrigger?: number
  /** P2.2: per-store activity counts (sessions+settlements+payouts).
   *  Used to dim empty stores so the operator's eye lands on the
   *  active ones. Map key is the store's `store_uuid` (NOT the node
   *  id). When undefined, all stores render at full opacity. */
  storeActivityByUuid?: ReadonlyMap<string, number>
}

// Force-graph internal node/link shapes — augmented at runtime with sim
// fields (x, y, vx, vy, etc.) by the library after the first tick. We
// preserve object identity across data updates (position cache) so the
// simulation doesn't reset every poll.
type GNode = {
  id: string
  __nox: NetworkNode
  type: NetworkNodeType
  status?: NetworkStatus
  weight: number
  label: string
  // Library-injected after first tick.
  x?: number
  y?: number
  vx?: number
  vy?: number
  // Pinned coordinates for store anchors (computed on every render).
  fx?: number
  fy?: number
}

type GLink = {
  source: string | GNode
  target: string | GNode
  __nox: NetworkEdge
  type: string
  status?: NetworkStatus
  weight: number
}

// Floor → x-column coordinate. NOX building covers floors 5–8.
function floorColumnX(floor: number): number {
  // 4 columns, centered around 0, 220px apart: -330, -110, +110, +330.
  const col = Math.max(5, Math.min(8, floor)) - 5 // 0..3
  return (col - 1.5) * 220
}

// Node/edge colour palette is owned by `lib/visualize/graph/legendConfig.ts`.
// We re-export thin facade helpers there so this canvas drawer and the
// legend UI stay in sync automatically.

function nodeRadius(node: GNode): number {
  // Risk nodes get a 1.4× size bump so they pop without animation.
  const riskMul = node.status === "risk" ? 1.4 : 1
  if (node.type === "store") return (9 + node.weight * 4) * riskMul
  if (node.type === "session") return (4 + node.weight * 3) * riskMul
  if (node.type === "settlement" || node.type === "payout") return (3 + node.weight * 3) * riskMul
  if (node.type === "audit") return (2 + node.weight * 2) * riskMul
  // person nodes
  return (4 + node.weight * 3) * riskMul
}

export default function NetworkGraph({
  nodes,
  edges,
  width,
  height,
  selectedNodeId,
  onNodeSelect,
  fitTrigger,
  storeActivityByUuid,
}: Props) {
  const fgRef = useRef<ForceMethods | null>(null)

  // Position cache — keyed by node id. Preserves x/y/vx/vy across polling
  // updates so the simulation doesn't restart every 30s.
  const nodeCacheRef = useRef<Map<string, GNode>>(new Map())

  // Map nodes/edges into force-graph shape. Same id → SAME object reference
  // so the library reuses simulation state. New ids → fresh objects (placed
  // randomly by the simulation on first tick).
  const data = useMemo(() => {
    // Group store nodes by floor so we can pin them in floor columns.
    const storesByFloor = new Map<number, NetworkNode[]>()
    for (const n of nodes) {
      if (n.type !== "store") continue
      const floor = typeof n.meta?.floor === "number" ? n.meta.floor : 0
      const arr = storesByFloor.get(floor) ?? []
      arr.push(n)
      storesByFloor.set(floor, arr)
    }
    // Sort within each floor by label for stable layout.
    for (const arr of storesByFloor.values()) {
      arr.sort((a, b) => a.label.localeCompare(b.label, "ko"))
    }

    const nextIds = new Set<string>()
    const gNodes: GNode[] = []
    for (const n of nodes) {
      nextIds.add(n.id)
      let g = nodeCacheRef.current.get(n.id)
      if (g) {
        // Update mutable fields in place — preserve x/y/vx/vy on the same ref.
        g.__nox = n
        g.type = n.type
        g.status = n.status
        g.weight = typeof n.weight === "number" ? n.weight : 0.3
        g.label = n.label
      } else {
        g = {
          id: n.id,
          __nox: n,
          type: n.type,
          status: n.status,
          weight: typeof n.weight === "number" ? n.weight : 0.3,
          label: n.label,
        }
        nodeCacheRef.current.set(n.id, g)
      }

      // Store anchors: pin to floor column. Other types: clear any prior
      // pin (a node could change shape across rounds, defensively).
      if (n.type === "store") {
        const floor = typeof n.meta?.floor === "number" ? n.meta.floor : 0
        const list = storesByFloor.get(floor) ?? []
        const idx = list.indexOf(n)
        const total = list.length
        const row = total > 0 ? idx - (total - 1) / 2 : 0
        g.fx = floorColumnX(floor)
        g.fy = row * 90
      } else {
        g.fx = undefined
        g.fy = undefined
      }
      gNodes.push(g)
    }
    // Drop stale node entries so the cache doesn't grow without bound.
    for (const id of Array.from(nodeCacheRef.current.keys())) {
      if (!nextIds.has(id)) nodeCacheRef.current.delete(id)
    }

    // Links: rebuild every time. Force-graph re-resolves source/target from
    // string id to node ref each update; positions live on NODES, so this
    // is cheap and correct.
    const gLinks: GLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      status: e.status,
      weight: typeof e.weight === "number" ? e.weight : 0.3,
      __nox: e,
    }))

    return { nodes: gNodes, links: gLinks }
  }, [nodes, edges])

  // Adjacency for hover dim — recomputed only when topology changes.
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, new Set())
      if (!m.has(e.target)) m.set(e.target, new Set())
      m.get(e.source)!.add(e.target)
      m.get(e.target)!.add(e.source)
    }
    return m
  }, [edges])

  const [hoverId, setHoverId] = useState<string | null>(null)

  // P2.1u: explicit "fit to viewport" — fired when the parent
  // increments `fitTrigger`. Distinct from the auto-fit on big-delta
  // (which only fires when node count changes substantially).
  useEffect(() => {
    if (fitTrigger == null) return
    const fg = fgRef.current
    if (!fg) return
    try {
      fg.zoomToFit(400, 60)
    } catch {
      // pre-tick or empty graph — ignore
    }
  }, [fitTrigger])

  // P2.1o: pan/zoom to selectedNode when selection changes. We wait
  // briefly for the simulation to assign x/y on first render, and skip
  // when the node has no resolved position yet (will retry on next
  // selection change). Centering on null selection is a no-op so user
  // pan/zoom isn't reset on background clicks.
  useEffect(() => {
    if (!selectedNodeId) return
    const fg = fgRef.current
    if (!fg) return
    const node = nodeCacheRef.current.get(selectedNodeId)
    if (!node) return
    const tryCenter = () => {
      if (typeof node.x !== "number" || typeof node.y !== "number") return false
      try {
        fg.centerAt(node.x, node.y, 600)
        // Modest zoom (~2x) to help peer navigation. Avoid extreme zoom
        // so the user retains spatial context.
        fg.zoom(2, 600)
      } catch {
        // Library may throw if called before first tick — ignore.
      }
      return true
    }
    if (tryCenter()) return
    // Position not yet resolved — retry once after the simulation has
    // had a moment to place the node.
    const t = window.setTimeout(tryCenter, 400)
    return () => window.clearTimeout(t)
  }, [selectedNodeId])

  // Re-zoom-to-fit when data size changes substantially. Skip for incremental
  // polls (small delta) so we don't fight the user's pan/zoom.
  const lastNodeCountRef = useRef(0)
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const prev = lastNodeCountRef.current
    const next = nodes.length
    if (prev === 0 || Math.abs(next - prev) > Math.max(50, prev * 0.25)) {
      // First render or large delta → fit to viewport.
      const id = window.setTimeout(() => fg.zoomToFit(400, 60), 100)
      lastNodeCountRef.current = next
      return () => window.clearTimeout(id)
    }
    lastNodeCountRef.current = next
  }, [nodes.length])

  function isHighlighted(id: string): boolean {
    if (!hoverId && !selectedNodeId) return true
    if (selectedNodeId === id) return true
    if (hoverId === id) return true
    if (selectedNodeId) {
      const n = adjacency.get(selectedNodeId)
      if (n?.has(id)) return true
    }
    if (hoverId) {
      const n = adjacency.get(hoverId)
      if (n?.has(id)) return true
    }
    return false
  }

  return (
    <div
      className="rounded border border-slate-800 overflow-hidden"
      style={{ width, height, background: "#070d1a" }}
    >
      <ForceGraph2DAny
        ref={fgRef}
        graphData={data}
        width={width}
        height={height}
        backgroundColor="#070d1a"
        cooldownTicks={120}
        // No labels by default (canvas labels get noisy); we paint our own
        // selectively in the canvas hook below.
        nodeLabel={(n: unknown) => (n as GNode).__nox.label}
        linkDirectionalArrowLength={(l: unknown) => {
          const t = (l as GLink).type
          // Show arrow only on directional edges that carry semantic flow.
          if (t === "owes_to" || t === "paid_to" || t === "produced" || t === "worked_at" || t === "transferred") {
            return 4
          }
          return 0
        }}
        linkDirectionalArrowRelPos={0.92}
        linkWidth={(l: unknown) => {
          const link = l as GLink
          const w = 0.5 + link.weight * 2.2
          return w
        }}
        linkColor={(l: unknown) => {
          const link = l as GLink
          return edgeStatusColor(link.status, link.type)
        }}
        linkLineDash={(l: unknown) => {
          const link = l as GLink
          return edgeDash(link.status, link.type)
        }}
        nodeRelSize={1}
        nodeVal={(n: unknown) => {
          const r = nodeRadius(n as GNode)
          return r * r // ForceGraph treats nodeVal as area; r² approximates radius scaling
        }}
        nodeCanvasObjectMode={() => "after"}
        nodeCanvasObject={(n: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          const node = n as GNode
          const x = node.x ?? 0
          const y = node.y ?? 0
          const r = nodeRadius(node)
          const base = nodeBaseColor(node.type)
          const overlay = nodeOverlayColor(node.status)
          const dim = !isHighlighted(node.id as string)

          // P2.2: empty stores (no activity today) dimmed to 30% so the
          // operator's eye lands on the active ones.
          let activityAlpha = 1.0
          if (
            node.type === "store" &&
            storeActivityByUuid &&
            node.__nox.store_uuid &&
            (storeActivityByUuid.get(node.__nox.store_uuid) ?? 0) === 0
          ) {
            activityAlpha = 0.3
          }
          const alpha = (dim ? 0.25 : 1.0) * activityAlpha

          // Outer glow:
          //   - risk → red glow, 2.6× radius (stronger than other states)
          //   - active store → amber glow, 2.2×
          //   - warning → muted glow
          // Empty stores skip the glow entirely (matching their dim).
          const isRisk = node.status === "risk"
          const isActiveStore = node.type === "store" && activityAlpha === 1.0
          const isWarning = node.status === "warning"
          if (isRisk || isActiveStore || isWarning) {
            const glowR = isRisk ? r * 2.6 : isActiveStore ? r * 2.2 : r * 1.8
            const glowAlpha = isRisk ? alpha * 0.7 : alpha * 0.5
            ctx.save()
            ctx.globalAlpha = glowAlpha
            ctx.beginPath()
            ctx.arc(x, y, glowR, 0, 2 * Math.PI)
            const grad = ctx.createRadialGradient(x, y, r, x, y, glowR)
            grad.addColorStop(0, overlay ?? base)
            grad.addColorStop(1, "rgba(0,0,0,0)")
            ctx.fillStyle = grad
            ctx.fill()
            ctx.restore()
          }

          // Body
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.beginPath()
          ctx.arc(x, y, r, 0, 2 * Math.PI)
          ctx.fillStyle = overlay ?? base
          ctx.fill()
          // Selection ring — risk gets a red ring, others white.
          if (selectedNodeId === node.id) {
            ctx.lineWidth = 2 / globalScale
            ctx.strokeStyle = isRisk ? "#fda4af" : "#ffffff"
            ctx.stroke()
          } else if (isRisk) {
            // Always-on red outline for risk so they're visible without
            // selection.
            ctx.lineWidth = 1.5 / globalScale
            ctx.strokeStyle = "#fecaca"
            ctx.stroke()
          }
          ctx.restore()

          // Label policy:
          //   - active stores always
          //   - empty stores never (avoid noise on dimmed stores)
          //   - risk node always (so operator sees what's wrong)
          //   - hovered / selected always
          //   - persons at high zoom
          const isEmptyStore = node.type === "store" && activityAlpha < 1.0
          const showLabel =
            (node.type === "store" && !isEmptyStore) ||
            isRisk ||
            hoverId === node.id ||
            selectedNodeId === node.id ||
            (globalScale > 1.5 && (node.type === "manager" || node.type === "hostess"))
          if (showLabel) {
            ctx.save()
            ctx.globalAlpha = alpha
            const fontSize = Math.max(10, 11 / Math.min(globalScale, 2))
            ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
            ctx.textAlign = "center"
            ctx.textBaseline = "top"
            ctx.fillStyle = "rgba(0,0,0,0.55)"
            const text = node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label
            const w = ctx.measureText(text).width
            ctx.fillRect(x - w / 2 - 3, y + r + 1, w + 6, fontSize + 4)
            ctx.fillStyle = isRisk ? "#fecaca" : "#e2e8f0"
            ctx.fillText(text, x, y + r + 3)
            ctx.restore()
          }
        }}
        onNodeHover={(n: unknown) => {
          const id = n ? ((n as GNode).id as string) : null
          setHoverId(id)
        }}
        onNodeClick={(n: unknown) => {
          if (!onNodeSelect) return
          const node = (n as GNode | null)?.__nox ?? null
          onNodeSelect(node)
        }}
        onBackgroundClick={() => {
          if (onNodeSelect) onNodeSelect(null)
        }}
      />
    </div>
  )
}
