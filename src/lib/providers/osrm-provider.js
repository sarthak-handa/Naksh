/**
 * OSRM Routing Provider
 *
 * Uses the free public Open Source Routing Machine (OSRM) server.
 * Cost: ₹0. Account: none. Traffic data: none (base driving time only).
 *
 * NOTE: The public OSRM server is for demo/light usage only.
 * It expects coordinates (lon,lat). We use Nominatim (free OSM geocoder)
 * to convert text addresses to coordinates first.
 */

// Simple cache for geocoding to avoid hitting Nominatim too often
const geocodeCache = new Map();

/**
 * Geocode an address to [lon, lat] using OSM Nominatim.
 */
async function geocode(address) {
  if (geocodeCache.has(address)) {
    return geocodeCache.get(address);
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    address
  )}&limit=1`;
  
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Naksh-ETA-Monitor/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Geocoding failed for ${address}`);
  }

  const data = await response.json();
  if (!data || data.length === 0) {
    throw new Error(`Could not find coordinates for ${address}`);
  }

  const coords = [parseFloat(data[0].lon), parseFloat(data[0].lat)];
  geocodeCache.set(address, coords);
  return coords;
}

export const OsrmProvider = {
  /**
   * Get ETA using OSRM.
   *
   * @param {string} origin
   * @param {string} destination
   * @param {Object} options
   * @returns {Promise<import('../routing-provider').RouteResult>}
   */
  async getRouteEta(origin, destination, options = {}) {
    try {
      // 1. Geocode or use provided coordinates
      let originCoords = options.originLat && options.originLng 
        ? [options.originLng, options.originLat] 
        : await geocode(origin);
        
      let destCoords = options.destLat && options.destLng 
        ? [options.destLng, options.destLat] 
        : await geocode(destination);

      // 2. Call OSRM
      // Format: {lon},{lat};{lon},{lat}
      const coordsString = `${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}`;
      const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`;

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`OSRM API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
        throw new Error(`OSRM routing failed: ${data.code}`);
      }

      const route = data.routes[0];
      const durationSeconds = route.duration;
      const durationMinutes = Math.round(durationSeconds / 60);

      return {
        durationMinutes,
        distanceMeters: route.distance,
        geometry: route.geometry, // GeoJSON LineString
        provider: "osrm",
        timestamp: new Date().toISOString(),
        trafficAware: false, // OSRM doesn't have live traffic
      };
    } catch (error) {
      console.error("OSRM Provider error:", error);
      throw error;
    }
  },
};
