"use client"
import Link from "next/link"
import { useState } from "react"
import { useApi } from "../../_hooks/useApi"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"

/**
 * 라운지 (커뮤니티 게시판) — /m/lounge
 *   미드나잇테라스 라운지 참고.
 *   R-marketplace (2026-07-05).
 */
type Post = {
  id: string
  author_nickname: string | null
  board: string
  title: string
  body: string
  view_count: number
  like_count: number
  comment_count: number
  is_notice: boolean
  created_at: string
}

const BOARDS = [
  { slug: "free", label: "자유 수다", emoji: "🌸" },
  { slug: "hot", label: "인기글", emoji: "🔥" },
  { slug: "promo", label: "홍보·이벤트", emoji: "📢" },
  { slug: "corporate", label: "기업", emoji: "🏢" },
  { slug: "life", label: "생정·이슈", emoji: "💬" },
]

export default function LoungePage() {
  const [board, setBoard] = useState("free")
  const [sort, setSort] = useState<"latest" | "hot">("latest")
  const [query, setQuery] = useState("")

  const q = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""
  const { data, isLoading } = useApi<{ posts: Post[] }>(
    `/api/community/posts?board=${board}&sort=${sort}${q}`,
    { ttl: 20_000 },
  )
  const posts = data?.posts ?? []

  return (
    <div className="flex flex-col min-h-full bg-[#0a0a10] text-white">
      <PageHeader title="라운지" backHref="/m/me" />

      <div className="px-4 pb-24">
        {/* 게시판 탭 */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
          {BOARDS.map((b) => (
            <button
              key={b.slug}
              type="button"
              onClick={() => setBoard(b.slug)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-extrabold border transition-colors ${
                board === b.slug
                  ? "bg-purple-500/30 border-purple-400 text-purple-100"
                  : "bg-white/5 border-white/10 text-white/70"
              }`}
            >
              {b.emoji} {b.label}
            </button>
          ))}
        </div>

        {/* 정렬 + 검색 */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex gap-1 bg-white/5 rounded-full p-0.5">
            {(["latest", "hot"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={`px-3 py-1 rounded-full text-[10px] font-extrabold ${
                  sort === s ? "bg-white text-[#0a0a10]" : "text-white/70"
                }`}
              >
                {s === "latest" ? "최신글" : "⭐ 인기글"}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색"
            className="flex-1 bg-white/10 border border-white/10 rounded-full px-3 py-1.5 text-[11px] outline-none placeholder:text-white/40"
          />
          <Link
            href={`/m/lounge/write?board=${board}`}
            className="text-[11px] font-extrabold bg-purple-500 text-white rounded-full px-3 py-1.5 shrink-0"
          >
            ✏ 글쓰기
          </Link>
        </div>

        {/* 공지 */}
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl px-3 py-2.5 mb-3 flex items-center gap-2">
          <span className="text-[14px]">📢</span>
          <div className="text-[11px] font-bold text-purple-200">
            라운지 이용규칙 안내
          </div>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && posts.length === 0 && (
          <div className="text-center text-[12px] text-white/40 py-10">
            아직 게시글이 없습니다
          </div>
        )}

        {/* 게시글 목록 */}
        <div className="space-y-2">
          {posts.map((p) => (
            <Link
              key={p.id}
              href={`/m/lounge/${p.id}`}
              className="block bg-white/5 border border-white/10 rounded-2xl px-4 py-3 no-underline text-white active:bg-white/10"
            >
              <div className="flex items-start gap-2">
                <span className="text-red-400 text-[8px] mt-1.5">●</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-extrabold leading-tight flex items-center gap-1.5">
                    <span className="flex-1 min-w-0 truncate">{p.title}</span>
                    {p.comment_count > 0 && (
                      <span className="text-red-400 text-[11px] font-extrabold shrink-0">
                        [{p.comment_count}]
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-white/60 mt-1 truncate">
                    {p.body}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[9px] text-white/40">
                    <span>
                      {p.author_nickname ?? "익명"} · ♡ {p.like_count} · 👁 {p.view_count}
                    </span>
                    <span>{formatDate(p.created_at)}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <TabBar />
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const yy = String(d.getFullYear()).slice(2)
  return `${yy}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`
}
