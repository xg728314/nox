"use client"

/**
 * /counter/[room_id] — P0 구조 분해 (2026-04-18).
 *
 * 이전 658 LOC 짜리 별도 구현이었던 방 상세 페이지를 CounterPageV2에 위임.
 * CounterPageV2 가 `initialRoomId` prop 을 받아서 rooms 로드 후 자동
 * focus 시킨다. URL 호환성 100% 유지:
 *
 *   - /counter           → CounterPageV2 (기존)
 *   - /counter/<room_id> → CounterPageV2 initialRoomId=<room_id> (new)
 *
 * 두 엔트리가 같은 코드를 사용하므로 더 이상 중복 구현이 없다.
 * (이전 구현은 CounterPageV2와 별도의 /api/sessions/* 호출 경로를 가져
 *  한쪽만 고치면 다른 쪽에 반영되지 않는 회귀를 반복적으로 유발했다.)
 */

import { use } from "react"
import { CounterPageV2 } from "../CounterPageV2"

export default function RoomDetailPage({
  params,
}: {
  params: Promise<{ room_id: string }>
}) {
  const { room_id } = use(params)
  return <CounterPageV2 initialRoomId={room_id} />
}
