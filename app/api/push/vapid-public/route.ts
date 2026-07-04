/**
 * GET /api/push/vapid-public
 *
 * VAPID public key 를 클라이언트에 제공.
 * 클라이언트가 PushManager.subscribe() 호출 시 필요.
 */
import { NextResponse } from "next/server"
import { getVapidPublicKey } from "@/lib/push/vapid"

export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey() })
}
