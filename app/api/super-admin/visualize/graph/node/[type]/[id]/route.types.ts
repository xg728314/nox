/**
 * /api/super-admin/visualize/graph/node — shared types.
 *
 * 2026-05-03: route.ts 분할.
 */

import type { NetworkNodeType } from "@/lib/visualize/shapes"

export type NodeDetailResponse = {
  as_of: string
  type: NetworkNodeType
  id: string
  store_uuid: string | null
  label: string
  /** Primary stored fields for this entity. PII auto-masked. */
  primary: Record<string, unknown>
  /** Summary counts / linked-entity ids for context. */
  relations: Record<string, unknown>
  source_tables: string[]
  warnings: string[]
}
