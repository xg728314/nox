/**
 * R-A: VLM 의 image_quality.warnings[] 자연어 텍스트에서 keyword 를 검출해
 * 사용자에게 다음 촬영 시 행동을 가이드하는 한국어 hint 매핑.
 *
 * 사용:
 *   const hints = collectHintsFromWarnings(extraction.image_quality?.warnings)
 *   hints.forEach(h => render(h.icon, h.message))
 *
 * R-B 의 ImageQualityPanel 컴포넌트가 이 함수를 호출.
 */

export type QualityHint = {
  /** 화면 표시 이모지 */
  icon: string
  /** 가이드 한국어 한 줄 */
  message: string
  /** 어느 keyword 가 매칭됐는지 (디버깅 / 분류) */
  keyword: string
}

/**
 * keyword (lowercase, 한국어 부분문자열) → 가이드 hint.
 * VLM warnings 텍스트에 keyword 가 포함되면 해당 hint 가 노출됨.
 *
 * 우선순위 — 위에서 아래로 매칭. 같은 warning 이 여러 keyword 매칭되면
 * 모두 수집 (사용자에게 정확한 사유 다 보여줌).
 */
const HINT_RULES: ReadonlyArray<{ keyword: string; icon: string; message: string }> = [
  // 조도
  { keyword: "조도", icon: "💡", message: "주변 조도 부족 — 다음엔 천장등 켜고 촬영. 스마트폰 LED 보조도 효과적." },
  { keyword: "어두",  icon: "💡", message: "어두운 환경 — 더 밝은 곳에서 또는 추가 조명 켜고 재촬영 권장." },
  { keyword: "그림자", icon: "🌥️", message: "그림자 짙음 — 폰을 종이 정면 위로 들어 그림자가 종이를 덮지 않도록." },
  // 포커스 / 흔들림
  { keyword: "흐림",   icon: "🤳", message: "사진이 흐릿함 — 양손으로 폰 잡고 셔터 후 1초 정지." },
  { keyword: "흔들",   icon: "🤳", message: "손떨림 의심 — 양손 또는 한쪽 팔꿈치를 책상에 받치고 촬영." },
  { keyword: "포커스", icon: "🎯", message: "초점 안 맞음 — 종이 위 글자에 한 번 탭해서 포커스 잡고 촬영." },
  { keyword: "blur",   icon: "🤳", message: "사진이 흐릿함 — 양손으로 폰 잡고 셔터 후 1초 정지." },
  // 손글씨
  { keyword: "흘림",     icon: "✍️", message: "손글씨가 흘림체 — 다음 작성 시 더 또박또박 권장." },
  { keyword: "잉크",     icon: "✍️", message: "잉크 번짐 — 마른 펜 사용 + 종이 마를 때까지 대기 후 재촬영." },
  { keyword: "겹쳐",     icon: "✍️", message: "글자 겹침 — 칸 안에 한 글자씩 충분히 떨어져 작성 권장." },
  { keyword: "읽기 어려", icon: "✍️", message: "사람이 봐도 어려운 글씨 — 또박또박 작성 또는 사람이 직접 입력." },
  // 가려짐 / 프레임
  { keyword: "가려",    icon: "📐", message: "종이 일부 가려짐 — 종이 전체가 프레임 안에 들어가도록 한 발짝 뒤로." },
  { keyword: "잘림",    icon: "📐", message: "종이 일부 잘림 — 폰을 위로 들어 전체가 보이도록." },
  { keyword: "프레임",   icon: "📐", message: "프레임 벗어남 — 종이 4면이 모두 화면 안에 들어오게." },
  // 회전 / 각도
  { keyword: "회전",    icon: "🔄", message: "사진이 회전됨 — 다음엔 정방향으로 촬영 (가로/세로 일관)." },
  { keyword: "각도",    icon: "📏", message: "각도 기울어짐 — 종이 정면에서 수직으로 촬영." },
  { keyword: "비스듬",  icon: "📏", message: "비스듬한 각도 — 종이 위에서 수직 내려다보며 촬영." },
]

/**
 * warnings 배열 → 매칭되는 hint 들을 dedupe 해서 반환.
 *
 * 매칭 규칙:
 *   - 각 warning 텍스트를 lowercase 로 변환
 *   - HINT_RULES 의 keyword 가 부분문자열로 포함되면 매칭
 *   - 같은 keyword 가 여러 warning 에서 매칭되면 한 번만 노출 (icon+message dedupe)
 *
 * @param warnings VLM 이 채운 자연어 경고 배열. undefined / 빈 배열이면 빈 결과.
 */
export function collectHintsFromWarnings(warnings?: string[] | null): QualityHint[] {
  if (!warnings || warnings.length === 0) return []
  const seen = new Set<string>()
  const out: QualityHint[] = []
  for (const w of warnings) {
    const lc = (w ?? "").toLowerCase()
    if (!lc) continue
    for (const rule of HINT_RULES) {
      if (!lc.includes(rule.keyword.toLowerCase())) continue
      const key = `${rule.icon}::${rule.message}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ icon: rule.icon, message: rule.message, keyword: rule.keyword })
    }
  }
  return out
}

/**
 * confidence 0~1 을 신호등 문자열 (UI badge 색상 분기용).
 *   ≥ 0.85 → "green"
 *   ≥ 0.6  → "amber"
 *   <  0.6 → "red"
 *   undefined → "gray"
 */
export function confidenceLevel(c?: number | null): "green" | "amber" | "red" | "gray" {
  if (c == null || !Number.isFinite(c)) return "gray"
  if (c >= 0.85) return "green"
  if (c >= 0.6) return "amber"
  return "red"
}
