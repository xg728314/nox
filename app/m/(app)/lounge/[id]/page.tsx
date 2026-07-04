"use client"
import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"

type Post = {
  id: string
  author_user_id: string
  author_nickname: string | null
  board: string
  title: string
  body: string
  view_count: number
  like_count: number
  comment_count: number
  image_urls?: string[]
  tags?: string[]
  created_at: string
}
type Comment = {
  id: string
  author_user_id: string
  author_nickname: string | null
  body: string
  like_count: number
  created_at: string
}

export default function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const toast = useToast()
  const [post, setPost] = useState<Post | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pr, cr] = await Promise.all([
          apiFetch(`/api/community/posts/${id}`),
          apiFetch(`/api/community/posts/${id}/comments`),
        ])
        if (cancelled) return
        if (pr.ok) {
          const pd = await pr.json()
          setPost(pd.post)
        }
        if (cr.ok) {
          const cd = await cr.json()
          setComments(cd.comments ?? [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  async function like() {
    if (!post) return
    try {
      const res = await apiFetch("/api/community/like", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: "post", target_id: post.id }),
      })
      const j = await res.json()
      if (res.ok) setPost({ ...post, like_count: j.like_count })
    } catch {}
  }

  async function submitComment() {
    if (!commentText.trim() || sending) return
    setSending(true)
    try {
      const res = await apiFetch(`/api/community/posts/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentText.trim() }),
      })
      if (!res.ok) throw new Error("HTTP " + res.status)
      // 재조회
      const cr = await apiFetch(`/api/community/posts/${id}/comments`)
      const cd = await cr.json()
      setComments(cd.comments ?? [])
      setCommentText("")
      toast("댓글 등록", "success")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-[#0a0a10] text-white">
      <PageHeader title="게시글" backHref="/m/lounge" />

      <div className="px-4 pb-24">
        {loading && (
          <div className="space-y-2">
            <div className="h-8 rounded bg-white/5 animate-pulse" />
            <div className="h-32 rounded-2xl bg-white/5 animate-pulse" />
          </div>
        )}

        {!loading && !post && (
          <div className="text-center py-10 text-white/60">
            게시글을 찾을 수 없습니다
          </div>
        )}

        {post && (
          <>
            <div className="pt-1 pb-3">
              <div className="text-[10px] font-bold text-purple-300">
                {post.board.toUpperCase()}
              </div>
              <h1 className="text-[18px] font-extrabold tracking-tight mt-1">
                {post.title}
              </h1>
              <div className="text-[10px] text-white/50 mt-1.5">
                {post.author_nickname ?? "익명"} · {formatDate(post.created_at)} · 👁 {post.view_count}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 mb-4 whitespace-pre-wrap text-[13px] leading-relaxed">
              {post.body}
            </div>

            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={like}
                className="flex-1 bg-red-500/10 border border-red-500/30 rounded-2xl py-2.5 text-[12px] font-extrabold text-red-300"
              >
                ♡ 좋아요 {post.like_count}
              </button>
              <button
                type="button"
                onClick={() => router.push("/m/lounge")}
                className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-[12px] font-extrabold text-white/70"
              >
                목록
              </button>
            </div>

            {/* 댓글 */}
            <div className="text-[11px] font-extrabold text-white/60 mb-2">
              댓글 {comments.length}
            </div>
            <div className="space-y-2 mb-3">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="bg-white/5 rounded-2xl px-3 py-2.5"
                >
                  <div className="text-[10px] font-bold text-purple-300">
                    {c.author_nickname ?? "익명"}
                  </div>
                  <div className="text-[12px] mt-1 whitespace-pre-wrap">
                    {c.body}
                  </div>
                  <div className="text-[9px] text-white/40 mt-1.5">
                    {formatDate(c.created_at)} · ♡ {c.like_count}
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <div className="text-[11px] text-white/40 text-center py-4">
                  아직 댓글이 없습니다
                </div>
              )}
            </div>

            {/* 댓글 작성 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitComment()}
                placeholder="댓글 입력..."
                className="flex-1 bg-white/10 border border-white/10 rounded-2xl px-4 py-2.5 text-[12px] outline-none placeholder:text-white/40"
              />
              <button
                type="button"
                onClick={submitComment}
                disabled={sending || !commentText.trim()}
                className="bg-purple-500 text-white rounded-2xl px-4 py-2.5 text-[12px] font-extrabold disabled:opacity-40"
              >
                등록
              </button>
            </div>
          </>
        )}
      </div>

      <TabBar />
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("ko-KR", { hour12: false })
}
