const seen = new Set<string>()
export function shouldEmitDebugOncePerSignature(_category: string, key: string, _payload?: unknown): boolean {
  if (seen.has(key)) return false
  seen.add(key)
  return true
}
