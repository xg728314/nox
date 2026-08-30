/**
 * lockGuard — 세션 편집 잠금 검증.
 *
 * R-room-lock (2026-08-31): 같은 매장 실장이 다른 실장 방을 실수로 수정하는
 *   사고 방지. `room_sessions.locked_by_membership_id` (migration 094) 로
 *   세션 단위 잠금 저장. 잠금 소유자, owner, super_admin 만 통과.
 *
 * 사용:
 *   const blocked = await assertSessionUnlocked(supabase, session_id, auth)
 *   if (blocked) return blocked
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { NextResponse } from "next/server"

export async function assertSessionUnlocked(
  supabase: SupabaseClient,
  sessionId: string,
  auth: AuthContext,
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from("room_sessions")
    .select("locked_by_membership_id")
    .eq("id", sessionId)
    .maybeSingle()
  if (error) {
    // 42703 = column not exists (migration 094 미적용) → guard 스킵.
    //   feature-gate: 마이그레이션 전까진 잠금 없는 것처럼 동작.
    const code = (error as { code?: string }).code
    if (code === "42703") return null
    // 다른 에러는 통과시킴 (본 handler 는 잠금 확인만 담당).
    return null
  }
  if (!data) return null
  const lockedBy = (data as { locked_by_membership_id: string | null }).locked_by_membership_id
  if (!lockedBy) return null
  if (lockedBy === auth.membership_id) return null
  // 사장 (owner) · super_admin 은 잠금 override.
  if (auth.role === "owner" || auth.is_super_admin) return null
  return NextResponse.json(
    {
      error: "SESSION_LOCKED",
      message: "이 방은 다른 실장이 잠금 처리 중입니다. 해당 실장에게 문의하세요.",
    },
    { status: 423 },
  )
}
