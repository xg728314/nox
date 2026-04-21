import { NextResponse } from "next/server"
import { getServerSupabaseOrError } from "@/lib/supabaseServer"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Returns a service-role Supabase client or a 500 NextResponse.
 *
 * Replaces the 10-line env-check + createClient pattern duplicated
 * across every session route handler.
 */
export function createServiceClient():
  | { supabase: SupabaseClient; error?: never }
  | { supabase?: never; error: NextResponse } {
  const result = getServerSupabaseOrError()
  if ("error" in result) {
    return {
      error: NextResponse.json(
        {
          error: "SERVER_CONFIG_ERROR",
          message: "Supabase environment variables are not configured.",
        },
        { status: 500 }
      ),
    }
  }
  return { supabase: result.supabase }
}
