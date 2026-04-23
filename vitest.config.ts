import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

/**
 * ROUND-B — pure-function unit test runner.
 *
 * Scope: only files under `**\/__tests__/*.test.ts`. We intentionally do NOT
 * pull in Next.js / React / Supabase runtime — tests exercise pure helpers
 * (settlement calc, lifecycle gates, aggregate resolver, BLE inference,
 * audit response shape) directly.
 */
export default defineConfig({
  test: {
    include: ["lib/**/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 5000,
    globals: false,
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
})
