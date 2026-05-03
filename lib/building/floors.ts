/**
 * 건물 층 단일 원본 (single source of truth).
 *
 * 2026-04-24: 이전에는 `[5-8]` 정규식 / `5|6|7|8` 타입 / FLOOR_TABS 배열
 *   이 각각 다른 파일에 중복 하드코딩 되어 있었다. 9층 추가 같은 변경이
 *   어디를 고쳐야 할지 파악하기 어려움. 여기 한 곳만 바꾸면 전체 앱이
 *   따라가도록 재구성.
 *
 * 운영 규칙
 *   - 현재 건물: 5F~8F (4개 층).
 *   - 층 추가/삭제 시 여기 BUILDING_FLOORS 만 변경. 다른 파일은 이 상수를
 *     import 한다.
 *   - FloorId 타입은 numeric 고정 범위. 9층 추가 시 타입도 확장 필요
 *     (컴파일러가 관련 switch/record 를 다 잡아준다 — 고의적 선택).
 */

/** 이 건물에서 유효한 층 목록. 오름차순. */
// 2026-05-02 R-Cafe: 3층 카페 추가 (5~8층 매장 주문 받기). 4층은 미사용.
export const BUILDING_FLOORS = [3, 5, 6, 7, 8] as const

export type FloorId = typeof BUILDING_FLOORS[number]

/** 카페가 위치한 층 (배달 흐름의 source). 현재 3층. */
export const CAFE_FLOOR: FloorId = 3
/** 카페 매장이라고 간주할 floor (스토어 분기용). */
export function isCafeFloor(floor: number | null | undefined): boolean {
  return floor === CAFE_FLOOR
}

export const MIN_FLOOR: FloorId = BUILDING_FLOORS[0]
export const MAX_FLOOR: FloorId = BUILDING_FLOORS[BUILDING_FLOORS.length - 1] as FloorId

/** 층 라벨: 5 → "5F". */
export function floorLabel(n: FloorId): string {
  return `${n}F`
}

/** 런타임 값이 유효한 층인지 검사. unknown 입력에도 안전. */
export function isFloorId(n: unknown): n is FloorId {
  return typeof n === "number" && (BUILDING_FLOORS as readonly number[]).includes(n)
}

/** 정규식 만들기: `floor-5` ~ `floor-8`. scopeResolver 에서 사용. */
export function floorScopeRegex(): RegExp {
  const digits = BUILDING_FLOORS.map(String).join("|")
  return new RegExp(`^floor-(${digits})$`)
}
