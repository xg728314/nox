import { NextResponse } from "next/server"
import { isValidUUID } from "@/lib/validation"

/**
 * Validates message send input.
 *
 * Returns a NextResponse error if validation fails, null if valid.
 */
export function validateMessageInput(
  chatRoomId: string | undefined,
  content: string | undefined
): NextResponse | null {
  if (!chatRoomId || !isValidUUID(chatRoomId)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "chat_room_id is required." },
      { status: 400 }
    )
  }
  if (!content || content.trim().length === 0) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "content is required." },
      { status: 400 }
    )
  }
  if (content.length > 2000) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "메시지는 2000자 이하여야 합니다." },
      { status: 400 }
    )
  }
  return null
}
