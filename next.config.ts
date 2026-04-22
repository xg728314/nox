import type { NextConfig } from "next"

/**
 * Permanent (308) redirect for the deprecated `/approvals` path.
 *
 * In the members-UI-restructure round the canonical approvals route
 * became `/admin/approvals` (under the 회원 관리 section). Legacy
 * bookmarks and any stale JS that still navigates to `/approvals`
 * are transparently redirected. Sub-path form covers any future
 * additions.
 *
 * Next.js applies these redirects BEFORE middleware, so the
 * `/approvals/:path*` matcher entry in `middleware.ts` becomes dead
 * weight — intentionally left in place as belt-and-suspenders until
 * production traffic confirms the redirect.
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/approvals",
        destination: "/admin/approvals",
        permanent: true,
      },
      {
        source: "/approvals/:path*",
        destination: "/admin/approvals/:path*",
        permanent: true,
      },
    ]
  },
}

export default nextConfig
