/**
 * GET  /api/store/chat-strictness — 현재 매장 봇 엄격도 조회
 * PATCH /api/store/chat-strictness — 봇 엄격도 변경 (owner 만)
 *
 * R36 (2026-09-09): 매장 owner 가 봇 개입 강도 조절.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { ensurePerm } from "@/lib/auth/requirePerm"
import { PERMS } from "@/lib/auth/permissions"
import type { BotStrictness } from "@/lib/chat/bot/strictness"
import { STRICTNESS_LABELS } from "@/lib/chat/bot/strictness"

const VALID: BotStrictness[] = ["friendly", "standard", "strict", "silent"]

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const sb = getServiceClient()
    const { data } = await sb.from("store_settings")
      .select("chat_parser_strictness, chat_rules_json")
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    const s = (data as { chat_parser_strictness?: BotStrictness | null; chat_rules_json?: unknown } | null)
    return NextResponse.json({
      strictness: s?.chat_parser_strictness ?? "friendly",
      rules: s?.chat_rules_json ?? null,
      labels: STRICTNESS_LABELS,
    })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // owner + STORE_SETTINGS 위임된 실장 (R33 permission gate 확장)
    if (auth.role !== "owner") {
      const permErr = await ensurePerm(auth, PERMS.STORE_SETTINGS)
      if (permErr) return permErr
    }

    const body = await request.json().catch(() => ({})) as { strictness?: string; rules?: unknown }
    if (body.strictness !== undefined && !VALID.includes(body.strictness as BotStrictness)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: `strictness must be one of ${VALID.join("|")}` }, { status: 400 })
    }
    if (body.rules !== undefined && body.rules !== null && (typeof body.rules !== "object" || Array.isArray(body.rules))) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "rules must be object or null" }, { status: 400 })
    }

    const sb = getServiceClient()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.strictness !== undefined) update.chat_parser_strictness = body.strictness
    if (body.rules !== undefined) update.chat_rules_json = body.rules

    // upsert (store_settings 가 없으면 신규 · 있으면 update)
    const { data: existing } = await sb.from("store_settings")
      .select("id").eq("store_uuid", auth.store_uuid).maybeSingle()
    if (existing) {
      const { error } = await sb.from("store_settings").update(update).eq("store_uuid", auth.store_uuid)
      if (error) return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    } else {
      const { error } = await sb.from("store_settings").insert({ store_uuid: auth.store_uuid, ...update })
      if (error) return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, strictness: body.strictness, rules: body.rules })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
