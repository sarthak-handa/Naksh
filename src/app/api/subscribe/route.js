/**
 * API Route: /api/subscribe
 * Manages Web Push notification subscriptions.
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST — Save a push subscription
export async function POST(request) {
  try {
    const body = await request.json();
    const { userId, subscription } = body;

    if (!userId || !subscription || !subscription.endpoint) {
      return NextResponse.json(
        { error: "userId and valid subscription object are required" },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // Upsert — if endpoint already exists, update it
    const { data, error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        { onConflict: "endpoint" }
      )
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ subscription: data }, { status: 201 });
  } catch (error) {
    console.error("POST /api/subscribe error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// DELETE — Remove a push subscription
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get("endpoint");

    if (!endpoint) {
      return NextResponse.json(
        { error: "Subscription endpoint is required" },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/subscribe error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
