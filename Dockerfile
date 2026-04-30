# R29 (2026-04-26): NOX → Google Cloud Run 배포용 Dockerfile.
#
# Multi-stage build:
#   1. deps      — npm ci 로 의존성 설치 (lockfile 캐시 활용)
#   2. builder   — next build (Next.js 15 standalone output)
#   3. runner    — 최소 이미지로 standalone server 실행
#
# Cloud Run 은 PORT env 자동 주입 (기본 8080). HOSTNAME=0.0.0.0 필수.
# next.config.ts 에 `output: "standalone"` 옵션 추가 필요 (별도 작업).

# ─── Stage 1: deps ────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ─── Stage 2: builder ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* 가 빌드 시점에 inline 됨. cloudbuild.yaml 에서 ARG 로 주입.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

RUN npm run build

# ─── Stage 3: runner ──────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

# 비-root 사용자
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# standalone output 복사 (next.config.ts 의 output: "standalone" 필수)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 2026-04-30: sharp (image processing) 명시적 포함.
#   Next.js standalone trace 가 dynamic import / native binary 를 가끔
#   누락. /api/reconcile/.../extract 가 sharp 로 사진 리사이즈 (Anthropic
#   Vision 5MB 한도 회피) 하므로 native bindings + libvips prebuilt 필수.
#   @img 패키지는 platform 별 다른 prefix (@img/sharp-libvips-linux-arm64
#   등). glob 으로 일괄 복사.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

USER nextjs

EXPOSE 8080
CMD ["node", "server.js"]
