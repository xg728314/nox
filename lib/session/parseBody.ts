import { NextResponse } from "next/server"

/**
 * Safely parses JSON body from a request.
 *
 * Returns the parsed body or a 400 BAD_REQUEST response.
 * Extracts the repeated try/catch JSON parse pattern.
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  request: Request
): Promise<{ body: T; error?: never } | { body?: never; error: NextResponse }> {
  try {
    const body = await request.json()
    return { body: body as T }
  } catch {
    return {
      error: NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      ),
    }
  }
}
