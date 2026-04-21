export type TagAssignment = { tag_id: string; membership_id: string | null; status: string }
export type TagStatus = "assigned" | "unassigned" | "lost"
export function loadTagMap(): Map<string, TagAssignment> { return new Map() }
export function saveTagMap(_map: Map<string, TagAssignment>) {}
export function findByTagId(_id: string): TagAssignment | null { return null }
export function upsertTagAssignment(_assignment: Partial<TagAssignment>) {}
export function markTagLost(_id: string) {}
export function markTagFound(_id: string) {}
export function removeTagAssignment(_id: string) {}
export function getTagEventLogs(): unknown[] { return [] }
