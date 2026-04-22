/**
 * 🔁 DEPRECATED path — `/api/admin/members/invite`
 *
 * Canonical path is now `/api/admin/members/create` (matches the UI
 * terminology "회원 생성"). This file is a thin backward-compat
 * forwarder: if any older client still POSTs to the old path, the
 * handler is the same `POST` exported from the new location.
 *
 * No new code should reference `/api/admin/members/invite`. Plan to
 * remove this forwarder after one release cycle once Vercel logs
 * confirm zero traffic.
 */
export { POST } from "../create/route"
