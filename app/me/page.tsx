"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { usePagePerf } from "@/lib/debug/usePagePerf"
import { useMyProfile, type MyProfile } from "./hooks/useMyProfile"
import { useMyAccounts, type MyAccount } from "./hooks/useMyAccounts"
import { usePayeeAccounts, type PayeeAccount } from "./hooks/usePayeeAccounts"
import MyProfileCard from "./components/MyProfileCard"
import MySettlementSummary from "./components/MySettlementSummary"
import MyAccountList from "./components/MyAccountList"
import MyAccountModal from "./components/MyAccountModal"
import PayeeAccountList from "./components/PayeeAccountList"
import PayeeAccountModal from "./components/PayeeAccountModal"

/**
 * STEP-010: 내 정보 (My Info) — 4-tab composition container.
 *
 * Tabs:
 *   1. 기본 정보    — profile card (from useMyProfile)
 *   2. 월 정산      — monthly settlement summary (placeholder)
 *   3. 내 계좌      — settlement_accounts CRUD (from useMyAccounts)
 *   4. 지급 대상 계좌 — payee_accounts CRUD (from usePayeeAccounts)
 *
 * Page is layout-only. Data/logic lives entirely in hooks. Components
 * receive props and never fetch.
 *
 * Bootstrap: the outer wrapper attempts a single /api/me/bootstrap call at
 * mount. On success, it hands seeds to each hook — skipping their initial
 * fetches. On failure, hooks fall back to their legacy per-hook fetches.
 */

type TabKey = "profile" | "settlement" | "accounts" | "payees"

type MeSeed = {
  profile: MyProfile | null
  accounts: MyAccount[] | null
  payees: PayeeAccount[] | null
}

export default function MeInfoPage() {
  const router = useRouter()
  usePagePerf("me")

  // undefined = in-flight, null = bootstrap failed (fall through to hooks)
  const [seed, setSeed] = useState<MeSeed | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/me/bootstrap")
        if (cancelled) return
        if (res.status === 401 || res.status === 403) { router.push("/login"); return }
        if (!res.ok) { setSeed(null); return }
        const data = await res.json()

        // /api/auth/me has no name/phone — map defensively to MyProfile shape.
        const rawProfile = data.profile as Record<string, unknown> | null | undefined
        const profile: MyProfile | null = rawProfile
          ? {
              user_id: (rawProfile.user_id as string) ?? "",
              membership_id: (rawProfile.membership_id as string) ?? "",
              store_uuid: (rawProfile.store_uuid as string) ?? "",
              role: (rawProfile.role as string) ?? "",
              name: (rawProfile.name as string | null) ?? null,
              phone: (rawProfile.phone as string | null) ?? null,
            }
          : null

        setSeed({
          profile,
          accounts: Array.isArray(data.accounts) ? (data.accounts as MyAccount[]) : null,
          payees: Array.isArray(data.payees) ? (data.payees as PayeeAccount[]) : null,
        })
      } catch {
        if (!cancelled) setSeed(null)
      }
    })()
    return () => { cancelled = true }
  }, [router])

  if (seed === undefined) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return <MeInfoInner seed={seed} router={router} />
}

function MeInfoInner({ seed, router }: { seed: MeSeed | null; router: ReturnType<typeof useRouter> }) {
  const [tab, setTab] = useState<TabKey>("profile")

  const profile = useMyProfile(seed?.profile ?? undefined)
  const myAccounts = useMyAccounts(seed?.accounts ?? undefined)
  const payees = usePayeeAccounts(seed?.payees ?? undefined)

  // Auth gate is enforced by middleware.ts (cookie-based). This page
  // relies on that; useMyProfile/useMyAccounts will surface 401 from
  // the server if the session is missing/expired.

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">← 뒤로</button>
          <span className="font-semibold">내 정보</span>
          <div className="w-8" />
        </div>

        {/* Tabs */}
        <div className="px-4 pt-3">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-white/5 border border-white/10 p-1">
            <TabButton active={tab === "profile"} onClick={() => setTab("profile")}>기본 정보</TabButton>
            <TabButton active={tab === "settlement"} onClick={() => setTab("settlement")}>월 정산</TabButton>
            <TabButton active={tab === "accounts"} onClick={() => setTab("accounts")}>내 계좌</TabButton>
            <TabButton active={tab === "payees"} onClick={() => setTab("payees")}>지급 대상</TabButton>
          </div>
        </div>

        {/* Tab content */}
        <div className="px-4 py-4 space-y-3">
          {tab === "profile" && (
            <MyProfileCard
              profile={profile.profile}
              loading={profile.loading}
              error={profile.error}
            />
          )}

          {tab === "settlement" && (
            <MySettlementSummary />
          )}

          {tab === "accounts" && (
            <MyAccountList
              accounts={myAccounts.accounts}
              loading={myAccounts.loading}
              error={myAccounts.error}
              onAddClick={() => myAccounts.openModal()}
              onEdit={(a) => myAccounts.openModal(a)}
              onRemove={(id) => {
                if (typeof window !== "undefined" && !window.confirm("이 계좌를 삭제하시겠습니까?")) return
                myAccounts.removeAccount(id)
              }}
              onSetDefault={myAccounts.setDefault}
            />
          )}

          {tab === "payees" && (
            <PayeeAccountList
              payees={payees.payees}
              loading={payees.loading}
              error={payees.error}
              onAddClick={() => payees.openModal()}
              onEdit={(p) => payees.openModal(p)}
              onRemove={(id) => {
                if (typeof window !== "undefined" && !window.confirm("이 지급 대상을 삭제하시겠습니까?")) return
                payees.removePayee(id)
              }}
            />
          )}
        </div>

        {/* Modals — mounted outside tab switch so open state survives tab change */}
        <MyAccountModal
          open={myAccounts.modalOpen}
          busy={myAccounts.submitting}
          error={myAccounts.error}
          form={myAccounts.form}
          onChange={myAccounts.updateForm}
          onClose={myAccounts.closeModal}
          onSubmit={myAccounts.submitForm}
        />

        <PayeeAccountModal
          open={payees.modalOpen}
          busy={payees.submitting}
          error={payees.error}
          form={payees.form}
          onChange={payees.updateForm}
          onClose={payees.closeModal}
          onSubmit={payees.submitForm}
        />
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 rounded-lg text-xs font-medium transition-colors ${
        active
          ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30"
          : "text-slate-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  )
}
