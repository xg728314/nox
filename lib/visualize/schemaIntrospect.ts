/**
 * Visualize layer — schema introspection helpers.
 *
 * These wrap `information_schema` queries so the visualize layer can:
 *   - Check column existence at runtime (Q10 manager_prepayments fallback).
 *   - Drive auto-discovery views (Phase 2 entity graph) without hardcoding
 *     column lists.
 *
 * Cached per warm function instance (60s TTL) to keep introspection cheap.
 */

import { getReadClient } from "./readClient"

type ColumnEntry = {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: "YES" | "NO"
}

const CACHE_TTL_MS = 60_000

let _cache: { at: number; columns: Map<string, Map<string, ColumnEntry>> } | null = null

async function loadColumns(): Promise<Map<string, Map<string, ColumnEntry>>> {
  const now = Date.now()
  if (_cache && now - _cache.at < CACHE_TTL_MS) {
    return _cache.columns
  }
  // Supabase REST does NOT expose `information_schema` by default. We
  // try once and degrade silently — the visualize layer must NEVER 500
  // because of introspection. All callers must tolerate an empty map.
  try {
    const client = getReadClient()
    const { data, error } = await client
      .from("information_schema.columns")
      .select("table_name, column_name, data_type, is_nullable")
      .eq("table_schema", "public")
    if (error) {
      if (_cache) return _cache.columns
      _cache = { at: now, columns: new Map() }
      return _cache.columns
    }
    const map = new Map<string, Map<string, ColumnEntry>>()
    for (const row of (data ?? []) as ColumnEntry[]) {
      if (!map.has(row.table_name)) map.set(row.table_name, new Map())
      map.get(row.table_name)!.set(row.column_name, row)
    }
    _cache = { at: now, columns: map }
    return map
  } catch (e) {
    // Network/parse/REST exposure errors all land here.
    console.warn(
      `[visualize.introspect] information_schema unavailable: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
    if (_cache) return _cache.columns
    _cache = { at: now, columns: new Map() }
    return _cache.columns
  }
}

/**
 * Returns true when `public.<table>.<column>` exists.
 * Returns false (not throws) on introspection failure — callers decide
 * how to fallback.
 */
export async function tableHasColumn(
  table: string,
  column: string,
): Promise<boolean> {
  const map = await loadColumns()
  const cols = map.get(table)
  return !!cols && cols.has(column)
}

/**
 * Returns true when `public.<table>` exists at all.
 */
export async function tableExists(table: string): Promise<boolean> {
  const map = await loadColumns()
  return map.has(table)
}

/**
 * Returns the list of column names for a table (empty array on miss).
 */
export async function listColumns(table: string): Promise<string[]> {
  const map = await loadColumns()
  const cols = map.get(table)
  if (!cols) return []
  return Array.from(cols.keys())
}

/**
 * Test-only: clears the introspection cache. NEVER call from production
 * code paths — it forces a re-fetch on the next call.
 */
export function __resetIntrospectCacheForTests(): void {
  _cache = null
}
