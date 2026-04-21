/**
 * Generic RPC error mapper for cross-store Postgres RPCs.
 *
 * Extracts the identical `mapRpcError` function duplicated in route.ts,
 * payout/route.ts, and payout/cancel/route.ts. Each caller provides
 * its own error map; the mapping logic is shared.
 */

export type RpcErrorEntry = { status: number; error: string }

export function mapRpcError(
  msg: string,
  errorMap: Record<string, RpcErrorEntry>
): { status: number; error: string; message: string } {
  for (const key of Object.keys(errorMap)) {
    if (msg.includes(key)) return { ...errorMap[key], message: msg }
  }
  return { status: 500, error: "RPC_FAILED", message: msg }
}
