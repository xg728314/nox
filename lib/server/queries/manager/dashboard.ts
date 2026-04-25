import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type ManagerDashboardResponse = {
  user_id: string
  store_uuid: string
  role: AuthContext["role"]
  membership_status: AuthContext["membership_status"]
  manager_shell_enabled: boolean
  visible_sections: string[]
  assigned_hostess_count: number
  assigned_hostesses_preview: { hostess_id: string; hostess_name: string }[]
}

export async function getManagerDashboard(auth: AuthContext): Promise<ManagerDashboardResponse> {
  const supabase = getServiceClient()

  let assignedIds: string[] = []

  if (auth.role === "owner") {
    const { data: allHostesses, error: allHostessesError } = await supabase
      .from("store_memberships")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("role", "hostess")
      .eq("status", "approved")

    if (allHostessesError) throw new Error("Failed to query hostess assignments.")
    assignedIds = (allHostesses ?? []).map((hostess) => hostess.id)
  } else {
    const { data: assignments, error: assignmentsError } = await supabase
      .from("hostesses")
      .select("membership_id")
      .eq("store_uuid", auth.store_uuid)
      .eq("manager_membership_id", auth.membership_id)

    if (assignmentsError) throw new Error("Failed to query hostess assignments.")
    assignedIds = (assignments ?? []).map((assignment) => assignment.membership_id)
  }
  const assignedCount = assignedIds.length

  let preview: { hostess_id: string; hostess_name: string }[] = []
  if (assignedCount > 0) {
    const previewIds = assignedIds.slice(0, 5)

    const { data: hostesses, error: hostessesError } = await supabase
      .from("store_memberships")
      .select("id, profiles!store_memberships_profile_id_fkey(full_name)")
      .eq("store_uuid", auth.store_uuid)
      .eq("role", "hostess")
      .in("id", previewIds)

    if (!hostessesError && hostesses) {
      preview = hostesses.map((h: { id: string; profiles: { full_name: string }[] | null }) => ({
        hostess_id: h.id,
        hostess_name: h.profiles?.[0]?.full_name ?? "",
      }))
    }
  }

  return {
    user_id: auth.user_id,
    store_uuid: auth.store_uuid,
    role: auth.role,
    membership_status: auth.membership_status,
    manager_shell_enabled: auth.role === "manager",
    visible_sections: [
      "assigned_hostesses",
      "manager_settlement_summary",
      "line_revenue_summary",
    ],
    assigned_hostess_count: assignedCount,
    assigned_hostesses_preview: preview,
  }
}
