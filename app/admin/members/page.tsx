/**
 * 계정 관리 (/admin/members)
 *
 * Canonical path for the owner/super_admin account-management table.
 * Content is provided by the existing `/owner/accounts` page —
 * exposing it under `/admin/members` keeps the 회원 관리 navigation
 * group (회원 생성 / 가입 승인 / 계정 관리) pointing at /admin/*
 * paths consistently. The original `/owner/accounts` route remains
 * functional for back-compat bookmarks.
 */
export { default } from "../../owner/accounts/page"
