import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ room_uuid: string }> }
) {
  try {
    const { room_uuid: roomUuidParam } = await params
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager", "waiter", "staff"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const roomUuid = roomUuidParam
    if (!roomUuid) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "room_uuid is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id, room_no, room_name, is_active, created_at")
      .eq("store_uuid", authContext.store_uuid)
      .eq("id", roomUuid)
      .single()

    if (roomError || !room) {
      return NextResponse.json(
        { error: "ROOM_NOT_FOUND", message: "Room not found in this store." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      room_uuid: room.id,
      room_no: room.room_no,
      room_name: room.room_name,
      is_active: room.is_active,
      created_at: room.created_at,
      store_uuid: authContext.store_uuid,
    })
  } catch (error) {
    if (error instanceof AuthError) {
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

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
