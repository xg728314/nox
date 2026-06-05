/**
 * 스태프동기화 — 공용 보안 유틸리티
 *
 * Phase 2 보안 강화 (2026-06-01):
 *   - URL 파라미터 / 사용자 입력을 innerHTML 로 렌더할 때 escape 필수
 *   - 화이트리스트 lookup 으로 1차 방어 + escapeHtml 로 2차 방어
 */

(function () {
  'use strict'

  /**
   * HTML 특수문자 escape — XSS 1차 방어선
   * &, <, >, ", ', / 모두 escape
   */
  function escapeHtml(str) {
    if (str == null) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#x2F;')
  }

  /**
   * URL 파라미터 안전 추출 (화이트리스트 검증 추천)
   * @param {string} key URL 파라미터 키
   * @param {string[]|null} allowed 허용 값 목록 (null 시 escape 만 적용)
   * @param {string} fallback 기본값
   */
  function safeParam(key, allowed, fallback) {
    try {
      const params = new URLSearchParams(location.search)
      const raw = params.get(key)
      if (raw == null) return fallback
      if (allowed && Array.isArray(allowed)) {
        return allowed.includes(raw) ? raw : fallback
      }
      // 화이트리스트 없으면 길이 제한 + escape
      if (raw.length > 100) return fallback
      return escapeHtml(raw)
    } catch {
      return fallback
    }
  }

  /**
   * 안전한 innerHTML 대체 — text content 만 설정
   * 마크업이 필요하면 escape 후 직접 조합
   */
  function setText(el, text) {
    if (!el) return
    el.textContent = text == null ? '' : String(text)
  }

  /**
   * 햅틱 피드백 (안전한 wrapper)
   * @param {number|number[]} pattern 진동 패턴 (기본 8ms)
   */
  function haptic(pattern) {
    try {
      if (navigator && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern == null ? 8 : pattern)
      }
    } catch {
      /* 일부 브라우저는 vibrate 가 throw — 무시 */
    }
  }

  /**
   * 토스트 메시지 (1.8초 자동 사라짐)
   * @param {string} msg 표시할 텍스트 (escape 됨)
   * @param {object} [opts] 옵션
   * @param {number} [opts.duration=1800] 표시 시간 ms
   * @param {'default'|'success'|'error'} [opts.type='default'] 색상 종류
   */
  function toast(msg, opts) {
    if (typeof document === 'undefined') return
    const options = opts || {}
    const duration = options.duration || 1800
    const type = options.type || 'default'

    const bg =
      type === 'success'
        ? 'rgba(21,128,61,0.92)'
        : type === 'error'
          ? 'rgba(185,28,28,0.92)'
          : 'rgba(45,43,38,0.92)'

    const el = document.createElement('div')
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:120px',
      'transform:translateX(-50%) translateY(8px)',
      'padding:10px 18px',
      'background:' + bg,
      'color:#fff',
      'border-radius:999px',
      'font-size:13px',
      'font-weight:700',
      'letter-spacing:-0.01em',
      'z-index:99999',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'box-shadow:0 8px 24px rgba(0,0,0,0.18)',
      'opacity:0',
      'transition:opacity 0.18s, transform 0.18s',
      'pointer-events:none',
      'max-width:80vw',
      'text-align:center',
    ].join(';')
    el.textContent = String(msg == null ? '' : msg)
    document.body.appendChild(el)
    // 다음 프레임에서 fade-in
    requestAnimationFrame(() => {
      el.style.opacity = '1'
      el.style.transform = 'translateX(-50%) translateY(0)'
    })
    setTimeout(() => {
      el.style.opacity = '0'
      el.style.transform = 'translateX(-50%) translateY(8px)'
      setTimeout(() => el.remove(), 220)
    }, duration)
  }

  /**
   * mock 액션 헬퍼 — 햅틱 + 토스트 + (옵션) 페이지 이동
   * @param {string} msg 토스트 메시지
   * @param {object} [opts] { href?: string, delay?: number, type?: string }
   */
  function mockAction(msg, opts) {
    const options = opts || {}
    haptic(options.haptic || 10)
    if (msg) toast(msg, { type: options.type })
    if (options.href) {
      setTimeout(() => {
        location.href = options.href
      }, options.delay == null ? 500 : options.delay)
    }
  }

  // 전역 노출
  window.SecUtils = {
    escapeHtml,
    safeParam,
    setText,
  }
  window.NoxUI = {
    toast,
    haptic,
    mockAction,
    escapeHtml,
  }
  // 짧은 별칭 (인라인 onclick 에서 쓰기 편하게)
  window.noxToast = toast
  window.noxHaptic = haptic
})()
