/**
 * 경량 런타임 스키마 검증기. 2026-04-25: API body 를 `as Type` 단언만 하고
 *   믿던 패턴 → 잘못된 타입/NaN/누락 필드로 NaN 전파 위험.
 *
 *   zod 같은 라이브러리를 안 쓰는 이유: 번들 크기. 필요 기능만 30줄짜리로.
 *
 * 사용:
 *   const check = isShape(body, {
 *     session_id: isUuid,
 *     amount: (v) => isFiniteNumber(v) && v > 0 && v <= 10_000_000,
 *     memo: optional(isString),
 *   })
 *   if (!check.ok) return NextResponse.json({ error: "BAD_REQUEST", field: check.field }, { status: 400 })
 */

import { isValidUUID } from "@/lib/validation"

export type FieldCheck = (value: unknown) => boolean

export type ShapeResult =
  | { ok: true }
  | { ok: false; field: string; reason: string }

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

export function isString(v: unknown): v is string {
  return typeof v === "string"
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean"
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && isValidUUID(v)
}

export function isPositiveFiniteNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0
}

export function isNonNegativeFiniteNumber(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0
}

export function isIntInRange(min: number, max: number): FieldCheck {
  return (v) => isFiniteNumber(v) && Number.isInteger(v) && v >= min && v <= max
}

export function isOneOf<T extends string>(values: readonly T[]): FieldCheck {
  return (v) => typeof v === "string" && (values as readonly string[]).includes(v)
}

export function optional(check: FieldCheck): FieldCheck {
  return (v) => v === undefined || v === null || check(v)
}

export function isShape(
  body: unknown,
  schema: Record<string, FieldCheck>,
): ShapeResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, field: "_root", reason: "body must be object" }
  }
  const obj = body as Record<string, unknown>
  for (const [key, check] of Object.entries(schema)) {
    if (!check(obj[key])) {
      return { ok: false, field: key, reason: `invalid ${key}` }
    }
  }
  return { ok: true }
}
