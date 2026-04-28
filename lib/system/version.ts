/**
 * R-Ver: 시스템 버전/배포 정보 수집 (서버측, allow-list).
 *
 * 보안:
 *   - process.env 통째로 노출 금지. 명시 필드만 read.
 *   - 모든 값이 public-safe (git sha, revision name, build time 은 sensitive 아님).
 */

import packageJson from "../../package.json"

export type SystemVersionInfo = {
  /** package.json 의 version */
  version: string
  /** 빌드 시점 inline (NEXT_PUBLIC_GIT_SHA). 누락 시 'unknown'. */
  git_sha: string
  git_short_sha: string
  /** 빌드 시점 inline (NEXT_PUBLIC_BUILT_AT, ISO timestamp). 누락 시 null. */
  built_at: string | null
  /** Cloud Build $BUILD_ID. 누락 시 null. */
  build_id: string | null
  /** 빌드 시점 inline 된 commit message 첫 줄. 누락 시 null. */
  git_message: string | null
  /** Cloud Run K_REVISION (예: 'nox-00080-wcg'). 로컬에선 'local'. */
  revision: string
  /** Cloud Run K_SERVICE. */
  service: string
  /** asia-northeast3 등. K_CONFIGURATION 또는 환경 추정. */
  region: string
  /** Node 런타임. */
  runtime: string
  /** 인스턴스 시작 후 경과 (초). */
  uptime_seconds: number
}

/**
 * 환경 변수 allow-list — 절대 process.env 직접 spread 금지.
 */
function readEnv(key: string, fallback = ""): string {
  const v = process.env[key]
  return typeof v === "string" && v.length > 0 ? v : fallback
}

export function collectSystemVersion(): SystemVersionInfo {
  const gitSha = readEnv("NEXT_PUBLIC_GIT_SHA", "unknown")
  const builtAt = readEnv("NEXT_PUBLIC_BUILT_AT", "")
  const buildId = readEnv("NEXT_PUBLIC_BUILD_ID", "")
  const gitMessage = readEnv("NEXT_PUBLIC_GIT_MESSAGE", "")
  const revision = readEnv("K_REVISION", "local")
  const service = readEnv("K_SERVICE", "nox-local")
  // Cloud Run 은 region env 자동 안 줌 — Configuration 이름 또는 hardcoded
  const region = readEnv("CLOUD_RUN_REGION", "asia-northeast3")

  return {
    version: (packageJson as { version?: string }).version ?? "0.0.0",
    git_sha: gitSha,
    git_short_sha: gitSha === "unknown" ? "unknown" : gitSha.slice(0, 7),
    built_at: builtAt || null,
    build_id: buildId || null,
    git_message: gitMessage || null,
    revision,
    service,
    region,
    runtime: `nodejs-${process.version.replace(/^v/, "")}`,
    uptime_seconds: Math.floor(process.uptime()),
  }
}
