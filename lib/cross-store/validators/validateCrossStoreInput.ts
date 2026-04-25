/**
 * Generic RPC error mapper for cross-store Postgres RPCs.
 *
 * Extracts the identical `mapRpcError` function duplicated in route.ts,
 * payout/route.ts, and payout/cancel/route.ts. Each caller provides
 * its own error map; the mapping logic is shared.
 */

export type RpcErrorEntry = {
  status: number
  error: string
  /**
   * 운영자 친화 메시지. 지정 시 응답 message 로 사용. 미지정 시 원본 RPC
   * 메시지를 그대로 전달 (기존 동작 유지).
   */
  message?: string
}

export function mapRpcError(
  msg: string,
  errorMap: Record<string, RpcErrorEntry>
): { status: number; error: string; message: string } {
  for (const key of Object.keys(errorMap)) {
    if (msg.includes(key)) {
      const entry = errorMap[key]
      return {
        status: entry.status,
        error: entry.error,
        message: entry.message ?? msg,
      }
    }
  }
  return { status: 500, error: "RPC_FAILED", message: msg }
}
