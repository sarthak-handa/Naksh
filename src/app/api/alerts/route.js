/**
 * API Route: /api/alerts
 * Fetches alert history for a user's routes.
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // Join alert_history with monitored_routes to get route details
    const { data, error } = await supabase
      .from("alert_history")
      .select(`
        *,
        monitored_routes!inner (
          origin,
          destination,
          user_id
        )
      `)
      .eq("monitored_routes.user_id", userId)
      .order("triggered_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ alerts: data || [] });
  } catch (error) {
    console.error("GET /api/alerts error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
