/** apply 110_chat_bot_infra migration */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const sql = readFileSync("database/110_chat_bot_infra.sql", "utf8")
let error
try { const r = await sb.rpc("exec_sql", { sql }); error = r.error }
catch (e) { error = e }
console.log(`110_chat_bot_infra.sql:`, error ? `❌ ${error.message ?? error}` : "✓ applied")

// verify
const { error: e1 } = await sb.from("store_settings").select("chat_parser_strictness, chat_rules_json").limit(1)
console.log("  store_settings.chat_parser_strictness:", e1 ? `❌ ${e1.message}` : "✓")
const { count, error: e2 } = await sb.from("chat_bot_reply_log").select("*", { count: "exact", head: true })
console.log("  chat_bot_reply_log:", e2 ? `❌ ${e2.message}` : `✓ (${count} rows)`)
const { count: c2, error: e3 } = await sb.from("chat_tutorial_seen").select("*", { count: "exact", head: true })
console.log("  chat_tutorial_seen:", e3 ? `❌ ${e3.message}` : `✓ (${c2} rows)`)
