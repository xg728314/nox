// @ts-check
/**
 * NOX ESLint flat config (eslint v9 style).
 *
 * 2026-05-03: production lint enforcement.
 *
 * 정책:
 *   - core warnings only (errors block build, warnings inform).
 *   - Next.js + TS 권장 + a11y light pass.
 *   - 코드베이스 기존 컨벤션 보존: react/no-unescaped-entities OFF
 *     (한글 문장에 따옴표 자유롭게 쓰기 위함), prefer-const ON.
 *
 * 사용:
 *   npx eslint .                # 전체 lint
 *   npx eslint app/owner/       # 특정 디렉터리
 *   npx eslint --fix .          # 자동 fix
 *
 * Ignored:
 *   .next, node_modules, build artifacts, scripts/visualize-seed (한 번 쓰는 seed)
 */

import next from "@next/eslint-plugin-next"
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import reactPlugin from "eslint-plugin-react"
import reactHooks from "eslint-plugin-react-hooks"

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "scripts/visualize-seed/**",
      "printer-server/**",
      "monitoring/**",
      "*.config.js",
      "*.config.mjs",
      "*.config.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "@next/next": next,
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      // ── TS 안전 ───────────────────────────────────────────────
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off", // 상황별. 핵심 lib 은 자체 검증.
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-non-null-assertion": "off", // ! 허용 — 의도적 단정 흐름이 많음.

      // ── React ────────────────────────────────────────────────
      "react/no-unescaped-entities": "off", // 한글 따옴표/특수문자 자유.
      "react/jsx-key": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ── Next.js ──────────────────────────────────────────────
      "@next/next/no-img-element": "off", // <img> 의도적 사용 (signed URL 등).
      "@next/next/no-html-link-for-pages": "error",

      // ── 일반 ─────────────────────────────────────────────────
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "prefer-const": "warn",
      eqeqeq: ["warn", "smart"],
      "no-var": "error",
    },
  },
  {
    // 테스트는 console.log / any 자유.
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx", "tests/**"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]
