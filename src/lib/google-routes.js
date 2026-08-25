/**
 * Google Routes API Client
 * Fetches real-time ETA with traffic awareness for a given origin-destination pair.
 */

const GOOGLE_API_KEY = process.env.GOOGLE_ROUTES_API_KEY;
const ROUTES_API_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

/**
 * Get the current ETA in minutes for a route with real-time traffic.
 *
 * @param {string} origin - Origin address or place ID (e.g. "New Delhi, India")
 * @param {string} destination - Destination address or place ID
 * @param {Object} options
 * @param {string} [options.originPlaceId] - Google Place ID for origin
 * @param {string} [options.destPlaceId] - Google Place ID for destination
 * @returns {Promise<{ durationMinutes: number, distanceMeters: number, polyline: string | null }>}
 */
export async function getRouteETA(origin, destination, options = {}) {
  if (!GOOGLE_API_KEY) {
    throw new Error("GOOGLE_ROUTES_API_KEY is not configured");
  }

  const body = {
    origin: options.originPlaceId
      ? { placeId: options.originPlaceId }
      : { address: origin },
    destination: options.destPlaceId
      ? { placeId: options.destPlaceId }
      : { address: destination },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    computeAlternativeRoutes: false,
    languageCode: "en-US",
  };

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask":
        "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Google Routes API error: ${response.status} - ${
        errorData.error?.message || response.statusText
      }`
    );
  }

  const data = await response.json();

  if (!data.routes || data.routes.length === 0) {
    throw new Error("No routes found for the given origin and destination");
  }

  const route = data.routes[0];

  // Duration comes as "XXXs" (seconds string)
  const durationSeconds = parseInt(route.duration.replace("s", ""), 10);
  const durationMinutes = Math.round(durationSeconds / 60);

  return {
    durationMinutes,
    distanceMeters: route.distanceMeters || 0,
    polyline: route.polyline?.encodedPolyline || null,
  };
}

/**
 * Format distance for display.
 * @param {number} meters
 * @returns {string}
 */
export function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${meters} m`;
}

/**
 * Format duration for display.
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes} min`;
}
