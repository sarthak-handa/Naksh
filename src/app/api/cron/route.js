/**
 * API Route: /api/cron
 * THE BRAIN OF NAKSH
 *
 * Triggered daily by Vercel Cron (on Hobby tier).
 * Fetches active routes and runs the threshold engine using the active routing provider.
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getRouteEta, formatDuration } from "@/lib/routing-provider";
import { sendPushToAll } from "@/lib/push-service";

// Cooldown duration in minutes — after triggering, don't re-trigger for this long
const COOLDOWN_MINUTES = 30;

export async function GET(request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    const cronSecret = process.env.CRON_SECRET;

    // Allow access if no secret is configured (development) or if secret matches
    if (cronSecret && secret !== cronSecret) {
      const authHeader = request.headers.get("authorization");
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    if (!supabase) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // 1. Fetch all active routes
    const { data: routes, error: routesError } = await supabase
      .from("monitored_routes")
      .select("*")
      .eq("status", "active");

    if (routesError) throw routesError;

    if (!routes || routes.length === 0) {
      return NextResponse.json({
        message: "No active routes to check",
        checked: 0,
        alerts: 0,
      });
    }

    let alertsTriggered = 0;
    const results = [];

    // 2. Process each route
    for (const route of routes) {
      try {
        // Check if route is in cooldown
        if (route.cooldown_until) {
          const cooldownEnd = new Date(route.cooldown_until);
          if (cooldownEnd > new Date()) {
            results.push({
              id: route.id,
              status: "cooldown",
              message: `In cooldown until ${cooldownEnd.toISOString()}`,
            });
            continue;
          }
        }

        // 3. Get ETA from the active routing provider
        const { durationMinutes, provider } = await getRouteEta(
          route.origin,
          route.destination,
          {
            originPlaceId: route.origin_place_id,
            destPlaceId: route.dest_place_id,
          }
        );

        const previousEta = route.last_eta;
        let shouldAlert = false;
        let alertType = null;
        let thresholdValue = null;

        // 4. THRESHOLD ENGINE
        if (route.alert_below && durationMinutes <= route.alert_below) {
          if (previousEta === null || previousEta > route.alert_below) {
            shouldAlert = true;
            alertType = "below";
            thresholdValue = route.alert_below;
          }
        }

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
        if (shouldAlert) {
          alertsTriggered++;

          await supabase.from("alert_history").insert({
            route_id: route.id,
            eta_at_trigger: durationMinutes,
            threshold_crossed: alertType,
            threshold_value: thresholdValue,
            triggered_at: new Date().toISOString(),
          });

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
          }

          results.push({
            id: route.id,
            status: "alerted",
            eta: durationMinutes,
            provider,
            alertType,
            threshold: thresholdValue,
          });
        } else {
          results.push({
            id: route.id,
            status: "checked",
            eta: durationMinutes,
            provider,
            previousEta,
          });
        }
      } catch (routeError) {
        console.error(`Error checking route ${route.id}:`, routeError);
        results.push({
          id: route.id,
          status: "error",
          error: routeError.message,
        });
      }
    }

    return NextResponse.json({
      message: "Cron completed",
      checked: routes.length,
      alerts: alertsTriggered,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
