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

  // 전역 노출
  window.SecUtils = {
    escapeHtml,
    safeParam,
    setText,
  }
})()
