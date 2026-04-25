import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type HostessPreview = {
  hostess_id: string
  hostess_name: string
}

export type ManagerHostessesResponse = {
  store_uuid: string
  role: AuthContext["role"]
  hostesses: HostessPreview[]
}

export async function getManagerHostesses(auth: AuthContext): Promise<ManagerHostessesResponse> {
  const supabase = getServiceClient()

  let hostessIds: string[] = []

  if (auth.role === "owner") {
    const { data: allHostesses, error: allHostessesError } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("role", "hostess")
      .eq("status", "approved")

    if (allHostessesError) throw new Error("Failed to query hostess assignments.")
    hostessIds = (allHostesses ?? []).map((hostess) => hostess.id)
  } else {
    const { data: assignments, error: assignmentsError } = await supabase
      .from("hostesses")
      .select("membership_id")
      .eq("store_uuid", auth.store_uuid)
      .eq("manager_membership_id", auth.membership_id)

    if (assignmentsError) throw new Error("Failed to query hostess assignments.")
    hostessIds = (assignments ?? []).map((assignment) => assignment.membership_id)
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
    .select("id, profiles!store_memberships_profile_id_fkey(full_name)")
    .eq("store_uuid", auth.store_uuid)
    .eq("role", "hostess")
    .in("id", hostessIds)

  if (hostessesError) throw new Error("Failed to query hostess details.")

  return {
    store_uuid: auth.store_uuid,
    role: auth.role,
    hostesses: (hostesses ?? []).map((h: { id: string; profiles: { full_name: string }[] | null }) => ({
      hostess_id: h.id,
      hostess_name: h.profiles?.[0]?.full_name ?? "",
    })),
  }
}
