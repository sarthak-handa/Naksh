/**
 * Google Routes API Provider
 * 
 * Fetches real-time ETA with traffic awareness.
 * 
 * NOTE: This requires a Google Cloud billing account with a payment mandate.
 * If you do not have one, use the "demo" or "osrm" providers instead.
 */

const ROUTES_API_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

export const GoogleRoutesProvider = {
  /**
   * Get the current ETA in minutes for a route with real-time traffic.
   *
   * @param {string} origin - Origin address or place ID
   * @param {string} destination - Destination address or place ID
   * @param {Object} options
   * @returns {Promise<import('../routing-provider').RouteResult>}
   */
  async getRouteEta(origin, destination, options = {}) {
    const GOOGLE_API_KEY = process.env.GOOGLE_ROUTES_API_KEY;
    
    if (!GOOGLE_API_KEY) {
      throw new Error(
        "GOOGLE_ROUTES_API_KEY is not configured. " +
        "If you want to use the Google provider, you must configure a key."
      );
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
          "routes.duration,routes.distanceMeters",
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
      provider: "google",
      timestamp: new Date().toISOString(),
      trafficAware: true,
    };
  }
};
