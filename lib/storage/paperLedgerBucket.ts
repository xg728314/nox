/**
 * Supabase Storage 헬퍼 — paper-ledgers bucket.
 *
 * R27: 종이장부 사진 보관소.
 *
 * 보안:
 *   - bucket public=false. 모든 접근은 service-role 또는 signed URL.
 *   - signed URL TTL 짧게 (15분 default) — 화면 표시용.
 *   - 클라이언트 직접 업로드 안 함. 항상 API route 경유.
 *
 * 경로 규칙:
 *   {store_uuid}/{yyyy-mm-dd}/{snapshot_id}.{ext}
 *   - 매장별 폴더 분리 → 정책 적용 + 백업 단순화
 *   - snapshot_id 가 곧 row PK 라 충돌 0
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export const PAPER_LEDGER_BUCKET = "paper-ledgers"

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
])

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export type StorageUploadInput = {
  store_uuid: string
  business_date: string  // "YYYY-MM-DD"
  snapshot_id: string
  bytes: ArrayBuffer | Uint8Array | Buffer
  mime_type: string
  file_name?: string
}

export type StorageUploadResult =
  | { ok: true; storage_path: string }
  | { ok: false; reason: "invalid_mime" | "too_large" | "upload_failed"; message?: string }

/** 업로드 + 경로 반환. */
export async function uploadPaperLedger(
  supabase: SupabaseClient,
  input: StorageUploadInput,
): Promise<StorageUploadResult> {
  if (!ALLOWED_MIME.has(input.mime_type.toLowerCase())) {
    return { ok: false, reason: "invalid_mime", message: `Unsupported MIME: ${input.mime_type}` }
  }
  const size = (input.bytes as Buffer).byteLength ?? (input.bytes as Uint8Array).length
  if (size > MAX_BYTES) {
    return { ok: false, reason: "too_large", message: `>${MAX_BYTES} bytes` }
  }

  const ext = mimeToExt(input.mime_type)
  const path = `${input.store_uuid}/${input.business_date}/${input.snapshot_id}.${ext}`

  const { error } = await supabase.storage
    .from(PAPER_LEDGER_BUCKET)
    .upload(path, input.bytes as Buffer, {
      contentType: input.mime_type,
      upsert: false,
    })

  if (error) {
    return { ok: false, reason: "upload_failed", message: error.message }
  }
  return { ok: true, storage_path: path }
}

/** 다운로드 (서버 측 — VLM 으로 보내기 전에 fetch). */
export async function downloadPaperLedger(
  supabase: SupabaseClient,
  storage_path: string,
): Promise<{ ok: true; bytes: ArrayBuffer; mime_type: string } | { ok: false; reason: string }> {
  const { data, error } = await supabase.storage
    .from(PAPER_LEDGER_BUCKET)
    .download(storage_path)
  if (error || !data) {
    return { ok: false, reason: error?.message ?? "download_failed" }
  }
  const bytes = await data.arrayBuffer()
  return { ok: true, bytes, mime_type: data.type || "image/jpeg" }
}

/** 표시용 short-TTL signed URL. */
export async function signedPaperLedgerUrl(
  supabase: SupabaseClient,
  storage_path: string,
  ttlSeconds: number = 15 * 60,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(PAPER_LEDGER_BUCKET)
    .createSignedUrl(storage_path, ttlSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes("png")) return "png"
  if (m.includes("heic") || m.includes("heif")) return "heic"
  if (m.includes("webp")) return "webp"
  return "jpg"
}

/**
 * R-Paper-Retention (2026-05-01): Storage 사진 파일 삭제.
 *   cascade 삭제 시 호출. 실패 catch — DB row 삭제는 진행.
 *   (Storage orphan 은 별도 cleanup 가능. DB 가 truth.)
 */
export async function removePaperLedger(
  supabase: SupabaseClient,
  storage_path: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const { error } = await supabase.storage
      .from(PAPER_LEDGER_BUCKET)
      .remove([storage_path])
    if (error) return { ok: false, reason: error.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}
