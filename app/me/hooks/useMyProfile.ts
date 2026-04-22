"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * useMyProfile — reads the current user's basic profile from /api/auth/me.
 * Pure data hook; no navigation, no JSX.
 */

export type MyProfile = {
  user_id: string
  membership_id: string
  store_uuid: string
  role: string
  name: string | null
  phone: string | null
}

type UseMyProfileReturn = {
  profile: MyProfile | null
  loading: boolean
  error: string
  refresh: () => Promise<void>
}

export function useMyProfile(seed?: MyProfile | null): UseMyProfileReturn {
  const [profile, setProfile] = useState<MyProfile | null>(seed ?? null)
  const [loading, setLoading] = useState(!seed)
  const [error, setError] = useState("")
  // Capture whether the hook was seeded at mount so the initial-fetch
  // effect can skip work when the page-level bootstrap already hydrated us.
  const [seededInitial] = useState<boolean>(!!seed)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch("/api/auth/me")
      if (!res.ok) {
        setError("프로필을 불러올 수 없습니다.")
        return
      }
      const d = await res.json()
      setProfile({
        user_id: d.user_id ?? "",
        membership_id: d.membership_id ?? "",
        store_uuid: d.store_uuid ?? "",
        role: d.role ?? "",
        name: d.name ?? null,
        phone: d.phone ?? null,
      })
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (seededInitial) return
    refresh()
  }, [refresh, seededInitial])

  return { profile, loading, error, refresh }
}
