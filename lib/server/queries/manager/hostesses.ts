import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type HostessPreview = {
  hostess_id: string
  hostess_name: string
  // R-mobile (2026-06-01): 스태프동기화 모바일 앱이 필요로 하는 식별자/메타.
  //   기존 클라이언트는 추가 필드를 무시해도 안전 (additive).
  membership_id: string
  profile_id: string | null
  role: string
  status: string
  manager_membership_id: string | null
  origin_store_uuid: string | null
}

export type ManagerHostessesResponse = {
  store_uuid: string
  role: AuthContext["role"]
  hostesses: HostessPreview[]
}

export async function getManagerHostesses(auth: AuthContext): Promise<ManagerHostessesResponse> {
  const supabase = getServiceClient()

  let hostessIds: string[] = []
  // hostess 행에서 가져오는 부가 정보 (manager_membership_id / origin_store_uuid)
  // 를 membership_id 별로 매핑. owner 경로에서는 비어 있을 수 있음.
  const hostessExtras = new Map<string, { manager_membership_id: string | null; origin_store_uuid: string | null }>()

  if (auth.role === "owner") {
    const { data: allHostesses, error: allHostessesError } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("role", "hostess")
      .eq("status", "approved")

    if (allHostessesError) throw new Error("Failed to query hostess assignments.")
    hostessIds = (allHostesses ?? []).map((hostess) => hostess.id)

    // owner 경로에서도 manager_membership_id / origin_store_uuid 를 추가로 시도.
    // hostesses 테이블이 한 store 의 hostess 행을 갖고 있다면 매핑한다.
    if (hostessIds.length > 0) {
      const { data: hRows } = await supabase
        .from("hostesses")
        .select("membership_id, manager_membership_id, origin_store_uuid")
        .eq("store_uuid", auth.store_uuid)
        .in("membership_id", hostessIds)
      for (const row of hRows ?? []) {
        const r = row as { membership_id: string; manager_membership_id: string | null; origin_store_uuid: string | null }
        hostessExtras.set(r.membership_id, {
          manager_membership_id: r.manager_membership_id ?? null,
          origin_store_uuid: r.origin_store_uuid ?? null,
        })
      }
    }
  } else {
    const { data: assignments, error: assignmentsError } = await supabase
      .from("hostesses")
      .select("membership_id, manager_membership_id, origin_store_uuid")
      .eq("store_uuid", auth.store_uuid)
      .eq("manager_membership_id", auth.membership_id)

    if (assignmentsError) throw new Error("Failed to query hostess assignments.")
    for (const row of assignments ?? []) {
      const r = row as { membership_id: string; manager_membership_id: string | null; origin_store_uuid: string | null }
      hostessIds.push(r.membership_id)
      hostessExtras.set(r.membership_id, {
        manager_membership_id: r.manager_membership_id ?? null,
        origin_store_uuid: r.origin_store_uuid ?? null,
      })
    }
  }

  if (hostessIds.length === 0) {
    return {
      store_uuid: auth.store_uuid,
      role: auth.role,
      hostesses: [],
    }
  }

  const { data: hostesses, error: hostessesError } = await supabase
    .from("store_memberships")
    .select("id, profile_id, role, status, profiles!store_memberships_profile_id_fkey(full_name)")
    .eq("store_uuid", auth.store_uuid)
    .eq("role", "hostess")
    .in("id", hostessIds)

  if (hostessesError) throw new Error("Failed to query hostess details.")

  type Row = {
    id: string
    profile_id: string | null
    role: string
    status: string
    profiles: { full_name: string }[] | null
  }

  return {
    store_uuid: auth.store_uuid,
    role: auth.role,
    hostesses: (hostesses ?? []).map((h: Row) => {
      const extras = hostessExtras.get(h.id) ?? { manager_membership_id: null, origin_store_uuid: null }
      return {
        hostess_id: h.id,
        hostess_name: h.profiles?.[0]?.full_name ?? "",
        membership_id: h.id,
        profile_id: h.profile_id ?? null,
        role: h.role,
        status: h.status,
        manager_membership_id: extras.manager_membership_id,
        origin_store_uuid: extras.origin_store_uuid,
      }
    }),
  }
}
