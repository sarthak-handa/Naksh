/**
 * Demo Routing Provider
 *
 * A controllable ETA simulator for testing the entire Naksh pipeline
 * without any external API. Cost: ₹0. Account: none.
 *
 * How it works:
 *   - Each route gets a simulated ETA that decreases over time
 *   - You can override the ETA via the demoEta option
 *   - The base ETA is calculated from a hash of origin+destination
 *     so the same route always starts from the same value
 *   - Each subsequent call reduces the ETA slightly (simulating traffic clearing)
 *
 * For manual testing:
 *   Set demoEta in the check API to force a specific ETA value.
 *   Example sequence: 60, 55, 48, 44 with threshold 45
 *   → Naksh should fire exactly one notification when crossing below 45.
 */

// In-memory state for demo routes (resets on server restart)
const demoState = new Map();

/**
 * Simple hash to generate a consistent base ETA from route text.
 */
function hashRoute(origin, destination) {
  const str = `${origin}::${destination}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash);
}

export const DemoProvider = {
  /**
   * Get a simulated ETA.
   *
   * @param {string} origin
   * @param {string} destination
   * @param {Object} options
   * @param {number} [options.demoEta] - Force a specific ETA value (for manual testing)
   * @returns {Promise<import('../routing-provider').RouteResult>}
   */
  async getRouteEta(origin, destination, options = {}) {
    // If a specific ETA is forced, use it directly
    if (options.demoEta !== undefined && options.demoEta !== null) {
      const forcedEta = parseInt(options.demoEta, 10);
      return {
        durationMinutes: forcedEta,
        distanceMeters: forcedEta * 500, // Rough estimate
        provider: "demo",
        timestamp: new Date().toISOString(),
        trafficAware: false,
      };
    }

    // Generate a consistent base ETA for this route
    const routeKey = `${origin}::${destination}`;
    const baseHash = hashRoute(origin, destination);
    const baseEta = 30 + (baseHash % 60); // Between 30 and 90 minutes

    // Get or initialize state for this route
    let state = demoState.get(routeKey);
    if (!state) {
      state = { currentEta: baseEta, checkCount: 0 };
      demoState.set(routeKey, state);
    }

    // Simulate traffic changes: ETA decreases by 2-5 min each check
    // with occasional increases (simulating traffic spikes)
    state.checkCount++;
    const variation = Math.sin(state.checkCount * 0.7) * 4;
    const trend = -2; // General downward trend
    state.currentEta = Math.max(
      5,
      Math.round(state.currentEta + trend + variation)
    );

    return {
      durationMinutes: state.currentEta,
      distanceMeters: state.currentEta * 500,
      provider: "demo",
      timestamp: new Date().toISOString(),
      trafficAware: false,
    };
  },

  /**
   * Reset demo state for a route (for testing).
   */
  resetRoute(origin, destination) {
    const routeKey = `${origin}::${destination}`;
    demoState.delete(routeKey);
  },

  /**
   * Reset all demo state.
   */
  resetAll() {
    demoState.clear();
  },
};
