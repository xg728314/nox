/**
 * 스태프동기화 — NOX 본체 API 클라이언트
 *
 * 모든 fetch 는 자동 HttpOnly cookie 인증 (`credentials: 'include'`).
 * 401 응답 시 자동 `/login` redirect.
 * 5초 캐시 (홈/스태프 목록 등 빈번 호출에 효과).
 *
 * 사용:
 *   const me = await NoxAPI.me();
 *   const hostesses = await NoxAPI.hostesses();
 *   const rooms = await NoxAPI.rooms();
 *   const types = await NoxAPI.serviceTypes();
 */

(function () {
  'use strict';

  const CACHE_TTL_MS = 5000;
  const cache = new Map();

  async function safeFetch(url, options) {
    const opts = Object.assign(
      { method: 'GET', credentials: 'include', headers: {} },
      options || {}
    );
    if (opts.body && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    try {
      const res = await fetch(url, opts);
      if (res.status === 401) {
        // 인증 만료 → 로그인 페이지로
        if (location.pathname !== '/login') {
          location.href = '/login';
        }
        throw new Error('UNAUTHORIZED');
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 200));
      }
      return await res.json();
    } catch (err) {
      // 네트워크 / 파싱 에러
      if (err.message === 'UNAUTHORIZED') throw err;
      throw new Error('네트워크 오류: ' + (err.message || err));
    }
  }

  function cached(key, ttl, fn) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.t < ttl) return entry.v;
    const promise = fn().then(v => {
      cache.set(key, { v: Promise.resolve(v), t: Date.now() });
      return v;
    });
    cache.set(key, { v: promise, t: Date.now() });
    return promise;
  }

  function invalidate(prefix) {
    for (const k of cache.keys()) {
      if (!prefix || k.startsWith(prefix)) cache.delete(k);
    }
  }

  // ─── Public API ───
  const NoxAPI = {
    // 인증
    me() {
      return cached('me', CACHE_TTL_MS, () => safeFetch('/api/auth/me'));
    },

    memberships() {
      return cached('memberships', CACHE_TTL_MS * 6, () => safeFetch('/api/auth/memberships'));
    },

    logout() {
      invalidate();
      return safeFetch('/api/auth/logout', { method: 'POST' })
        .catch(() => null)
        .then(() => { location.href = '/login'; });
    },

    // 스태프 / 매장
    hostesses() {
      return cached('hostesses', CACHE_TTL_MS, () => safeFetch('/api/manager/hostesses'));
    },

    rooms() {
      return cached('rooms', CACHE_TTL_MS, () => safeFetch('/api/rooms'));
    },

    serviceTypes() {
      return cached('service-types', CACHE_TTL_MS * 12, () =>
        safeFetch('/api/store/service-types'));
    },

    // 건물 전체 (5~8F) — 모바일 + 버튼 시트 picker 용
    buildingHostesses() {
      return cached('building-hostesses', CACHE_TTL_MS * 3, () =>
        safeFetch('/api/building/hostesses'));
    },

    buildingStores() {
      return cached('building-stores', CACHE_TTL_MS * 60, () =>
        safeFetch('/api/building/stores'));
    },

    // 세션
    checkin(roomUuid, managerMembershipId, opts) {
      invalidate('rooms');
      return safeFetch('/api/sessions/checkin', {
        method: 'POST',
        body: {
          room_uuid: roomUuid,
          manager_membership_id: managerMembershipId,
          manager_name: opts && opts.manager_name,
          is_external_manager: !!(opts && opts.is_external_manager)
        }
      });
    },

    addParticipant(sessionId, params) {
      invalidate('rooms');
      return safeFetch('/api/sessions/participants', {
        method: 'POST',
        body: Object.assign({ session_id: sessionId, role: 'hostess' }, params)
      });
    },

    session(sessionId) {
      return safeFetch('/api/sessions/' + encodeURIComponent(sessionId));
    },

    // 정산
    settlement(opts) {
      const q = opts && opts.business_day_id
        ? '?business_day_id=' + encodeURIComponent(opts.business_day_id) : '';
      return safeFetch('/api/manager/settlement/summary' + q);
    },

    crossStoreSettlement(opts) {
      const q = opts && opts.business_date
        ? '?business_date=' + encodeURIComponent(opts.business_date) : '';
      return safeFetch('/api/cross-store/settlement' + q);
    },

    // 채팅
    chatRooms() {
      return cached('chat-rooms', CACHE_TTL_MS, () => safeFetch('/api/chat/rooms'));
    },

    chatMessages(chatRoomId, opts) {
      const params = new URLSearchParams({ chat_room_id: chatRoomId });
      if (opts && opts.cursor) params.set('cursor', opts.cursor);
      if (opts && opts.limit) params.set('limit', String(opts.limit));
      return safeFetch('/api/chat/messages?' + params.toString());
    },

    sendMessage(chatRoomId, content) {
      invalidate('chat-rooms');
      return safeFetch('/api/chat/messages', {
        method: 'POST',
        body: { chat_room_id: chatRoomId, content: content }
      });
    },

    // 출근
    attendance() {
      return cached('attendance', CACHE_TTL_MS, () => safeFetch('/api/attendance'));
    },

    setAttendance(membershipId, action, roomUuid) {
      invalidate('attendance');
      return safeFetch('/api/attendance', {
        method: 'POST',
        body: {
          membership_id: membershipId,
          action: action,
          room_uuid: roomUuid
        }
      });
    },

    // 캐시 제어
    invalidate,
  };

  window.NoxAPI = NoxAPI;
})();
