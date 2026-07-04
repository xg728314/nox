import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET() {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from("partner_categories")
    .select("id, slug, name, icon, banner_url, color_hex, display_order, is_new")
    .eq("is_active", true)
    .order("display_order")
  return NextResponse.json({ categories: data ?? [] })
}
