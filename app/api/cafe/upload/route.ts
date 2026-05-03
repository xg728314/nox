import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"

/**
 * POST /api/cafe/upload — 카페 메뉴 이미지 업로드 (multipart).
 *   카페 owner/manager/staff 만. Supabase Storage 'cafe-menu' bucket.
 *   응답: { url } — 메뉴 image_url 에 사용.
 *
 * 참고: bucket 은 첫 호출 시 자동 생성 시도. 실패하면 owner 가
 * Supabase Dashboard 에서 'cafe-menu' public bucket 만들어야 함.
 */
export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager", "staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "file required" }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "FILE_TOO_LARGE", message: "max 5MB" }, { status: 400 })
    }
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "BAD_TYPE", message: "jpeg/png/webp/gif only" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg"
    const path = `${auth.store_uuid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    // bucket auto-create if missing
    try {
      await supabase.storage.createBucket("cafe-menu", { public: true })
    } catch { /* exists */ }

    const buf = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from("cafe-menu")
      .upload(path, buf, { contentType: file.type, upsert: false })
    if (upErr) return NextResponse.json({ error: "UPLOAD_FAILED", message: upErr.message }, { status: 500 })

    const { data: urlData } = supabase.storage.from("cafe-menu").getPublicUrl(path)
    return NextResponse.json({ url: urlData.publicUrl, path })
  } catch (e) {
    return handleRouteError(e, "cafe/upload")
  }
}
