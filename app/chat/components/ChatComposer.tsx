"use client"

/**
 * ChatComposer — message input + send button. Pure UI.
 * All mutation logic lives in useChatMessages.
 */

type Props = {
  input: string
  sending: boolean
  onChange: (v: string) => void
  onSubmit: () => void
}

export default function ChatComposer({ input, sending, onChange, onSubmit }: Props) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}
      className="flex items-center gap-2 px-4 py-3 border-t border-white/10 flex-shrink-0"
    >
      <input
        type="text"
        value={input}
        onChange={(e) => onChange(e.target.value)}
        placeholder="메시지 입력..."
        maxLength={2000}
        className="flex-1 rounded-xl bg-white/5 border border-white/10 text-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
      />
      <button
        type="submit"
        disabled={sending || !input.trim()}
        className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-all disabled:opacity-40"
      >
        {sending ? "..." : "전송"}
      </button>
    </form>
  )
}
