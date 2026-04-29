"use client"

/**
 * Sankey — d3-sankey layout + visx primitives.
 *
 * Generic wrapper. Caller supplies nodes/links; we compute layout and
 * render rectangles + curved links. Color/dash style is selected by the
 * `kind` field on each link so the consumer can encode reversal,
 * deduction, cross-store, etc., without re-implementing layout.
 */

import { useMemo } from "react"
import { Group } from "@visx/group"
import {
  sankey as d3Sankey,
  sankeyLinkHorizontal,
  sankeyJustify,
  type SankeyExtraProperties,
  type SankeyNode,
  type SankeyLink,
} from "d3-sankey"

export type SankeyNodeInput = {
  id: string
  label: string
  /** Style hint for the node (color group). */
  group?: string
  /** Display amount; not used by layout (link weights drive that). */
  amount?: number
  /** When true, label shows "(계산값)" suffix. */
  derived?: boolean
}

export type SankeyLinkInput = {
  source: string
  target: string
  amount: number
  /** Style hint for the link (color/dash). */
  kind?: string
}

type Props = {
  nodes: SankeyNodeInput[]
  links: SankeyLinkInput[]
  width: number
  height: number
  /** Map node.group → fill color. Unknown groups fall back to default. */
  nodeColor?: (group: string | undefined) => string
  /** Map link.kind → stroke. Unknown kinds fall back to default. */
  linkStroke?: (kind: string | undefined) => string
  /** Map link.kind → strokeDasharray. Unknown kinds fall back to undefined. */
  linkDash?: (kind: string | undefined) => string | undefined
  /** Number formatter for tooltips. */
  format?: (n: number) => string
}

const DEFAULT_NODE_COLOR: Record<string, string> = {
  source: "#0ea5e9",
  aggregate: "#6366f1",
  allocation: "#a855f7",
  sink: "#10b981",
  reversal: "#ef4444",
}

const DEFAULT_LINK_STROKE: Record<string, string> = {
  primary: "#64748b",
  deduction: "#f59e0b",
  cross_store: "#06b6d4",
  reversal: "#ef4444",
  outstanding: "#a855f7",
}

const DEFAULT_LINK_DASH: Record<string, string> = {
  reversal: "4 3",
  deduction: "2 2",
}

export default function Sankey({
  nodes,
  links,
  width,
  height,
  nodeColor,
  linkStroke,
  linkDash,
  format = (n) => n.toLocaleString(),
}: Props) {
  // d3-sankey mutates input. Build fresh copies. Filter zero-weight links —
  // d3-sankey treats them as 1-pixel edges and they create visual noise.
  const layout = useMemo(() => {
    const idToIdx = new Map<string, number>()
    const nodesCopy = nodes.map((n, i) => {
      idToIdx.set(n.id, i)
      return { ...n }
    })
    const linksCopy = links
      .filter((l) => l.amount > 0 && idToIdx.has(l.source) && idToIdx.has(l.target))
      .map((l) => ({
        ...l,
        source: idToIdx.get(l.source)!,
        target: idToIdx.get(l.target)!,
        value: l.amount,
      }))

    if (nodesCopy.length === 0 || linksCopy.length === 0) {
      return { nodes: [], links: [] }
    }

    type SNode = (typeof nodesCopy)[number] & {
      x0?: number; x1?: number; y0?: number; y1?: number
    }
    type SLink = (typeof linksCopy)[number] & {
      source: SNode | number; target: SNode | number; width?: number
    }

    const sankeyGen = d3Sankey<SNode, SLink>()
      .nodeId((d: SNode) => d.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(14)
      .nodePadding(12)
      .extent([
        [1, 1],
        [Math.max(1, width - 1), Math.max(1, height - 1)],
      ])

    try {
      const result = sankeyGen({
        nodes: nodesCopy as SNode[],
        links: linksCopy as unknown as SLink[],
      })
      return result
    } catch {
      // d3-sankey throws on cycles. Phase 1 graph is acyclic, but defend.
      return { nodes: [], links: [] }
    }
  }, [nodes, links, width, height])

  if (layout.nodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-slate-400 border border-dashed border-slate-700 rounded"
        style={{ width, height }}
      >
        흐름 데이터 없음
      </div>
    )
  }

  const linkPath = sankeyLinkHorizontal<SankeyExtraProperties, SankeyExtraProperties>()

  const resolveNodeColor = (group: string | undefined) => {
    if (nodeColor) return nodeColor(group)
    return (group && DEFAULT_NODE_COLOR[group]) || "#64748b"
  }
  const resolveLinkStroke = (kind: string | undefined) => {
    if (linkStroke) return linkStroke(kind)
    return (kind && DEFAULT_LINK_STROKE[kind]) || "#475569"
  }
  const resolveLinkDash = (kind: string | undefined) => {
    if (linkDash) return linkDash(kind)
    return kind ? DEFAULT_LINK_DASH[kind] : undefined
  }

  return (
    <svg width={width} height={height} role="img" aria-label="Money flow sankey">
      <Group>
        {/* Links first so nodes paint on top */}
        {layout.links.map((l, i) => {
          const d = linkPath(l as unknown as never) ?? ""
          const kind = (l as unknown as { kind?: string }).kind
          const stroke = resolveLinkStroke(kind)
          const dash = resolveLinkDash(kind)
          const w = Math.max(1, (l as unknown as { width?: number }).width ?? 1)
          const amount = (l as unknown as { value: number }).value
          return (
            <path
              key={`l-${i}`}
              d={d}
              fill="none"
              stroke={stroke}
              strokeOpacity={0.45}
              strokeWidth={w}
              strokeDasharray={dash}
            >
              <title>{`${amount.toLocaleString()}원${kind ? ` · ${kind}` : ""}`}</title>
            </path>
          )
        })}

        {/* Nodes */}
        {layout.nodes.map((n, i) => {
          const x0 = (n as unknown as { x0?: number }).x0 ?? 0
          const x1 = (n as unknown as { x1?: number }).x1 ?? 0
          const y0 = (n as unknown as { y0?: number }).y0 ?? 0
          const y1 = (n as unknown as { y1?: number }).y1 ?? 0
          const nodeAny = n as unknown as SankeyNodeInput
          const fill = resolveNodeColor(nodeAny.group)
          const labelOnLeft = x0 < width / 2
          const label = nodeAny.derived
            ? `${nodeAny.label}`
            : nodeAny.label
          const amountText =
            typeof nodeAny.amount === "number" ? format(nodeAny.amount) : ""
          return (
            <g key={`n-${i}`}>
              <rect
                x={x0}
                y={y0}
                width={Math.max(1, x1 - x0)}
                height={Math.max(1, y1 - y0)}
                fill={fill}
                fillOpacity={0.85}
                stroke={fill}
              >
                <title>
                  {`${nodeAny.label}${nodeAny.derived ? " (계산값)" : ""}\n${amountText}원`}
                </title>
              </rect>
              <text
                x={labelOnLeft ? x1 + 6 : x0 - 6}
                y={(y0 + y1) / 2}
                dy="0.35em"
                textAnchor={labelOnLeft ? "start" : "end"}
                fontSize={11}
                fill="#cbd5e1"
              >
                {label}
                {nodeAny.derived ? " ⓘ" : ""}
              </text>
              {amountText && (
                <text
                  x={labelOnLeft ? x1 + 6 : x0 - 6}
                  y={(y0 + y1) / 2 + 12}
                  dy="0.35em"
                  textAnchor={labelOnLeft ? "start" : "end"}
                  fontSize={10}
                  fill="#94a3b8"
                >
                  {amountText}
                </text>
              )}
            </g>
          )
        })}
      </Group>
    </svg>
  )
}
