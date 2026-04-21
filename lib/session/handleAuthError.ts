import { NextResponse } from "next/server"
import { AuthError } from "@/lib/auth/resolveAuthContext"

/**
 * Maps an AuthError to a typed NextResponse.
 *
 * Extracts the repeated catch-block pattern from every session route.
 * Only call this when `error instanceof AuthError` is true.
 */
export function handleAuthError(error: AuthError): NextResponse {
  const status =
    error.type === "AUTH_MISSING" ? 401 :
    error.type === "AUTH_INVALID" ? 401 :
    error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
    error.type === "MEMBERSHIP_INVALID" ? 403 :
    error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
    error.type === "SERVER_CONFIG_ERROR" ? 500 :
    500

  return NextResponse.json(
    { error: error.type, message: error.message },
    { status }
  )
}

/**
 * Generic error handler for the outer catch block of a session route.
 *
 * If the error is an AuthError, returns the mapped response.
 * Otherwise returns a generic 500.
 */
export function handleRouteError(error: unknown, tag: string): NextResponse {
  if (error instanceof AuthError) {
    return handleAuthError(error)
  }
  console.error(`[${tag}] unexpected error:`, error)
  return NextResponse.json(
    {
      error: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unexpected error.",
    },
    { status: 500 }
  )
}
