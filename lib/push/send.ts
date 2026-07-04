/**
 * Web Push 전송 헬퍼.
 * 특정 user_id 의 모든 등록된 device 에 notification 전송.
 *
 * 전송 실패 처리:
 *   - 410 Gone / 404 → endpoint 만료 → row 삭제
 *   - 5xx → last_failure_at 스탬프, 다음 push 는 그대로 시도
 *
 * R-push (2026-06-28).
 */
import webpush from "web-push"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getVapidPrivateKey, getVapidPublicKey, getVapidSubject } from "./vapid"

let vapidReady = false
function ensureVapid() {
  if (vapidReady) return
  webpush.setVapidDetails(getVapidSubject(), getVapidPublicKey(), getVapidPrivateKey())
  vapidReady = true
}

export type PushPayload = {
  title: string
  body: string
  /** click 시 이동할 URL (relative). 기본 "/m". */
  url?: string
  /** notification tag — 같은 tag 는 이전 notification 대체. */
  tag?: string
  /** 아이콘 URL. 기본 favicon. */
  icon?: string
  /** vibrate pattern (ms). 기본 [200, 100, 200]. */
  vibrate?: number[]
  /** 임의 데이터 (SW 에서 사용) */
  data?: Record<string, unknown>
}

export type PushResult = {
  ok: number
  failed: number
  removed: number
}

/**
 * user_id 의 모든 push subscription 에 알림 전송.
 *   - 각 endpoint 병렬 전송.
 *   - 성공 → last_success_at 갱신.
 *   - 410/404 → row 삭제.
 *   - 그 외 실패 → last_failure_at + last_failure_code 스탬프.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  ensureVapid()
  const supabase = getServiceClient()
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
    .eq("user_id", userId)
  type Row = { id: string; endpoint: string; p256dh_key: string; auth_key: string }
  const rows = (subs ?? []) as Row[]
  if (rows.length === 0) return { ok: 0, failed: 0, removed: 0 }

  const jsonPayload = JSON.stringify(payload)
  const nowIso = new Date().toISOString()
  const results = await Promise.all(
    rows.map(async (r) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: r.endpoint,
            keys: { p256dh: r.p256dh_key, auth: r.auth_key },
          },
          jsonPayload,
        )
        await supabase
          .from("push_subscriptions")
          .update({ last_success_at: nowIso })
          .eq("id", r.id)
        return { ok: true, removed: false }
      } catch (e) {
        const statusCode = (e as { statusCode?: number })?.statusCode ?? 0
        // 410 Gone / 404 Not Found → 만료 → 삭제
        if (statusCode === 410 || statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", r.id)
          return { ok: false, removed: true }
        }
        await supabase
          .from("push_subscriptions")
          .update({
            last_failure_at: nowIso,
            last_failure_code: statusCode || null,
          })
          .eq("id", r.id)
        return { ok: false, removed: false }
      }
    }),
  )
  return {
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok && !r.removed).length,
    removed: results.filter((r) => r.removed).length,
  }
}
