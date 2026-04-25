/**
 * NOX Offline — 금지 타입 정의 (공용).
 *
 * 이 파일은 db.ts (enqueueEvent) 와 sync.ts (syncEventQueue) 양쪽에서
 * import 한다. 단일 출처에 두지 않으면 두 계층의 whitelist 가 드리프트해서
 * "클라이언트는 큐에 넣었는데 서버가 skip" → UI 저장 성공 오인 사례가
 * 다시 발생할 수 있다.
 *
 * 금지 정책 근거:
 *   - 정산 확정(finalize), 영수증 스냅샷, 결제 방식 확정, 영업일 마감은
 *     서버 권위 상태전이이며 오프라인 큐를 통과시키면 무결성 위반.
 *   - 클라이언트 enqueueEvent 시점에 즉시 throw → UI 는 성공 처리하지 않음.
 *   - 서버 sync 도 동일 목록으로 skip 유지 (이중 방어).
 */

export const FORBIDDEN_OFFLINE_TYPES: readonly string[] = [
  "settlement",           // 정산 생성
  "receipt",              // 영수증 스냅샷
  "finalize",             // 정산 확정
  "payment",              // 결제 방식 확정
  "finalize-settlement",  // 정산 확정 (별칭)
  "close-day",            // 영업일 마감
] as const

export class ForbiddenOfflineTypeError extends Error {
  readonly type: string
  constructor(type: string) {
    super(
      `Offline queue rejected: "${type}" is a server-authoritative operation. ` +
        `Perform this action online.`,
    )
    this.name = "ForbiddenOfflineTypeError"
    this.type = type
  }
}

export function isForbiddenOfflineType(type: string): boolean {
  return FORBIDDEN_OFFLINE_TYPES.includes(type)
}
