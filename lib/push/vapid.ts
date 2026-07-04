/**
 * VAPID (Voluntary Application Server Identification) key & subject.
 *
 * Web Push 표준 — 서버 신원 증명용 EC key pair.
 *
 * env vars (Cloud Run 에 등록):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — 클라이언트가 subscribe 시 사용 (공개 값)
 *   VAPID_PRIVATE_KEY            — 서버가 push 전송 시 서명 (비공개)
 *   VAPID_SUBJECT                — 'mailto:xxx@example.com' 형식
 *
 * env 미설정 시 하드코딩된 fallback 사용 (초기 배포용).
 *   ⚠ 운영 시에는 반드시 Cloud Run env 로 override 하고 fallback 은 rotate.
 */

const DEFAULT_PUBLIC_KEY =
  "BNmgEOTebIc2v4n5hUVYA2lP7JoDZbKfvhVC9YyoDSYpF_xt1HMHL6qWNCMrPfLClpujVj4B9iuaiTWyJWgmwTA"

const DEFAULT_PRIVATE_KEY = "Y_zfFDOyJmDdX2TI0aN66UR8TSakXKpoEavWl7t40S0"

const DEFAULT_SUBJECT = "mailto:admin@nox.ai.kr"

export function getVapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? DEFAULT_PUBLIC_KEY
}

export function getVapidPrivateKey(): string {
  return process.env.VAPID_PRIVATE_KEY ?? DEFAULT_PRIVATE_KEY
}

export function getVapidSubject(): string {
  return process.env.VAPID_SUBJECT ?? DEFAULT_SUBJECT
}
