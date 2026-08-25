/**
 * Routing Provider Abstraction
 *
 * Common interface for all ETA providers. The UI and threshold engine
 * never interact with a specific routing API directly — they go through
 * this layer.
 *
 * Available providers:
 *   - "demo"   → Controllable simulator (₹0, no account)
 *   - "osrm"   → Open Source Routing Machine (₹0, real ETA, no traffic)
 *   - "google"  → Google Routes API (requires billing account)
 *
 * Set ROUTING_PROVIDER in .env.local to choose the active provider.
 */

import { DemoProvider } from "./providers/demo-provider";
import { OsrmProvider } from "./providers/osrm-provider";
import { GoogleRoutesProvider } from "./providers/google-routes-provider";

/**
 * @typedef {Object} RouteResult
 * @property {number} durationMinutes - ETA in minutes
 * @property {number} distanceMeters  - Distance in meters
 * @property {string} provider        - Which provider returned this result
 * @property {string} timestamp       - ISO timestamp of when this was calculated
 * @property {boolean} trafficAware   - Whether the result includes live traffic data
 */

const providers = {
  demo: DemoProvider,
  osrm: OsrmProvider,
  google: GoogleRoutesProvider,
};

/**
 * Get the currently configured provider name.
 * Defaults to "demo" if not set — guaranteed ₹0.
 */
export function getProviderName() {
  return (process.env.ROUTING_PROVIDER || "demo").toLowerCase();
}

/**
 * Get the active provider instance.
 * @returns {Object} Provider with getRouteEta method
 */
function getProvider() {
  const name = getProviderName();
  const Provider = providers[name];

  if (!Provider) {
    throw new Error(
      `Unknown routing provider "${name}". ` +
      `Available: ${Object.keys(providers).join(", ")}`
    );
  }

  return Provider;
}

/**
 * Get ETA for a route using the active provider.
 *
 * @param {string} origin - Origin address
 * @param {string} destination - Destination address
 * @param {Object} [options]
 * @param {string} [options.departureTime] - ISO datetime for departure
 * @param {string} [options.travelMode] - "drive" (default), "walk", "bicycle"
 * @param {number} [options.demoEta] - For demo provider: override ETA value
 * @returns {Promise<RouteResult>}
 */
export async function getRouteEta(origin, destination, options = {}) {
  const provider = getProvider();
  return provider.getRouteEta(origin, destination, options);
}

/**
 * Format duration for display.
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${minutes} min`;
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
 * Get info about the active provider (for UI display).
 */
export function getProviderInfo() {
  const name = getProviderName();
  const info = {
    demo: {
      name: "Demo",
      description: "Simulated ETA for testing",
      trafficAware: false,
      cost: "₹0",
      accountRequired: false,
    },
    osrm: {
      name: "OSRM",
      description: "Open Source Routing Machine — real driving ETA",
      trafficAware: false,
      cost: "₹0",
      accountRequired: false,
    },
    google: {
      name: "Google Routes",
      description: "Google Maps routing with live traffic",
      trafficAware: true,
      cost: "Requires billing account",
      accountRequired: true,
    },
  };
  return info[name] || info.demo;
}
