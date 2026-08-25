/**
 * API Route: /api/check
 * On-demand ETA checker.
 * 
 * Replaces the frequent cron job for the MVP. Can be triggered directly from the UI.
 * Uses the configured routing provider and runs the threshold engine.
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getRouteEta, formatDuration, getProviderInfo } from "@/lib/routing-provider";
import { sendPushToAll } from "@/lib/push-service";

// Cooldown duration in minutes — after triggering, don't re-trigger for this long
const COOLDOWN_MINUTES = 30;

export async function POST(request) {
  try {
    const body = await request.json();
    const { routeId, demoEta } = body; // demoEta allows forcing a specific ETA for testing

    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // 1. Fetch the route
    const { data: route, error: routeError } = await supabase
      .from("monitored_routes")
      .select("*")
      .eq("id", routeId)
      .single();

    if (routeError) {
      if (routeError.code === 'PGRST116') {
        return NextResponse.json({ error: "Route not found" }, { status: 404 });
      }
      throw routeError;
    }

    if (route.status === "paused") {
      return NextResponse.json({
        message: "Route is paused, check skipped",
        status: "paused"
      });
    }

    // 2. Check if route is in cooldown
    if (route.cooldown_until) {
      const cooldownEnd = new Date(route.cooldown_until);
      if (cooldownEnd > new Date()) {
        return NextResponse.json({
          message: "Route is in cooldown",
          status: "cooldown",
          cooldownUntil: cooldownEnd.toISOString()
        });
      }
    }

    // 3. Get ETA from the active provider
    // Note: origin/dest place IDs are ignored by Demo/OSRM, used by Google
    const { durationMinutes, provider } = await getRouteEta(
      route.origin,
      route.destination,
      {
        originPlaceId: route.origin_place_id,
        destPlaceId: route.dest_place_id,
        demoEta // Passed directly to demo provider if it's active
      }
    );

    const previousEta = route.last_eta;
    let shouldAlert = false;
    let alertType = null;
    let thresholdValue = null;

    // 4. THRESHOLD ENGINE
    // Check "alert below" threshold
    if (route.alert_below && durationMinutes <= route.alert_below) {
      if (previousEta === null || previousEta > route.alert_below) {
        shouldAlert = true;
        alertType = "below";
        thresholdValue = route.alert_below;
      }
    }

    // Check "alert above" threshold
    if (route.alert_above && durationMinutes >= route.alert_above) {
      if (previousEta === null || previousEta < route.alert_above) {
        shouldAlert = true;
        alertType = "above";
        thresholdValue = route.alert_above;
      }
    }

    // 5. Update route with current ETA
    const updateData = {
      last_eta: durationMinutes,
      last_checked: new Date().toISOString(),
      status: route.status === "cooldown" && !shouldAlert ? "active" : route.status
    };

    if (shouldAlert) {
      const cooldownEnd = new Date();
      cooldownEnd.setMinutes(cooldownEnd.getMinutes() + COOLDOWN_MINUTES);
      updateData.cooldown_until = cooldownEnd.toISOString();
      updateData.status = "cooldown";
    }

    await supabase
      .from("monitored_routes")
      .update(updateData)
      .eq("id", route.id);

    // 6. Send notifications if threshold crossed
    let notificationsSent = 0;
    if (shouldAlert) {
      // Log alert to history
      await supabase.from("alert_history").insert({
        route_id: route.id,
        eta_at_trigger: durationMinutes,
        threshold_crossed: alertType,
        threshold_value: thresholdValue,
        triggered_at: new Date().toISOString(),
      });

      // Send push notification
      const { data: subscriptions } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", route.user_id);

      if (subscriptions && subscriptions.length > 0) {
        const etaFormatted = formatDuration(durationMinutes);
        const changeText = previousEta !== null ? `(was ${formatDuration(previousEta)})` : "";
        const emoji = alertType === "below" ? "🟢" : "🔴";
        const direction = alertType === "below" ? "dropped below" : "rose above";

        await sendPushToAll(subscriptions, {
          title: `${emoji} ETA ${direction} ${thresholdValue} min`,
          body: `${route.origin} → ${route.destination}\nCurrent ETA: ${etaFormatted} ${changeText}`,
          tag: `naksh-route-${route.id}`,
          data: { routeId: route.id, eta: durationMinutes, alertType },
        });
        notificationsSent = subscriptions.length;
      }
    }

    return NextResponse.json({
      message: shouldAlert ? "Alert triggered" : "Check complete",
      status: shouldAlert ? "alerted" : "checked",
      eta: durationMinutes,
      previousEta,
      provider,
      providerInfo: getProviderInfo(),
      alert: shouldAlert ? { type: alertType, threshold: thresholdValue } : null,
      notificationsSent
    });

  } catch (error) {
    console.error("Check API error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

// Support GET for testing/ping
export async function GET() {
  return NextResponse.json({
    status: "ok",
    providerInfo: getProviderInfo()
  });
}
