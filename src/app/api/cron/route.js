/**
 * API Route: /api/cron
 * THE BRAIN OF NAKSH
 *
 * Triggered every 10 minutes by Vercel Cron.
 * 1. Fetches all active monitored routes
 * 2. Calls Google Routes API for current ETA
 * 3. Runs the threshold engine (with anti-spam cooldown)
 * 4. Sends push notifications when thresholds are crossed
 * 5. Logs alerts to history
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getRouteETA, formatDuration } from "@/lib/google-routes";
import { sendPushToAll } from "@/lib/push-service";

// Cooldown duration in minutes — after triggering, don't re-trigger for this long
const COOLDOWN_MINUTES = 30;
// Buffer zone to prevent ping-pong (e.g., threshold is 45, won't re-trigger until ETA is 50+)
const BUFFER_MINUTES = 5;

export async function GET(request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");
    const cronSecret = process.env.CRON_SECRET;

    // Allow access if no secret is configured (development) or if secret matches
    if (cronSecret && secret !== cronSecret) {
      // Also check for Vercel's cron header
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

        // 3. Get current ETA from Google
        const { durationMinutes } = await getRouteETA(
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
        // Check "alert below" threshold
        if (route.alert_below && durationMinutes <= route.alert_below) {
          // Only alert if we were previously above the threshold (or first check)
          if (previousEta === null || previousEta > route.alert_below) {
            shouldAlert = true;
            alertType = "below";
            thresholdValue = route.alert_below;
          }
        }

        // Check "alert above" threshold
        if (route.alert_above && durationMinutes >= route.alert_above) {
          // Only alert if we were previously below the threshold (or first check)
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
          // Set cooldown to prevent spam
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

          // Log alert to history
          await supabase.from("alert_history").insert({
            route_id: route.id,
            eta_at_trigger: durationMinutes,
            threshold_crossed: alertType,
            threshold_value: thresholdValue,
            triggered_at: new Date().toISOString(),
          });

          // Get push subscriptions for this user
          const { data: subscriptions } = await supabase
            .from("push_subscriptions")
            .select("*")
            .eq("user_id", route.user_id);

          if (subscriptions && subscriptions.length > 0) {
            const etaFormatted = formatDuration(durationMinutes);
            const changeText =
              previousEta !== null
                ? `(was ${formatDuration(previousEta)})`
                : "";

            const emoji = alertType === "below" ? "🟢" : "🔴";
            const direction =
              alertType === "below" ? "dropped below" : "rose above";

            await sendPushToAll(subscriptions, {
              title: `${emoji} ETA ${direction} ${thresholdValue} min`,
              body: `${route.origin} → ${route.destination}\nCurrent ETA: ${etaFormatted} ${changeText}`,
              tag: `naksh-route-${route.id}`,
              data: {
                routeId: route.id,
                eta: durationMinutes,
                alertType,
              },
            });
          }

          results.push({
            id: route.id,
            status: "alerted",
            eta: durationMinutes,
            alertType,
            threshold: thresholdValue,
          });
        } else {
          results.push({
            id: route.id,
            status: "checked",
            eta: durationMinutes,
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
