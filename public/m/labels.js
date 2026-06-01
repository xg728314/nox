/**
 * 스태프동기화 — 라벨 커스텀 시스템 (클라이언트 사이드)
 *
 * iOS App Store 심사용 기본 단어 (P 타입 / 지점 A / 세션) 와
 * 사용자가 원하는 본 단어 (퍼블릭 / 마블 / 메이드) 를 토글로 전환.
 *
 * 보안:
 *   - localStorage 키 'staffsync.labelMode' 만 저장 (값: 'business' | 'venue')
 *   - 단어 사전은 코드 안에 (외부 fetch X)
 *   - 사용자 매장 본 데이터는 저장 안 함 (이건 향후 백엔드 store_settings.display_labels)
 *
 * 사용:
 *   <script src="/m/labels.js" defer></script>
 *   페이지 DOMContentLoaded 시 자동 적용.
 *
 *   토글 변경:
 *     LabelMode.set('venue')   → 본 단어로 변경
 *     LabelMode.set('business') → 일반 단어로 (기본)
 *     LabelMode.toggle()        → 토글
 */

(function () {
  'use strict'

  // 변환 사전 (business → venue)
  // 길이가 긴 토큰 먼저 (substring 충돌 방지)
  const DICT = [
    // 종목 + 시간 조합 (길이가 긴 것부터)
    ['S+H 타입', '셔츠+하퍼'],
    ['S 타입 풀 (60분)', '셔츠 완티'],
    ['P 타입 풀 (60분)', '퍼블릭 완티'],
    ['H 타입 풀 (60분)', '하퍼 완티'],
    ['S 타입 하프 (30분)', '셔츠 반티'],
    ['P 타입 하프 (30분)', '퍼블릭 반티'],
    ['H 타입 하프 (30분)', '하퍼 반티'],
    ['S 타입 추가 (15분)', '셔츠 차3'],
    ['P 타입 추가 (15분)', '퍼블릭 차3'],
    ['H 타입 추가 (15분)', '하퍼 차3'],

    // 종목 단독
    ['S 타입', '셔츠'],
    ['P 타입', '퍼블릭'],
    ['H 타입', '하퍼'],

    // 시간 단독
    ['풀 (60분)', '완티'],
    ['하프 (30분)', '반티'],
    ['추가 (15분)', '차3'],
    ['하프+추가', '반차3'],

    // 매장 이름 (정확 매칭)
    ['본 매장', '마블'],
    ['지점 A', '라이브'],
    ['지점 B', '신세계'],
    ['지점 C', '아지트'],
    ['지점 D', '7층'],
    ['지점 E', '8층'],
    ['지점 F', '파티'],
    ['지점 G', '버닝'],
    ['지점 H', '흑백'],
    ['지점 I', '아라요'],
    ['지점 J', '아우라'],
    ['지점 K', '라엔'],
    ['지점 L', '황진이'],
    ['지점 M', '새벽'],

    // 정산 / 액션
    ['세션 시작', '메이드 시작'],
    ['세션 등록', '메이드 등록'],
    ['세션 추가', '메이드 추가'],
    ['세션 갯수', '메이드 갯수'],
    ['곧 끝나는 세션', '곧 끝나는 메이드'],
    ['세션', '메이드'],
    ['매니저 수익', '떼는 돈'],
    ['세션당 매니저 수익', '메이드당 떼는 돈'],
    ['인센티브', '인센'],
    ['고객', '손님']
  ]

  const KEY = 'staffsync.labelMode'

  const LabelMode = {
    get() {
      try {
        return localStorage.getItem(KEY) || 'business'
      } catch {
        return 'business'
      }
    },

    set(mode) {
      try {
        if (mode === 'business' || mode === 'venue') {
          localStorage.setItem(KEY, mode)
        }
      } catch {
        /* storage 차단 시 무시 */
      }
      this.apply()
    },

    toggle() {
      this.set(this.get() === 'business' ? 'venue' : 'business')
    },

    apply() {
      const mode = this.get()
      if (mode !== 'venue') return // 기본 페이지가 business 톤이므로 별도 작업 X
      this.applyToTree(document.body)
    },

    applyToTree(root) {
      // 텍스트 노드만 순회 (HTML 구조 / 클래스명 / 변수 안전)
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            // script, style 안의 텍스트 제외
            const p = node.parentNode
            if (!p) return NodeFilter.FILTER_REJECT
            const tag = p.nodeName
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
              return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_ACCEPT
          }
        }
      )

      const nodes = []
      let n
      while ((n = walker.nextNode())) {
        nodes.push(n)
      }

      for (const node of nodes) {
        let txt = node.nodeValue
        if (!txt) continue
        let changed = false
        for (const [from, to] of DICT) {
          if (txt.includes(from)) {
            txt = txt.split(from).join(to)
            changed = true
          }
        }
        if (changed) node.nodeValue = txt
      }
    },

    // 사용자 토글 UI 만들 때 사용
    getDictionary() {
      return DICT.slice()
    }
  }

  // 전역 노출
  window.LabelMode = LabelMode

  // DOM 준비 시 자동 적용
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => LabelMode.apply())
  } else {
    LabelMode.apply()
  }
})()
