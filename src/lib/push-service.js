/**
 * Web Push Notification Service
 * Handles sending push notifications to subscribed clients using the VAPID protocol.
 */
import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:naksh@example.com";

// Configure web-push with VAPID details
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

/**
 * Send a push notification to a subscription.
 *
 * @param {Object} subscription - The push subscription object { endpoint, keys: { p256dh, auth } }
 * @param {Object} payload - Notification payload
 * @param {string} payload.title - Notification title
 * @param {string} payload.body - Notification body text
 * @param {string} [payload.icon] - Icon URL
 * @param {string} [payload.tag] - Notification tag (for grouping/replacing)
 * @param {Object} [payload.data] - Extra data to pass to the notification click handler
 * @returns {Promise<boolean>} - true if sent successfully, false if subscription is expired
 */
export async function sendPushNotification(subscription, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error("VAPID keys not configured. Cannot send push notification.");
    return false;
  }

  const notificationPayload = JSON.stringify({
    title: payload.title || "Naksh — ETA Alert",
    body: payload.body,
    icon: payload.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag || "naksh-eta-alert",
    data: payload.data || {},
    timestamp: Date.now(),
    requireInteraction: true,
  });

  try {
    await webpush.sendNotification(subscription, notificationPayload);
    return true;
  } catch (error) {
    // 410 Gone or 404 means the subscription has expired
    if (error.statusCode === 410 || error.statusCode === 404) {
      console.log("Push subscription expired:", subscription.endpoint);
      return false;
    }
    console.error("Push notification error:", error);
    throw error;
  }
}

/**
 * Send push notifications to multiple subscriptions.
 * Returns an array of { endpoint, success } results.
 *
 * @param {Array<Object>} subscriptions - Array of push subscription objects
 * @param {Object} payload - Notification payload
 * @returns {Promise<Array<{ endpoint: string, success: boolean }>>}
 */
export async function sendPushToAll(subscriptions, payload) {
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const success = await sendPushNotification(
        {
          endpoint: sub.endpoint,
          keys: typeof sub.keys === "string" ? JSON.parse(sub.keys) : sub.keys,
        },
        payload
      );
      return { endpoint: sub.endpoint, success };
    })
  );

  return results.map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return { endpoint: "unknown", success: false };
  });
}
