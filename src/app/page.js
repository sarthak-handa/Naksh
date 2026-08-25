"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { searchLocation, reverseGeocode } from "@/lib/geocoder";

// Dynamically import Map to prevent SSR issues with Leaflet
const Map = dynamic(() => import("@/components/Map"), { ssr: false });

// ── Utility: Generate a simple user ID (persisted in localStorage) ──
function getUserId() {
  if (typeof window === "undefined") return null;
  let id = localStorage.getItem("naksh_user_id");
  if (!id) {
    id = "user_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("naksh_user_id", id);
  }
  return id;
}

function timeAgo(dateStr) {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Utility: Recent Searches ──
function getRecentSearches() {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem("naksh_recent_searches");
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

function saveRecentSearch(loc) {
  if (typeof window === "undefined") return;
  try {
    let recent = getRecentSearches();
    // Remove if already exists
    recent = recent.filter(r => r.name !== loc.name || r.lat !== loc.lat);
    // Add to front
    recent.unshift(loc);
    // Keep max 5
    if (recent.length > 5) recent.pop();
    localStorage.setItem("naksh_recent_searches", JSON.stringify(recent));
  } catch (e) {}
}

function clearRecentSearches() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("naksh_recent_searches");
}

export default function Home() {
  // ── State ──
  const [userId, setUserId] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [providerInfo, setProviderInfo] = useState(null);
  
  // Search & Map State
  const [origin, setOrigin] = useState(null); // { name, lat, lon }
  const [destination, setDestination] = useState(null);
  const [originQuery, setOriginQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [activeInput, setActiveInput] = useState(null); // 'origin' | 'dest'
  const [isSearching, setIsSearching] = useState(false);
  const [previewRoute, setPreviewRoute] = useState(null); // { durationMinutes, distanceMeters, geometry }
  const [recentSearches, setRecentSearches] = useState([]);
  
  // Form state
  const [alertBelow, setAlertBelow] = useState("30");
  const [alertAbove, setAlertAbove] = useState("60");
  const [pollInterval, setPollInterval] = useState("5");
  const [submitting, setSubmitting] = useState(false);
  const [checkingRouteId, setCheckingRouteId] = useState(null);

  // Debounce ref
  const searchTimeout = useRef(null);

  // ── Initialize ──
  useEffect(() => {
    const id = getUserId();
    setUserId(id);
    fetch("/api/check").then(res => res.json()).then(data => {
      if (data.providerInfo) setProviderInfo(data.providerInfo);
    }).catch(console.error);

    setRecentSearches(getRecentSearches());

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }
  }, []);

  const fetchRoutes = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/routes?userId=${userId}`);
      const data = await res.json();
      if (data.routes) setRoutes(data.routes);
    } catch (err) {}
  }, [userId]);

  const fetchAlerts = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/alerts?userId=${userId}&limit=10`);
      const data = await res.json();
      if (data.alerts) setAlerts(data.alerts);
    } catch (err) {}
  }, [userId]);

  useEffect(() => {
    if (userId) {
      fetchRoutes();
      fetchAlerts();
      const interval = setInterval(() => {
        routes.filter(r => r.status === "active").forEach(r => checkRoute(r.id, true));
        fetchRoutes();
        fetchAlerts();
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [userId, fetchRoutes, fetchAlerts, routes]);

  // ── Geocoding & Search ──
  const handleSearch = (query, type) => {
    if (type === 'origin') setOriginQuery(query);
    else setDestQuery(query);
    setActiveInput(type);
    
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    
    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      const results = await searchLocation(query);
      setSuggestions(results);
      setIsSearching(false);
    }, 400); // 400ms debounce
  };

  const selectLocation = (loc) => {
    saveRecentSearch(loc);
    setRecentSearches(getRecentSearches());
    
    if (activeInput === 'origin') {
      setOrigin(loc);
      setOriginQuery(loc.name);
    } else {
      setDestination(loc);
      setDestQuery(loc.name);
    }
    setSuggestions([]);
    setActiveInput(null);
  };

  const handleKeyDown = (e, type) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0) {
        selectLocation(suggestions[0]);
      }
    } else if (e.key === 'Escape') {
      setActiveInput(null);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setActiveInput('origin');
    setIsSearching(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const result = await reverseGeocode(latitude, longitude);
        if (result) {
          selectLocation(result);
        } else {
          selectLocation({ name: "Current Location", address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, lat: latitude, lon: longitude });
        }
        setIsSearching(false);
      },
      (err) => {
        alert("Could not get your location");
        setIsSearching(false);
      }
    );
  };

  const swapLocations = () => {
    const tempOrigin = origin;
    const tempOriginQuery = originQuery;
    setOrigin(destination);
    setOriginQuery(destQuery);
    setDestination(tempOrigin);
    setDestQuery(tempOriginQuery);
  };

  // ── Preview Route ──
  useEffect(() => {
    async function getPreview() {
      if (origin && destination) {
        try {
          const coordsString = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
          const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`;
          const res = await fetch(url);
          const data = await res.json();
          if (data.routes && data.routes.length > 0) {
            setPreviewRoute({
              durationMinutes: Math.round(data.routes[0].duration / 60),
              distanceMeters: data.routes[0].distance,
              geometry: data.routes[0].geometry
            });
          }
        } catch (err) {
          console.error("Preview error", err);
        }
      } else {
        setPreviewRoute(null);
      }
    }
    getPreview();
  }, [origin, destination]);

  // ── Create Route ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!origin || !destination) return;
    
    // Request push notification permission
    if ("serviceWorker" in navigator && "PushManager" in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
          });
          await fetch("/api/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, subscription: sub.toJSON() }),
          });
        }
      } catch (err) {
        console.error("Push auth failed", err);
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId, 
          origin: origin.name, 
          destination: destination.name,
          originPlaceId: `${origin.lat},${origin.lon}`,
          destPlaceId: `${destination.lat},${destination.lon}`,
          alertBelow: alertBelow || null, 
          alertAbove: alertAbove || null,
          pollInterval
        }),
      });

      if (res.ok) {
        setOrigin(null); setDestination(null);
        setOriginQuery(""); setDestQuery("");
        setPreviewRoute(null);
        fetchRoutes();
      } else {
        alert("Failed to start monitoring");
      }
    } catch (err) {
      alert("Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  const checkRoute = async (routeId, isSilent = false) => {
    if (!isSilent) setCheckingRouteId(routeId);
    try {
      await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId }),
      });
      fetchRoutes();
      fetchAlerts();
    } finally {
      if (!isSilent) setCheckingRouteId(null);
    }
  };

  const toggleRoute = async (id, currentStatus) => {
    const newStatus = currentStatus === "active" || currentStatus === "cooldown" ? "paused" : "active";
    await fetch("/api/routes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus, cooldownUntil: null }),
    });
    fetchRoutes();
  };

  const deleteRoute = async (id) => {
    await fetch(`/api/routes?id=${id}`, { method: "DELETE" });
    fetchRoutes();
  };

  const activeRoute = routes.find(r => r.status === "active" || r.status === "cooldown");
  const displayOrigin = origin ? [origin.lat, origin.lon] : 
                        (activeRoute && activeRoute.origin_place_id ? activeRoute.origin_place_id.split(',').map(Number) : null);
  const displayDest = destination ? [destination.lat, destination.lon] : 
                      (activeRoute && activeRoute.dest_place_id ? activeRoute.dest_place_id.split(',').map(Number) : null);
  
  return (
    <div className="map-app-container">
      {/* ── Background Map ── */}
      <div className="map-background">
        <Map 
          origin={displayOrigin} 
          destination={displayDest} 
          routeGeoJSON={previewRoute?.geometry} 
        />
      </div>

      {/* ── Foreground UI ── */}
      <div className="map-ui-layer">
        
        {/* TOP PANEL: Logo & Search */}
        <div className="map-top-panel">
          <div className="floating-card logo-card">
            <h1>Naksh <span className="subtitle">ETA MONITOR</span></h1>
            {providerInfo && <div className="provider-badge">{providerInfo.name} Provider</div>}
          </div>

          <div className="floating-card search-card">
            <div className="search-inputs">
              <div className="input-row">
                <span className="icon-origin">📍</span>
                <input 
                  type="text" 
                  placeholder="From (e.g. Home, Cyber Hub)" 
                  value={originQuery}
                  onChange={(e) => handleSearch(e.target.value, 'origin')}
                  onFocus={() => {
                    setActiveInput('origin');
                    if (originQuery.trim().length < 2) setSuggestions([]);
                  }}
                  onKeyDown={(e) => handleKeyDown(e, 'origin')}
                />
                <button className="location-btn" onClick={useMyLocation} title="Use my location">🎯</button>
              </div>
              
              <div className="swap-row">
                <button className="swap-btn" onClick={swapLocations} title="Swap origin and destination">⇅</button>
                <div className="vertical-line"></div>
              </div>

              <div className="input-row">
                <span className="icon-dest">●</span>
                <input 
                  type="text" 
                  placeholder="To (e.g. Office, Badkal Mor)" 
                  value={destQuery}
                  onChange={(e) => handleSearch(e.target.value, 'dest')}
                  onFocus={() => {
                    setActiveInput('dest');
                    if (destQuery.trim().length < 2) setSuggestions([]);
                  }}
                  onKeyDown={(e) => handleKeyDown(e, 'dest')}
                />
              </div>
            </div>

            {/* Suggestions Dropdown */}
            {activeInput && (suggestions.length > 0 || isSearching || (recentSearches.length > 0 && ((activeInput === 'origin' && originQuery.trim().length < 2) || (activeInput === 'dest' && destQuery.trim().length < 2)))) && (
              <div className="suggestions-dropdown">
                {isSearching ? (
                  <div className="suggestion-item loading">Searching globally...</div>
                ) : suggestions.length > 0 ? (
                  suggestions.map((loc, i) => (
                    <div key={i} className="suggestion-item" onClick={() => selectLocation(loc)}>
                      <div className="sugg-name">
                        <span className="sugg-icon">📍</span> {loc.name}
                      </div>
                      <div className="sugg-address">{loc.address}</div>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="recent-header">
                      <span>Recent</span>
                      <button onClick={() => { clearRecentSearches(); setRecentSearches([]); }} className="btn-clear-recent">Clear</button>
                    </div>
                    {recentSearches.map((loc, i) => (
                      <div key={`recent_${i}`} className="suggestion-item" onClick={() => selectLocation(loc)}>
                        <div className="sugg-name">
                          <span className="sugg-icon">🕒</span> {loc.name}
                        </div>
                        <div className="sugg-address">{loc.address}</div>
                      </div>
                    ))}
                  </>
                )}
                {!isSearching && suggestions.length === 0 && recentSearches.length === 0 && (
                  <div className="suggestion-item loading">No places found</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM PANELS */}
        <div className="map-bottom-panels">
          {/* SETUP MODE: Route Preview & Alert Config */}
          {previewRoute && !activeRoute && (
            <div className="floating-card route-preview-card animate-slide-up">
              <div className="route-preview-header">
                <div className="route-time">{previewRoute.durationMinutes} min</div>
                <div className="route-dist">{(previewRoute.distanceMeters / 1000).toFixed(1)} km</div>
              </div>
              <div className="route-disclaimer">Base driving estimate (Traffic data unavailable via OSRM)</div>
              
              <form onSubmit={handleSubmit} className="alert-config-form">
                <div className="config-row">
                  <label>Alert below:</label>
                  <input type="number" value={alertBelow} onChange={e => setAlertBelow(e.target.value)} /> min
                </div>
                <div className="config-row">
                  <label>Alert above:</label>
                  <input type="number" value={alertAbove} onChange={e => setAlertAbove(e.target.value)} /> min
                </div>
                <button type="submit" className="btn-start-monitor" disabled={submitting}>
                  {submitting ? "Starting..." : "🔔 Start Monitoring"}
                </button>
              </form>
            </div>
          )}

          {/* ACTIVE MONITOR MODE */}
          {activeRoute && (
            <div className="floating-card active-monitor-card animate-slide-up">
              <div className="monitor-status">
                <span className={`status-dot ${activeRoute.status}`}></span>
                {activeRoute.status === "paused" ? "Paused" : "Monitoring"}
              </div>
              
              <div className="monitor-locations">
                <div className="loc-origin">📍 {activeRoute.origin}</div>
                <div className="loc-dest">● {activeRoute.destination}</div>
              </div>

              <div className="monitor-eta-section">
                <div className="eta-display">
                  <span className="eta-val">{activeRoute.last_eta || "--"}</span>
                  <span className="eta-unit">min</span>
                </div>
                <div className="eta-meta">
                  Checked: {timeAgo(activeRoute.last_checked)}<br/>
                  Alerts: &lt;{activeRoute.alert_below || '-'} &gt;{activeRoute.alert_above || '-'}
                </div>
              </div>

              <div className="monitor-actions">
                <button className="btn-action" onClick={() => checkRoute(activeRoute.id)} disabled={checkingRouteId === activeRoute.id}>
                  {checkingRouteId === activeRoute.id ? "Checking..." : "⚡ Check Now"}
                </button>
                <button className="btn-action" onClick={() => toggleRoute(activeRoute.id, activeRoute.status)}>
                  {activeRoute.status === "paused" ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button className="btn-action danger" onClick={() => deleteRoute(activeRoute.id)}>
                  🗑 Stop
                </button>
              </div>
            </div>
          )}

          {/* ALERTS HISTORY */}
          {alerts.length > 0 && !previewRoute && (
            <div className="floating-card history-card">
              <h3>Alert History</h3>
              <div className="history-list">
                {alerts.slice(0,3).map(alert => (
                  <div key={alert.id} className="history-item">
                    <span className="hist-icon">{alert.threshold_crossed === 'below' ? '📉' : '📈'}</span>
                    <div className="hist-text">
                      ETA {alert.threshold_crossed === 'below' ? 'dropped below' : 'rose above'} {alert.threshold_value}m
                      <div className="hist-time">{timeAgo(alert.triggered_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
