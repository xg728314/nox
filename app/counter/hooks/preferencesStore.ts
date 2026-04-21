"use client"

/**
 * preferencesStore — module-level shared store for counter preferences.
 *
 * Two kinds of preference layers share this store, each with its own
 * scope slot space:
 *
 *   - "user"   — personal prefs via /api/me/preferences
 *   - "forced" — admin-forced overrides via /api/admin/preferences
 *
 * Runtime precedence (applied by consumer hooks):
 *   forced_per_store > forced_global > user_per_store > user_global > DEFAULT
 *
 * Store responsibilities:
 *   - one snapshot per (kind, scope), shared by every live hook instance
 *   - `useSyncExternalStore` friendly (stable snapshot reference until change)
 *   - first consumer per (kind, scope) triggers a single fetch
 *   - optimistic mutations; rollback on non-2xx / thrown
 *   - mutations broadcast to all subscribers → live propagation without reload
 *
 * Domain rules (normalization, role filtering, locked items) are enforced
 * by callers (editors / resolveMenu / WidgetRenderer), not by the store.
 */

import { apiFetch } from "@/lib/apiFetch"

export type PrefResp<T> = {
  global: T | null
  per_store: Record<string, T>
}

export type PrefSnapshot<T> = {
  resp: PrefResp<T> | null
  loading: boolean
  loaded: boolean
}

type Slot<T> = {
  snapshot: PrefSnapshot<T>
  inFlight: boolean
  listeners: Set<() => void>
}

type PrefKind = "user" | "forced"

const EMPTY: PrefSnapshot<unknown> = { resp: null, loading: false, loaded: false }

// Single Map keyed by `${kind}:${scope}`. Snapshot references are replaced
// on every mutation so useSyncExternalStore sees a fresh identity.
const slots = new Map<string, Slot<unknown>>()

function slotKey(kind: PrefKind, scope: string): string {
  return `${kind}:${scope}`
}

function getSlot<T>(kind: PrefKind, scope: string): Slot<T> {
  const key = slotKey(kind, scope)
  let s = slots.get(key) as Slot<T> | undefined
  if (!s) {
    s = {
      snapshot: { ...(EMPTY as PrefSnapshot<T>) },
      inFlight: false,
      listeners: new Set(),
    }
    slots.set(key, s as unknown as Slot<unknown>)
  }
  return s
}

function notify(slot: Slot<unknown>) {
  for (const l of slot.listeners) l()
}

function setSnapshot<T>(slot: Slot<T>, next: PrefSnapshot<T>) {
  slot.snapshot = next
  notify(slot as unknown as Slot<unknown>)
}

function endpointFor(kind: PrefKind): string {
  return kind === "user" ? "/api/me/preferences" : "/api/admin/preferences"
}

// ── Generic core (kind-aware) ────────────────────────────────────────

function subscribe(kind: PrefKind, scope: string, listener: () => void): () => void {
  const slot = getSlot(kind, scope)
  slot.listeners.add(listener)
  return () => { slot.listeners.delete(listener) }
}

function snapshotOf<T>(kind: PrefKind, scope: string): PrefSnapshot<T> {
  return getSlot<T>(kind, scope).snapshot
}

function ensureLoaded<T>(kind: PrefKind, scope: string): void {
  const slot = getSlot<T>(kind, scope)
  if (slot.snapshot.loaded || slot.inFlight) return
  slot.inFlight = true
  setSnapshot(slot, { ...slot.snapshot, loading: true })
  ;(async () => {
    try {
      const r = await apiFetch(`${endpointFor(kind)}?scope=${encodeURIComponent(scope)}`)
      if (!r.ok) {
        setSnapshot(slot, { resp: null, loading: false, loaded: true })
        return
      }
      const data = await r.json() as {
        scope: string
        global: T | null
        per_store: Record<string, T> | null
      }
      setSnapshot(slot, {
        resp: { global: data.global ?? null, per_store: data.per_store ?? {} },
        loading: false,
        loaded: true,
      })
    } catch {
      setSnapshot(slot, { resp: null, loading: false, loaded: true })
    } finally {
      slot.inFlight = false
    }
  })()
}

async function setPrefOf<T>(
  kind: PrefKind,
  scope: string,
  next: T,
  storeUuid: string | null,
  target: "store" | "global",
): Promise<boolean> {
  const slot = getSlot<T>(kind, scope)
  const prev = slot.snapshot
  const base: PrefResp<T> = prev.resp ?? { global: null, per_store: {} }

  let optimistic: PrefResp<T>
  if (target === "global") {
    optimistic = { ...base, global: next }
  } else if (storeUuid) {
    optimistic = { ...base, per_store: { ...base.per_store, [storeUuid]: next } }
  } else {
    return false
  }
  setSnapshot(slot, { resp: optimistic, loading: false, loaded: true })

  try {
    const r = await apiFetch(endpointFor(kind), {
      method: "PUT",
      body: JSON.stringify({
        scope,
        store_uuid: target === "global" ? null : storeUuid,
        layout_config: next,
      }),
    })
    if (!r.ok) {
      setSnapshot(slot, prev)
      return false
    }
    return true
  } catch {
    setSnapshot(slot, prev)
    return false
  }
}

async function resetPrefOf<T>(
  kind: PrefKind,
  scope: string,
  storeUuid: string | null,
  target: "store" | "global",
): Promise<boolean> {
  const slot = getSlot<T>(kind, scope)
  const prev = slot.snapshot
  const base: PrefResp<T> = prev.resp ?? { global: null, per_store: {} }

  let optimistic: PrefResp<T>
  if (target === "global") {
    optimistic = { ...base, global: null }
  } else if (storeUuid) {
    const copy = { ...base.per_store }
    delete copy[storeUuid]
    optimistic = { ...base, per_store: copy }
  } else {
    return false
  }
  setSnapshot(slot, { resp: optimistic, loading: false, loaded: true })

  try {
    const r = await apiFetch(endpointFor(kind), {
      method: "DELETE",
      body: JSON.stringify({
        scope,
        store_uuid: target === "global" ? null : storeUuid,
      }),
    })
    if (!r.ok) {
      setSnapshot(slot, prev)
      return false
    }
    return true
  } catch {
    setSnapshot(slot, prev)
    return false
  }
}

// ── User preferences API (back-compat) ───────────────────────────────

export function subscribePref(scope: string, listener: () => void): () => void {
  return subscribe("user", scope, listener)
}
export function getPrefSnapshot<T>(scope: string): PrefSnapshot<T> {
  return snapshotOf<T>("user", scope)
}
export function ensurePrefLoaded<T>(scope: string): void {
  ensureLoaded<T>("user", scope)
}
export async function setPref<T>(
  scope: string,
  next: T,
  storeUuid: string | null,
  target: "store" | "global",
): Promise<boolean> {
  return setPrefOf<T>("user", scope, next, storeUuid, target)
}
export async function resetPref<T>(
  scope: string,
  storeUuid: string | null,
  target: "store" | "global",
): Promise<boolean> {
  return resetPrefOf<T>("user", scope, storeUuid, target)
}

// ── Forced (admin) overrides API ─────────────────────────────────────

export function subscribeForced(scope: string, listener: () => void): () => void {
  return subscribe("forced", scope, listener)
}
export function getForcedSnapshot<T>(scope: string): PrefSnapshot<T> {
  return snapshotOf<T>("forced", scope)
}
export function ensureForcedLoaded<T>(scope: string): void {
  ensureLoaded<T>("forced", scope)
}
export async function setForcedPref<T>(
  scope: string,
  next: T,
  storeUuid: string | null,
  target: "store" | "global",
): Promise<boolean> {
  return setPrefOf<T>("forced", scope, next, storeUuid, target)
}
export async function resetForcedPref<T>(
  scope: string,
  storeUuid: string | null,
  target: "store" | "global",
): Promise<boolean> {
  return resetPrefOf<T>("forced", scope, storeUuid, target)
}

// ── Debug / test helper ─────────────────────────────────────────────

export function _resetSlotForTest(kind: PrefKind, scope: string): void {
  const slot = slots.get(slotKey(kind, scope))
  if (!slot) return
  slot.snapshot = { ...(EMPTY as PrefSnapshot<unknown>) }
  slot.inFlight = false
  notify(slot)
}
