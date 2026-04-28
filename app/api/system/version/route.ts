import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { collectSystemVersion } from "@/lib/system/version"

/**
 * GET /api/system/version
 *
 * R-Ver: 현재 배포된 NOX 시스템의 버전/revision/빌드 정보 반환.
 *
 * 권한: 무인증 (모든 정보 public-safe — git sha, revision name, build time).
 *
 * 부수효과 (idempotent):
 *   - revision 이 deployment_events 에 없으면 최초 1회 INSERT
 *   - UNIQUE(revision) 제약이라 race condition 시에도 1 row 만 생성
 *
 * 캐시: max-age=60. revision 은 instance lifetime 동안 변하지 않음.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** instance-level memo — 같은 인스턴스에서 반복 호출 시 DB 안 두드림 */
let recordedRevision: string | null = null

async function recordIfNew(info: ReturnType<typeof collectSystemVersion>): Promise<void> {
  if (info.revision === "local") return
  if (recordedRevision === info.revision) return

  const supabase = supa()
  if (!supabase) return

  // INSERT ... ON CONFLICT DO NOTHING (idempotent)
  await supabase
    .from("deployment_events")
    .insert({
      revision: info.revision,
      service: info.service,
      region: info.region,
      git_sha: info.git_sha === "unknown" ? null : info.git_sha,
      git_short_sha: info.git_short_sha === "unknown" ? null : info.git_short_sha,
      git_message: info.git_message,
      built_at: info.built_at,
      build_id: info.build_id,
    })
    // .onConflict("revision") 은 supabase-js v2 에서 upsert 로 표현해야 함 — 단순 insert 로
    // 충돌 시 PG 가 23505 throw → catch 로 무시 (다른 instance 가 먼저 insert)
    .then(
      () => { recordedRevision = info.revision },
      () => { recordedRevision = info.revision /* 충돌도 OK — 이미 기록됨 */ },
    )
}

export async function GET() {
  const info = collectSystemVersion()

  // best-effort 기록 (응답 지연 막기 위해 await 안 함)
  void recordIfNew(info)

  return NextResponse.json(info, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  })
}
