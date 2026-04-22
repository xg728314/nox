import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type ChatUnread = { unread_count: number }

export async function getChatUnread(auth: AuthContext): Promise<ChatUnread> {
  const supabase = getServiceClient()

  const { data: participants } = await supabase
    .from("chat_participants")
    .select("unread_count")
    .eq("membership_id", auth.membership_id)
    .eq("store_uuid", auth.store_uuid)
    .is("left_at", null)

  const total = (participants ?? []).reduce(
    (sum: number, p: { unread_count: number }) => sum + (p.unread_count ?? 0),
    0,
  )

  return { unread_count: total }
}
