/**
 * lib/chat/bot/composer.ts
 *
 * R36: 봇 답장 payload 생성기. 3가지 패턴:
 *   A. understand_confirm  : "이렇게 이해했어요, 맞나요?"
 *   B. partial_missing     : "○○를 못 찾았어요, 이 중 골라주세요"
 *   C. template_suggest    : "이 형식으로 다시 써주세요 · 예시"
 *
 * 반환 payload 는 채팅 메시지 body (JSON) · 클라이언트에서 BotReplyCard 로 렌더.
 *
 * 톤 원칙 (README):
 *   - "죄송 · 잘 모르겠어요" (자기 낮춤)
 *   - "이렇게 이해했어요, 맞나요?" (확인)
 *   - "다음부턴 ~ 붙이면 더 정확해요" (안내)
 *   - 절대 금지: "형식 틀렸어요 · 필수 항목 · 다시 입력하세요" (지적 어투)
 */

export type BotReplyPayload =
  | UnderstandConfirmPayload
  | PartialMissingPayload
  | TemplateSuggestPayload

export type UnderstandConfirmPayload = {
  pattern: "understand_confirm"
  title: string                          // "대기 요청으로 이해했어요:"
  fields: Array<{ label: string; value: string }>  // 이해된 항목들
  actions: {
    confirm_label?: string               // "✓ 맞음 (자동 등록)"
    edit_label?: string                  // "✏ 수정"
    ignore_label?: string                // "무시"
  }
  auto_register_after_sec?: number       // 3 → N초 후 확인 없으면 자동 등록
  dispatch_id?: string                   // POST /pattern-dispatch/[id]/confirm 대상
  compressed?: boolean                   // 피크 시간대 → 상세 X · pill 만
}

export type PartialMissingPayload = {
  pattern: "partial_missing"
  title: string                          // "「다미」 아가씨를 못 찾았어요."
  candidates?: Array<{
    label: string                        // "다혜 (버닝 3방)"
    membership_id?: string
    action?: "select_existing" | "create_provisional" | "other"
  }>
  hint?: string                          // "💡 다음부턴 매장 접두를 붙이면 더 정확해요"
  hint_example?: string                  // "예: 「버닝 다미 하퍼 완메」"
  compressed?: boolean
}

export type TemplateSuggestPayload = {
  pattern: "template_suggest"
  title: string                          // "어느 아가씨·어느 방인지 알 수 없어요."
  template_lines: string[]               // ["[매장] [아가씨] [종목] [완메]", "예: 「마블 지연 셔츠 완메」"]
  refill_hint?: string                   // "다시 쓰기" 버튼 라벨
  refill_template?: string               // 클릭 시 입력창에 삽입될 template
  compressed?: boolean
}

/** Pattern A · 이해 시도 확인 */
export function composeUnderstandConfirm(input: {
  eventType: "checkin" | "checkout" | "extend" | "waiting" | "choice"
  storeName?: string
  hostessNames: string[]                 // 여러 명 가능
  category?: string                      // 하퍼 / 셔츠 / 퍼블릭
  timeType?: string                      // 완티 / 반티 / 차3 / 반차3
  roomLabel?: string                     // 3번방
  extraNotes?: string[]                  // ["안본인원", "초이스 진행 중"]
  dispatchId?: string
  compressed?: boolean
}): UnderstandConfirmPayload {
  const title =
    input.eventType === "checkin"  ? "체크인으로 이해했어요:" :
    input.eventType === "checkout" ? "종료로 이해했어요:" :
    input.eventType === "extend"   ? "연장으로 이해했어요:" :
    input.eventType === "waiting"  ? "대기 요청으로 이해했어요:" :
    input.eventType === "choice"   ? "초이스 요청으로 이해했어요:" :
    "메시지를 이렇게 이해했어요:"

  const fields: Array<{ label: string; value: string }> = []
  if (input.storeName) fields.push({ label: "매장", value: input.storeName })
  if (input.hostessNames.length > 0) fields.push({ label: "아가씨", value: input.hostessNames.join(", ") })
  if (input.roomLabel) fields.push({ label: "방", value: input.roomLabel })
  if (input.category) fields.push({ label: "종목", value: input.category })
  if (input.timeType) fields.push({ label: "시간", value: input.timeType })
  if (input.extraNotes && input.extraNotes.length > 0) fields.push({ label: "메모", value: input.extraNotes.join(" · ") })

  return {
    pattern: "understand_confirm",
    title,
    fields,
    actions: {
      confirm_label: "✓ 맞음",
      edit_label: "✏ 수정",
      ignore_label: "무시",
    },
    auto_register_after_sec: 3,
    dispatch_id: input.dispatchId,
    compressed: input.compressed,
  }
}

/** Pattern B · 일부 누락 · 후보 선택 */
export function composePartialMissing(input: {
  missingName: string
  candidates?: Array<{ label: string; membership_id?: string }>
  hint?: string
  hintExample?: string
  compressed?: boolean
}): PartialMissingPayload {
  return {
    pattern: "partial_missing",
    title: `「${input.missingName}」 아가씨를 못 찾았어요.`,
    candidates: [
      ...(input.candidates ?? []).map(c => ({
        label: c.label,
        membership_id: c.membership_id,
        action: "select_existing" as const,
      })),
      {
        label: `➕ 새 아가씨로 등록: ${input.missingName}`,
        action: "create_provisional",
      },
      { label: "다른 아가씨...", action: "other" },
    ],
    hint: input.hint ?? "💡 다음부턴 매장 접두를 붙이면 더 정확해요",
    hint_example: input.hintExample,
    compressed: input.compressed,
  }
}

/** Pattern C · 완전 실패 · template 제안 */
export function composeTemplateSuggest(input: {
  reason?: string                    // "어느 아가씨·어느 방인지 알 수 없어요"
  templateLines: string[]            // [format, example]
  refillTemplate?: string
  compressed?: boolean
}): TemplateSuggestPayload {
  return {
    pattern: "template_suggest",
    title: input.reason ?? "메시지를 이해하지 못했어요.",
    template_lines: input.templateLines,
    refill_hint: input.refillTemplate ? "이 형식으로 다시 쓰기" : undefined,
    refill_template: input.refillTemplate,
    compressed: input.compressed,
  }
}

/** 신입 튜토리얼 봇 메시지 */
export function composeNewbieTutorial(storeName: string, examples: string[]): TemplateSuggestPayload {
  return {
    pattern: "template_suggest",
    title: `${storeName} 채팅방에 오신 것을 환영합니다 👋`,
    template_lines: [
      "이 채팅방은 자동 파싱 봇이 있어요.",
      "이 형식으로 쓰면 자동 등록됩니다:",
      "",
      "  [매장] [아가씨] [종목] [완메 · 반메 · 끝 · 연장 · 스타트]",
      "",
      "예시:",
      ...examples.map(e => `  ${e}`),
      "",
      "💡 형식 틀려도 봇이 정중하게 안내합니다. 편하게 쓰세요!",
    ],
    compressed: false,
  }
}
