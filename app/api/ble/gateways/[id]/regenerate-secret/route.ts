import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"
import { randomBytes } from "node:crypto"

/**
 * POST /api/ble/gateways/[id]/regenerate-secret
 *
 * 게이트웨이 secret 재발급. 분실 시 또는 보안 사고 후.
 *
 * - 기존 secret 폐기 + 새 secret 1회 평문 응답.
 * - 게이트웨이 펌웨어를 새 secret 으로 재구성하기 전까진 ingest 인증 실패.
 *
 * 권한: owner only.
 */

export const runtime = "nodejs"

function generateSecret(): string {
  return randomBytes(32).toString("base64url")
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "사장만 재발급 가능." },
        { status: 403 },
      )
    }

    const { id } = await params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const supabase = getServiceClient()

    const newSecret = generateSecret()

    const { data: updated, error: updErr } = await supabase
      .from("ble_gateways")
      .update({
        gateway_secret: newSecret,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .select("id, gateway_id")
      .single()

    if (updErr || !updated) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    void supabase
      .from("audit_events")
      .insert({
        store_uuid: auth.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "ble_gateways",
        entity_id: id,
        action: "ble_gateway_secret_regenerated",
        after: { gateway_id: updated.gateway_id },
      })
      .then(undefined, () => { /* swallow */ })

    return NextResponse.json({
      gateway_id: updated.gateway_id,
      gateway_secret: newSecret,
      warning: "새 gateway_secret 은 이번 1회만 표시됩니다. 게이트웨이 펌웨어를 새 secret 으로 즉시 갱신하세요. 기존 secret 으로 시도하는 ingest 는 모두 실패합니다.",
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
