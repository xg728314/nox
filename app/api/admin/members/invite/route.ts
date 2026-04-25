/**
 * 🗑️ REMOVED endpoint — `/api/admin/members/invite`
 *
 * Canonical path: `/api/admin/members/create` (since round-cleanup-003).
 * UI (app/admin/members/create/page.tsx:119) 및 서버 어디에서도 invite
 * path 는 호출되지 않는다 (grep 확인). 잔존 forwarder 를 유지하면 우회
 * 가능한 어드민 경로가 하나 더 생겨 감사 관점에서 바람직하지 않음.
 *
 * 본 라운드: forwarder 제거. 모든 메서드에 HTTP 410 Gone 반환.
 * 다음 라운드: Vercel 로그에서 0 traffic 확인 후 파일 자체 삭제.
 */
import { NextResponse } from "next/server"

function gone(): NextResponse {
  return NextResponse.json(
    {
      error: "ENDPOINT_GONE",
      message:
        "이 엔드포인트는 제거되었습니다. POST /api/admin/members/create 를 사용하세요.",
      canonical: "/api/admin/members/create",
    },
    { status: 410 },
  )
}

export async function GET()    { return gone() }
export async function POST()   { return gone() }
export async function PUT()    { return gone() }
export async function PATCH()  { return gone() }
export async function DELETE() { return gone() }
