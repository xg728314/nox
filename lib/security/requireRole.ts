import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
export async function requireRouteRole({ req, roles }: { req: Request; route?: string; roles: string[] }) {
  const ctx = await resolveAuthContext(req)
  if (!roles.includes(ctx.role)) throw new Error("ROLE_FORBIDDEN")
  return ctx
}
