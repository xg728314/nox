/**
 * 채팅 메시지 자동 처리 파이프라인.
 *   1. 서버 사이드 파서 실행 (staffChatParser)
 *   2. 대기 요청 패턴 감지 → waiting_requests 자동 INSERT
 *   3. 조건 맞는 매장 실장에게 Push 자동 발송
 *   4. chat_auto_actions 감사 로그
 *
 * fire-and-forget 로 route 에서 호출 — 응답 지연 없음.
 *
 * R-auto-ops (2026-07-08).
 */
import { parseStaffChat } from "@/app/counter/helpers/staffChatParser"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { sendPushToUser } from "@/lib/push/send"

/**
 * 대기 요청 판별 정규식 — 카톡 실사 관찰 표현들.
 *   `대기부탁`, `대기 부탁`, `대기점여`, `대기자부탁`, `대기자 부탁`
 *   `부탁드립니다`, `부탁드려요`, `대기 있어요`
 *   `초이스있습니다`, `초이스 있어요`
 */
const WAITING_PATTERN =
  /대기\s*[자진]?\s*(부탁|점여|드려요)|부탁드립니다|부탁드려요|대기\s*있|초이스\s*있|대기좀|대기점요/

/**
 * 세션 이벤트 판별 (연장/종료/시작).
 *   `연장`, `2연장`, `무한연장`
 *   `메이드`, `완메`, `반메`, `끝`, `마무리`
 *   `시간체크`, `스타트`
 */
const SESSION_EVENT_PATTERN =
  /(\d+)?\s*연장|(메이드|완메|반메|반차\d?메|끝\b|마무리|시간체크|스타트|ㅅㅌㅌ|ㅅㅊ|ㅁㅇㄷ)/

export async function autoProcessChatMessage(input: {
  chat_message_id: string
  chat_room_id: string
  sender_user_id: string
  sender_membership_id: string | null
  store_uuid: string
  content: string
}): Promise<void> {
  try {
    const { content, store_uuid, chat_message_id, sender_user_id, chat_room_id } = input
    if (!content || content.length < 3) return

    const supabase = getServiceClient()

    // ── 1. 파서 실행 (서버 사이드) ──────────────────────────
    const parsed = parseStaffChat(content, null)

    // ── 2. 대기 요청 자동 등록 ──────────────────────────────
    if (WAITING_PATTERN.test(content)) {
      await handleWaitingRequest(supabase, {
        content,
        store_uuid,
        chat_message_id,
        chat_room_id,
        sender_user_id,
        parsed,
      })
    }

    // ── 3. 세션 이벤트 감지 (연장/종료/시작) ────────────────
    //   dispatch 흐름은 기존 pattern-dispatch 유지. 여기선 이벤트만 감사.
    if (SESSION_EVENT_PATTERN.test(content) && parsed.entries.length > 0) {
      await supabase.from("chat_auto_actions").insert({
        chat_message_id,
        chat_room_id,
        sender_user_id,
        action_type: "session_event",
        parsed_json: {
          entries: parsed.entries.map((e) => ({
            name: e.name,
            store: e.origin_store_name,
            state: e.state,
            event: e.event,
            ticket: e.ticket_type,
          })),
        },
        status: "success",
      })
    }
  } catch (e) {
    // best-effort — 절대 채팅 응답 실패시키지 않음
    // eslint-disable-next-line no-console
    console.error("[autoProcessChatMessage] failed:", e)
  }
}

async function handleWaitingRequest(
  supabase: ReturnType<typeof getServiceClient>,
  input: {
    content: string
    store_uuid: string
    chat_message_id: string
    chat_room_id: string
    sender_user_id: string
    parsed: ReturnType<typeof parseStaffChat>
  },
) {
  const { content, store_uuid, chat_message_id, sender_user_id, parsed } = input

  const meta = parsed.lineMetas?.[0] ?? {
    line_index: 0,
    guest_count: null,
    room_count: null,
    tags: [],
    guest_note: null,
  }

  // categories — 파서의 첫 entry 우선, 없으면 lineMeta 없이 종목 파싱
  //   대기 요청은 이름 없이 종목만 있는 경우가 대부분 (`셔 3인1빵`).
  //   parseStaffChat 은 이름 없으면 entries=[] 이라 entries 로 못 봄.
  //   대신 content 안에 종목 키워드 있는지 자체 검사.
  const categories: string[] = []
  if (content.includes("퍼블") || content.includes("퍼")) categories.push("퍼블릭")
  if (content.includes("하퍼") || content.includes("하")) {
    if (!categories.includes("하퍼")) categories.push("하퍼")
  }
  if (content.includes("셔츠") || content.includes("셔")) {
    if (!categories.includes("셔츠")) categories.push("셔츠")
  }

  if (categories.length === 0) {
    await supabase.from("chat_auto_actions").insert({
      chat_message_id,
      chat_room_id: input.chat_room_id,
      sender_user_id,
      action_type: "waiting_request",
      parsed_json: { reason: "no_category" },
      status: "skipped",
    })
    return
  }

  // 손님 노트 — 두 번째/세 번째 줄 (자유 텍스트) 추출
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const guestNote = lines.length > 1 ? lines.slice(1).join(" ").slice(0, 200) : null

  // 중복 방지 — 최근 60초 내 같은 매장 · 같은 종목 · 같은 요청자 있으면 skip
  const recentCutoff = new Date(Date.now() - 60_000).toISOString()
  const { data: recent } = await supabase
    .from("waiting_requests")
    .select("id")
    .eq("store_uuid", store_uuid)
    .eq("requester_user_id", sender_user_id)
    .eq("status", "active")
    .contains("categories", categories)
    .gte("created_at", recentCutoff)
    .limit(1)
  if (recent && recent.length > 0) {
    await supabase.from("chat_auto_actions").insert({
      chat_message_id,
      chat_room_id: input.chat_room_id,
      sender_user_id,
      action_type: "waiting_request",
      parsed_json: { reason: "duplicate_within_60s", categories },
      ref_id: (recent[0] as { id: string }).id,
      ref_table: "waiting_requests",
      status: "skipped",
    })
    return
  }

  // ── INSERT ─────────────────────────────────────────────
  const { data: waiting, error } = await supabase
    .from("waiting_requests")
    .insert({
      store_uuid,
      requester_user_id: sender_user_id,
      categories,
      guest_count: meta.guest_count,
      room_count: meta.room_count ?? 1,
      tags: meta.tags,
      guest_note: guestNote,
      origin_chat_message_id: chat_message_id,
    })
    .select("id")
    .single()

  // 감사 로그
  await supabase.from("chat_auto_actions").insert({
    chat_message_id,
    chat_room_id: input.chat_room_id,
    sender_user_id,
    action_type: "waiting_request",
    parsed_json: { categories, guest_count: meta.guest_count, tags: meta.tags },
    ref_id: (waiting as { id: string } | null)?.id ?? null,
    ref_table: "waiting_requests",
    status: error ? "failed" : "success",
    error_message: error?.message ?? null,
  })

  if (error || !waiting) return

  // ── Push 발송 — 다른 매장 owner/manager ─────────────────
  const waitingId = (waiting as { id: string }).id
  await broadcastWaitingToOtherStores(supabase, {
    waiting_id: waitingId,
    origin_store_uuid: store_uuid,
    categories,
    guest_count: meta.guest_count,
    room_count: meta.room_count,
  })
}

async function broadcastWaitingToOtherStores(
  supabase: ReturnType<typeof getServiceClient>,
  input: {
    waiting_id: string
    origin_store_uuid: string
    categories: string[]
    guest_count: number | null
    room_count: number | null
  },
) {
  // 다른 매장 실장/사장 조회
  const { data: targets } = await supabase
    .from("store_memberships")
    .select("profile_id, store_uuid")
    .neq("store_uuid", input.origin_store_uuid)
    .in("role", ["owner", "manager"])
    .eq("status", "approved")
    .is("deleted_at", null)

  type Row = { profile_id: string | null; store_uuid: string }
  const uniqueUsers = new Set<string>()
  for (const t of ((targets ?? []) as Row[])) {
    if (t.profile_id) uniqueUsers.add(t.profile_id)
  }
  if (uniqueUsers.size === 0) return

  // 매장 이름
  const { data: store } = await supabase
    .from("stores")
    .select("store_name")
    .eq("id", input.origin_store_uuid)
    .maybeSingle()
  const storeName = (store as { store_name: string } | null)?.store_name ?? "?"

  const catText = input.categories.join("·")
  const guestText =
    input.guest_count
      ? ` ${input.guest_count}인${input.room_count ? `${input.room_count}빵` : ""}`
      : ""

  // 병렬 Push (실패 무시)
  await Promise.all(
    [...uniqueUsers].map(async (uid) => {
      try {
        await sendPushToUser(uid, {
          title: `⏰ ${storeName} 대기 요청`,
          body: `${catText}${guestText}`,
          url: "/m/waiting",
          tag: `waiting-${input.waiting_id}`,
        })
      } catch {
        // 개별 실패 무시
      }
    }),
  )
}
