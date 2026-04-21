import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  ReceiptType,
  ReceiptCalcMode,
  ReceiptDocument,
  ReceiptParticipantSnapshot,
  ReceiptOrderSnapshot,
} from "@/lib/receipt/types"

type RawParticipant = {
  id: string
  membership_id: string | null
  external_name: string | null
  category: string | null
  time_minutes: number
  price_amount: number
  status: string
}

type RawOrder = {
  id: string
  item_name: string
  order_type: string
  qty: number
  unit_price: number
  store_price: number
  sale_price: number
  manager_amount: number
  customer_amount: number
}

type SessionContext = {
  session_id: string
  store_uuid: string
  room_uuid: string
  started_at: string
  ended_at: string | null
  manager_name: string | null
  customer_name_snapshot: string | null
  customer_party_size: number
}

type ReceiptRow = {
  id: string
  gross_total: number
  tc_amount: number
  manager_amount: number
  hostess_amount: number
  margin_amount: number
  payment_method: string | null
  card_fee_amount: number
} | null

type BuildInput = {
  supabase: SupabaseClient
  session: SessionContext
  roomLabel: string
  storeName: string | null
  receipt: ReceiptRow
  receiptType: ReceiptType
  calcMode: ReceiptCalcMode
  user_id: string
}

/**
 * Builds a ReceiptDocument from pre-loaded session data + live participant/order snapshots.
 *
 * Extracts the document assembly logic from receipt/route.ts POST handler (lines 194–359).
 * Includes participant name resolution, half-ticket mode override, order snapshot mapping,
 * and final document composition. Preserves exact field names and structure.
 */
export async function buildReceiptDocument(
  input: BuildInput
): Promise<{ document: ReceiptDocument; participantSnapshots: ReceiptParticipantSnapshot[]; orderSnapshots: ReceiptOrderSnapshot[] }> {
  const { supabase, session, roomLabel, storeName, receipt, receiptType, calcMode, user_id } = input

  // 1. Fetch participants (hostess role only, snapshot at this moment)
  const { data: rawParticipants } = await supabase
    .from("session_participants")
    .select("id, role, category, time_minutes, price_amount, status, external_name, membership_id")
    .eq("session_id", session.session_id)
    .eq("store_uuid", session.store_uuid)
    .eq("role", "hostess")
    .is("deleted_at", null)

  const participantsWithNames = (rawParticipants ?? []) as RawParticipant[]

  // 2. Resolve names for participants with membership_id
  const memberIds = participantsWithNames
    .filter((p) => p.membership_id)
    .map((p) => p.membership_id!)

  const nameMap = new Map<string, string>()
  if (memberIds.length > 0) {
    const { data: memberships } = await supabase
      .from("store_memberships")
      .select("id, display_name")
      .in("id", memberIds)
    if (memberships) {
      for (const m of memberships) {
        nameMap.set(m.id, m.display_name || "")
      }
    }
  }

  // 3. If interim + half_ticket mode: resolve 반티 price per category
  const halfPriceByCategory = new Map<string, { price: number; minutes: number }>()
  if (receiptType === "interim" && calcMode === "half_ticket") {
    const { data: svcTypes } = await supabase
      .from("store_service_types")
      .select("service_type, time_type, time_minutes, price, is_active")
      .eq("store_uuid", session.store_uuid)
      .eq("time_type", "반티")
      .eq("is_active", true)
    for (const st of (svcTypes ?? []) as { service_type: string; time_minutes: number; price: number }[]) {
      halfPriceByCategory.set(st.service_type, { price: st.price, minutes: st.time_minutes })
    }
  }

  // 4. Build participant snapshots
  const participantSnapshots: ReceiptParticipantSnapshot[] = participantsWithNames.map((p) => {
    let price = p.price_amount
    let minutes = p.time_minutes
    if (calcMode === "half_ticket" && p.category) {
      const half = halfPriceByCategory.get(p.category)
      if (half) {
        price = half.price
        minutes = half.minutes
      }
    }
    return {
      id: p.id,
      name: p.membership_id ? (nameMap.get(p.membership_id) || p.external_name || null) : (p.external_name || null),
      category: p.category,
      time_minutes: minutes,
      price_amount: price,
      status: p.status,
    }
  })

  const participantTotal = participantSnapshots.reduce((s, p) => s + p.price_amount, 0)
  const elapsedMaxMinutes = participantSnapshots.reduce((m, p) => Math.max(m, p.time_minutes), 0)
  const calcReferenceMinutes = calcMode === "half_ticket"
    ? (Array.from(halfPriceByCategory.values())[0]?.minutes ?? elapsedMaxMinutes)
    : elapsedMaxMinutes

  // 5. Fetch orders (snapshot at this moment)
  const { data: rawOrders } = await supabase
    .from("orders")
    .select("id, item_name, order_type, qty, unit_price, store_price, sale_price, manager_amount, customer_amount")
    .eq("session_id", session.session_id)
    .eq("store_uuid", session.store_uuid)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })

  const orderSnapshots: ReceiptOrderSnapshot[] = ((rawOrders ?? []) as RawOrder[]).map((o) => ({
    id: o.id,
    item_name: o.item_name,
    order_type: o.order_type,
    qty: o.qty,
    unit_price: o.unit_price,
    amount: o.customer_amount,
    store_price: o.store_price,
    sale_price: o.sale_price,
    manager_amount: o.manager_amount,
    customer_amount: o.customer_amount,
  }))

  const orderTotal = orderSnapshots.reduce((s, o) => s + o.amount, 0)
  const storeTotal = orderSnapshots.reduce((s, o) => s + (o.store_price ?? 0) * o.qty, 0)
  const managerTotal = orderSnapshots.reduce((s, o) => s + (o.manager_amount ?? 0), 0)
  const grandTotal = participantTotal + orderTotal

  const now = new Date().toISOString()

  // 6. Compose ReceiptDocument
  const document: ReceiptDocument = {
    snapshot_id: "", // filled after insert
    receipt_type: receiptType,
    created_at: now,
    created_by: user_id,

    session_id: session.session_id,
    store_uuid: session.store_uuid,
    store_name: storeName,
    room_uuid: session.room_uuid,
    room_label: roomLabel,

    customer_name: session.customer_name_snapshot ?? null,
    customer_party_size: session.customer_party_size ?? 0,
    manager_name: session.manager_name ?? null,

    started_at: session.started_at,
    ended_at: session.ended_at ?? null,

    participants: participantSnapshots,
    participant_total: participantTotal,

    orders: orderSnapshots,
    order_total: orderTotal,

    grand_total: grandTotal,

    store_total: storeTotal,
    manager_total: managerTotal,
    customer_total: orderTotal,

    payment_method: receipt?.payment_method ?? null,
    card_fee_amount: receipt?.card_fee_amount ?? 0,
    card_surcharge: receipt?.card_fee_amount ?? 0,

    settlement: receipt ? {
      gross_total: receipt.gross_total,
      tc_amount: receipt.tc_amount,
      manager_amount: receipt.manager_amount,
      hostess_amount: receipt.hostess_amount,
      margin_amount: receipt.margin_amount,
    } : null,

    calc_mode: receiptType === "interim" ? calcMode : undefined,
    calc_reference_minutes: receiptType === "interim" ? calcReferenceMinutes : undefined,
  }

  return { document, participantSnapshots, orderSnapshots }
}
