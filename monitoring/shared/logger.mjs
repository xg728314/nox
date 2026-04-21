/**
 * One-line JSON logger. Every bot emits one line per tick + one line
 * per alert. That is the entire observability contract — downstream
 * log collectors (Vercel drain, journald, Datadog) pick these up
 * without needing per-bot parsers.
 */

function emit(stream, payload) {
  stream.write(JSON.stringify({ ts: new Date().toISOString(), ...payload }) + "\n")
}

export function log(bot, event, extra = {}) {
  emit(process.stdout, { bot, event, ...extra })
}

export function logError(bot, event, err, extra = {}) {
  emit(process.stderr, {
    bot,
    event,
    error: err?.message ?? String(err),
    stack: err?.stack,
    ...extra,
  })
}
