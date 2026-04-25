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
import { buildExtractionPrompt, VLM_MODEL, PROMPT_VERSION } from "./prompts"
import type { PaperExtraction, SheetKind } from "./types"

export type ExtractInput = {
  image_bytes: ArrayBuffer
  mime_type: string
  sheet_kind: SheetKind
  business_date: string
  store_symbol_dictionary?: Record<string, unknown>
  store_known_stores?: string[]
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
  })

  const client = new Anthropic({ apiKey })
  const t0 = Date.now()

  let raw = ""
  let usage: { input_tokens?: number; output_tokens?: number } = {}
  try {
    const resp = await client.messages.create({
      model: VLM_MODEL,
      max_tokens: 4096,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: normalizeMime(input.mime_type),
                data: arrayBufferToBase64(input.image_bytes),
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
    return { ok: false, error: (e as Error).message }
  }
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
