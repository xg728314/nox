"use client"

import type { MyProfile } from "../hooks/useMyProfile"

/**
 * MyProfileCard — displays basic profile info (name, role, store, ids).
 * Pure UI.
 */

type Props = {
  profile: MyProfile | null
  loading: boolean
  error: string
}

function roleLabel(role: string): string {
  if (role === "owner") return "사장"
  if (role === "manager") return "실장"
  if (role === "hostess") return "스태프"
  return role || "-"
}

export default function MyProfileCard({ profile, loading, error }: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-sm font-semibold text-white mb-3">기본 정보</div>

      {error && (
        <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">{error}</div>
      )}

      {loading && (
        <div className="py-4 text-center text-slate-500 text-xs animate-pulse">불러오는 중...</div>
      )}

      {!loading && profile && (
        <div className="space-y-2 text-xs">
          <Row label="이름" value={profile.name ?? "-"} />
          <Row label="역할" value={roleLabel(profile.role)} />
          <Row label="연락처" value={profile.phone ?? "-"} />
          <Row label="매장 ID" value={profile.store_uuid.slice(0, 8) + "…"} mono />
          <Row label="멤버십 ID" value={profile.membership_id.slice(0, 8) + "…"} mono />
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={mono ? "text-slate-300 font-mono" : "text-white"}>{value}</span>
    </div>
  )
}
