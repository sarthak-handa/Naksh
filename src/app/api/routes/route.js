/**
 * API Route: /api/routes
 * CRUD operations for monitored routes.
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET — Fetch all routes for a user
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

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

    const { data, error } = await supabase
      .from("monitored_routes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ routes: data || [] });
  } catch (error) {
    console.error("GET /api/routes error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// POST — Create a new monitored route
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      userId,
      origin,
      destination,
      originPlaceId,
      destPlaceId,
      alertBelow,
      alertAbove,
      pollInterval,
    } = body;

    if (!userId || !origin || !destination) {
      return NextResponse.json(
        { error: "userId, origin, and destination are required" },
        { status: 400 }
      );
    }

    if (!alertBelow && !alertAbove) {
      return NextResponse.json(
        { error: "At least one alert threshold (alertBelow or alertAbove) is required" },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    const { data, error } = await supabase
      .from("monitored_routes")
      .insert({
        user_id: userId,
        origin,
        destination,
        origin_place_id: originPlaceId || null,
        dest_place_id: destPlaceId || null,
        alert_below: alertBelow ? parseInt(alertBelow, 10) : null,
        alert_above: alertAbove ? parseInt(alertAbove, 10) : null,
        poll_interval: parseInt(pollInterval, 10) || 10,
        status: "active",
        last_eta: null,
        last_checked: null,
        cooldown_until: null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ route: data }, { status: 201 });
  } catch (error) {
    console.error("POST /api/routes error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// PATCH — Update a route (pause/resume/update thresholds)
export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Route id is required" },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // Map camelCase to snake_case for DB
    const dbUpdates = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.alertBelow !== undefined)
      dbUpdates.alert_below = updates.alertBelow;
    if (updates.alertAbove !== undefined)
      dbUpdates.alert_above = updates.alertAbove;
    if (updates.pollInterval !== undefined)
      dbUpdates.poll_interval = updates.pollInterval;
    if (updates.cooldownUntil !== undefined)
      dbUpdates.cooldown_until = updates.cooldownUntil;

    const { data, error } = await supabase
      .from("monitored_routes")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ route: data });
  } catch (error) {
    console.error("PATCH /api/routes error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// DELETE — Remove a monitored route
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Route id is required" },
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
      .from("monitored_routes")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/routes error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
