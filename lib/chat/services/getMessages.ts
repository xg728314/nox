import type { SupabaseClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"
import { resolveMemberNames } from "@/lib/chat/queries/loadRoomMembers"

type GetMessagesInput = {
  chatRoomId: string
  store_uuid: string
  membership_id: string
  cursor: string | null
  limit: number
}

type EnrichedMessage = {
  id: string
  chat_room_id: string
  sender_membership_id: string
  content: string
  message_type: string
  created_at: string
  sender_name: string | null
  is_mine: boolean
  read_count: number
  is_read_by_me: boolean
}

type GetMessagesResult = {
  messages: EnrichedMessage[]
  has_more: boolean
  latestMessageId: string | null
}

/**
 * Fetches messages with cursor pagination, name enrichment, and read counts.
 *
 * Extracts the message query + enrichment logic from messages/route.ts GET handler.
 */
export async function getMessages(
  supabase: SupabaseClient,
  input: GetMessagesInput
): Promise<GetMessagesResult> {
  // Build query with cursor pagination
  let query = supabase
    .from("chat_messages")
    .select("id, chat_room_id, sender_membership_id, content, message_type, created_at")
    .eq("chat_room_id", input.chatRoomId)
    .eq("store_uuid", input.store_uuid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(input.limit)

  if (input.cursor && isValidUUID(input.cursor)) {
    const { data: cursorMsg } = await supabase
      .from("chat_messages")
      .select("created_at")
      .eq("id", input.cursor)
      .maybeSingle()

    if (cursorMsg) {
      query = query.lt("created_at", cursorMsg.created_at)
    }
  }

  const { data: messages } = await query

  const messageIds = (messages ?? []).map((m: { id: string }) => m.id)
  const senderIds = [...new Set((messages ?? []).map((m: { sender_membership_id: string }) => m.sender_membership_id))]
  const senderByMessage = new Map<string, string>()
  for (const m of (messages ?? []) as { id: string; sender_membership_id: string }[]) {
    senderByMessage.set(m.id, m.sender_membership_id)
  }

  // 2026-05-03 R-Speed-x10: 3개 lookup 병렬 fire (모두 messages 결과만 의존).
  //   기존 직렬 3 wave → 1 wave. cursor 조회는 last_read 의존이라 sequential 유지.
  const [nameMap, readsRes, cursorRowRes] = await Promise.all([
    resolveMemberNames(supabase, input.store_uuid, senderIds),
    messageIds.length > 0
      ? supabase
          .from("chat_message_reads")
          .select("message_id, membership_id")
          .eq("store_uuid", input.store_uuid)
          .eq("room_id", input.chatRoomId)
          .in("message_id", messageIds)
      : Promise.resolve({ data: [] as Array<{ message_id: string; membership_id: string }> }),
    supabase
      .from("chat_read_cursors")
      .select("last_read_message_id")
      .eq("room_id", input.chatRoomId)
      .eq("membership_id", input.membership_id)
      .eq("store_uuid", input.store_uuid)
      .maybeSingle(),
  ])

  const readCountMap = new Map<string, number>()
  for (const r of (readsRes.data ?? []) as { message_id: string; membership_id: string }[]) {
    if (senderByMessage.get(r.message_id) === r.membership_id) continue
    readCountMap.set(r.message_id, (readCountMap.get(r.message_id) ?? 0) + 1)
  }

  const cursorRow = cursorRowRes.data
  let cursorCreatedAt: string | null = null
  if (cursorRow?.last_read_message_id) {
    // last_read_message_id 가 messages 안에 있으면 추가 RTT 없이 처리.
    const inLoaded = (messages ?? []).find(
      (m: { id: string; created_at: string }) => m.id === cursorRow.last_read_message_id,
    )
    if (inLoaded) {
      cursorCreatedAt = inLoaded.created_at
    } else {
      const { data: cursorMsg } = await supabase
        .from("chat_messages")
        .select("created_at")
        .eq("id", cursorRow.last_read_message_id)
        .maybeSingle()
      cursorCreatedAt = cursorMsg?.created_at ?? null
    }
  }

  const enriched: EnrichedMessage[] = (messages ?? []).map((m: {
    id: string; chat_room_id: string; sender_membership_id: string;
    content: string; message_type: string; created_at: string
  }) => ({
    ...m,
    sender_name: nameMap.get(m.sender_membership_id) || null,
    is_mine: m.sender_membership_id === input.membership_id,
    read_count: readCountMap.get(m.id) ?? 0,
    is_read_by_me: cursorCreatedAt ? m.created_at <= cursorCreatedAt : false,
  }))

  const latestMessageId = (messages && messages.length > 0) ? messages[0].id : null

  return {
    messages: enriched,
    has_more: (messages ?? []).length === input.limit,
    latestMessageId,
  }
}
