/**
 * R28: VLM 이미지 → 구조화 JSON 추출.
 *
 * 흐름:
 *   1. Storage 에서 이미지 다운로드 (서버 측만).
 *   2. Claude Vision (anthropic-ai/sdk) 로 prompt+이미지 전달.
 *   3. 응답 텍스트 → JSON parse + schema 가벼운 검증.
 *   4. 실패 시 unknown_tokens 에 raw error 기록 + status='extract_failed'.
 *
 * 비용 추정: claude-sonnet-4-5 vision ~$0.003/image ($3/1K images).
 *   하루 매장당 2장 × 14매장 = 28장/일 × 30일 = 840장/월 ≈ $2.5/월.
 *
 * 보안: Anthropic API 호출은 server-side 만. ANTHROPIC_API_KEY env.
 */

import Anthropic from "@anthropic-ai/sdk"
import sharp from "sharp"
import { buildExtractionPrompt, VLM_MODEL, PROMPT_VERSION } from "./prompts"
import type { PaperExtraction, SheetKind } from "./types"

/**
 * Anthropic Vision 의 base64 페이로드 한도 = 5,242,880 bytes (5MB).
 * raw 이미지 + base64 (4/3 ratio) 가 합쳐서 5MB 안에 들어와야 함.
 *   raw 4MB → base64 ~5.4MB (limit 초과)
 *   raw 3.5MB → base64 ~4.7MB (안전)
 * 안전 margin 으로 3.5MB 임계로 잡고 그 이상이면 서버에서 리사이즈.
 */
const SAFE_RAW_BYTES = 3_500_000
/** 손글씨 OCR 에 충분한 해상도 — 2000px 긴 변. */
const RESIZE_LONGEST_EDGE = 2000
const JPEG_QUALITY = 85

async function compressIfNeeded(
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<{ bytes: ArrayBuffer; mimeType: string; resized: boolean }> {
  if (bytes.byteLength <= SAFE_RAW_BYTES) {
    return { bytes, mimeType, resized: false }
  }
  // sharp 로 longest-edge 2000px JPEG 85% 로 리사이즈.
  //   원본 사진 (모바일 카메라) ~4-8MB → 리사이즈 후 ~0.8-1.5MB.
  const buf = Buffer.from(bytes)
  const resized = await sharp(buf)
    .rotate()  // EXIF orientation 자동 적용 (휴대폰 사진 회전 보정)
    .resize({
      width: RESIZE_LONGEST_EDGE,
      height: RESIZE_LONGEST_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
  // resized 가 그래도 안전 한도를 넘으면 한 단계 더 줄임.
  let finalBuf = resized
  if (finalBuf.byteLength > SAFE_RAW_BYTES) {
    finalBuf = await sharp(buf)
      .rotate()
      .resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer()
  }
  const ab = finalBuf.buffer.slice(
    finalBuf.byteOffset,
    finalBuf.byteOffset + finalBuf.byteLength,
  ) as ArrayBuffer
  return { bytes: ab, mimeType: "image/jpeg", resized: true }
}

export type ExtractInput = {
  image_bytes: ArrayBuffer
  mime_type: string
  sheet_kind: SheetKind
  business_date: string
  store_symbol_dictionary?: Record<string, unknown>
  store_known_stores?: string[]
  /** v5: 매장 호스티스 이름 후보. VLM 매칭 reference. PII — 서버 측만 fetch. */
  store_known_hostesses?: string[]
  /**
   * 2026-05-01 R-Paper-Learn Phase A: 매장별 학습 corrections 마크다운 블록.
   *   formatLearnedCorrectionsForPrompt 결과 그대로. 빈 문자열이면 prompt 미주입.
   */
  store_learned_corrections_block?: string
}

export type ExtractResult =
  | { ok: true
      extraction: PaperExtraction
      vlm_model: string
      prompt_version: number
      duration_ms: number
      cost_usd: number | null
      raw_response_text: string
    }
  | { ok: false
      reason: "no_api_key" | "vlm_error" | "parse_failed" | "schema_invalid"
      message: string
      duration_ms?: number
      raw_response_text?: string
    }

export async function extractFromImage(input: ExtractInput): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { ok: false, reason: "no_api_key", message: "ANTHROPIC_API_KEY env 미설정" }
  }

  const { system, user } = buildExtractionPrompt({
    sheet_kind: input.sheet_kind,
    business_date: input.business_date,
    store_symbol_dictionary: input.store_symbol_dictionary,
    store_known_stores: input.store_known_stores,
    store_known_hostesses: input.store_known_hostesses,
    store_learned_corrections_block: input.store_learned_corrections_block,
  })

  const client = new Anthropic({ apiKey })
  const t0 = Date.now()

  // 2026-04-30: Anthropic Vision 의 5MB base64 한도 회피.
  //   원본 4MB+ 이미지 (모바일 카메라 사진) 는 base64 인코딩 시 5.5MB+ 가 돼
  //   400 invalid_request_error ("image exceeds 5 MB maximum") 발생.
  //   서버에서 자동 리사이즈 (longest-edge 2000px JPEG 85%) 후 호출.
  let imgBytes = input.image_bytes
  let imgMime = input.mime_type
  let resizeApplied = false
  try {
    const compressed = await compressIfNeeded(input.image_bytes, input.mime_type)
    imgBytes = compressed.bytes
    imgMime = compressed.mimeType
    resizeApplied = compressed.resized
  } catch (e) {
    return {
      ok: false,
      reason: "vlm_error",
      message: `이미지 리사이즈 실패: ${(e as Error).message}`,
      duration_ms: Date.now() - t0,
    }
  }

  let raw = ""
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const resp = await client.messages.create({
      model: VLM_MODEL,
      // 2026-04-30: 4096 → 16384.
      //   스태프 장부는 10명+ × 7시간슬롯 × (시간/매장/종목/시간티어/raw_text/
      //   confidence) → 1장에 800-1500 줄 JSON 발생. 4096 tokens (~12KB) 에서
      //   잘려 "Unterminated string in JSON at position 11451" 보고. 16384
      //   (~50KB) 면 여유.
      max_tokens: 16384,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: normalizeMime(imgMime),
                data: arrayBufferToBase64(imgBytes),
              },
            },
            { type: "text", text: user },
          ],
        },
      ],
    })

    const block = resp.content.find(c => c.type === "text")
    raw = block && block.type === "text" ? block.text : ""
    usage = { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens }
  } catch (e) {
    return {
      ok: false,
      reason: "vlm_error",
      message: (e as Error).message,
      duration_ms: Date.now() - t0,
    }
  }

  const duration_ms = Date.now() - t0

  const parsed = safeParseJson(raw)
  if (!parsed.ok) {
    return {
      ok: false, reason: "parse_failed", message: parsed.error,
      duration_ms, raw_response_text: raw,
    }
  }

  const validated = validateExtraction(parsed.value, input.sheet_kind)
  if (!validated.ok) {
    return {
      ok: false, reason: "schema_invalid", message: validated.error,
      duration_ms, raw_response_text: raw,
    }
  }

  return {
    ok: true,
    extraction: validated.value,
    vlm_model: VLM_MODEL,
    prompt_version: PROMPT_VERSION,
    duration_ms,
    cost_usd: estimateCostUsd(usage),
    raw_response_text: raw,
  }
}

// ─── helpers ─────────────────────────────────────────────────

function normalizeMime(m: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const x = m.toLowerCase()
  if (x.includes("png")) return "image/png"
  if (x.includes("gif")) return "image/gif"
  if (x.includes("webp")) return "image/webp"
  // heic / heif 는 Anthropic 미지원 — 클라가 이미 jpeg 로 변환했다고 가정
  return "image/jpeg"
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64")
}

function safeParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  // 코드블록 ``` 으로 감싸 응답 시 제거.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
  try {
    return { ok: true, value: JSON.parse(cleaned) }
  } catch (e) {
    // 2026-04-30: VLM 응답이 max_tokens 한계로 중간 잘림 시 복구 시도.
    //   "Unterminated string" / "Unexpected end of JSON" 같은 케이스를
    //   대상으로, 마지막 안전한 closing brace 까지 잘라내고 재파싱한다.
    //   완전 복구 X — 잘린 row 는 누락되지만, 앞쪽 row 들은 살린다.
    const repaired = repairTruncatedJson(cleaned)
    if (repaired) {
      try {
        return { ok: true, value: JSON.parse(repaired) }
      } catch { /* 복구도 실패하면 원본 에러 반환 */ }
    }
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * 잘린 JSON 응답 best-effort 복구.
 *
 * 전략:
 *   1. 문자열 안 / 밖 추적 (escape 처리).
 *   2. 마지막 "완성된 row 직후" 위치 기록 = depth 가 ≥1 일 때 객체/배열이
 *      닫혀서 다음 separator(,) 또는 닫힘 괄호 직전이 되는 시점.
 *   3. 그 시점까지 자르고, 남은 open contexts 의 닫힘 괄호를 stack 순서대로
 *      덧붙임.
 *
 * 한계:
 *   - 잘린 마지막 row 는 누락 (재구성 X). 그 이전 row 들은 살림.
 *   - 복구 불가 (애초에 truncate 가 매우 이른 지점) → null.
 */
function repairTruncatedJson(s: string): string | null {
  // open context 의 stack ('{' or '[' 만 push). 닫히면 pop.
  const stack: Array<"{" | "["> = []
  let inStr = false
  let escape = false
  // 마지막으로 안전하게 잘라도 되는 지점 (직전 char 가 '}' 또는 ']' 이고
  // string 밖이면 저장).
  let lastSafeCut = -1
  let stackAtSafe: Array<"{" | "["> = []

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (escape) { escape = false; continue }
    if (c === "\\") { escape = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue

    if (c === "{") stack.push("{")
    else if (c === "[") stack.push("[")
    else if (c === "}" || c === "]") {
      stack.pop()
      // 이 지점 이후가 안전한 자르기 위치 (객체/배열 1개 완전 닫힘 직후).
      lastSafeCut = i + 1
      stackAtSafe = stack.slice()
    }
  }

  if (lastSafeCut <= 0) return null

  let truncated = s.slice(0, lastSafeCut)
  // 끝의 trailing comma 제거 (JSON spec 위반).
  truncated = truncated.replace(/,(\s*[}\]])/g, "$1")
  // 남은 open context 닫힘 — stack 역순.
  for (let j = stackAtSafe.length - 1; j >= 0; j--) {
    truncated += stackAtSafe[j] === "{" ? "}" : "]"
  }
  return truncated
}

function validateExtraction(
  v: unknown,
  expected: SheetKind,
): { ok: true; value: PaperExtraction } | { ok: false; error: string } {
  if (!v || typeof v !== "object") return { ok: false, error: "not an object" }
  const o = v as Record<string, unknown>
  if (o.schema_version !== 1) return { ok: false, error: `schema_version != 1 (got ${String(o.schema_version)})` }
  if (o.sheet_kind !== expected) return { ok: false, error: `sheet_kind mismatch (expected ${expected}, got ${String(o.sheet_kind)})` }
  if (!Array.isArray(o.unknown_tokens)) {
    o.unknown_tokens = []
  }
  // 그 외는 best-effort — VLM 이 일부 필드 비워도 받아들임.
  return { ok: true, value: v as PaperExtraction }
}

/** Sonnet 4.5 가격 (2026 기준 추정): input $3/M, output $15/M, image ≈ 1500 input tokens. */
function estimateCostUsd(usage: { input_tokens?: number; output_tokens?: number }): number | null {
  if (!usage.input_tokens && !usage.output_tokens) return null
  const inCost = (usage.input_tokens ?? 0) * 3 / 1_000_000
  const outCost = (usage.output_tokens ?? 0) * 15 / 1_000_000
  return Number((inCost + outCost).toFixed(6))
}
