"use client";

import { useState, useEffect, useCallback } from "react";

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

// ── Utility: Format time ago ──
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

// ── Utility: Format duration ──
function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes} min`;
}

export default function Home() {
  // ── State ──
  const [userId, setUserId] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [toasts, setToasts] = useState([]);

  // Form state
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [alertBelow, setAlertBelow] = useState("");
  const [alertAbove, setAlertAbove] = useState("");
  const [pollInterval, setPollInterval] = useState("10");
  const [submitting, setSubmitting] = useState(false);

  // ── Toast helper ──
  const addToast = useCallback((message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // ── Initialize ──
  useEffect(() => {
    const id = getUserId();
    setUserId(id);

    // Check push notification support
    if ("serviceWorker" in navigator && "PushManager" in window) {
      setPushSupported(true);
      // Check existing subscription
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          if (sub) setPushSubscribed(true);
        });
      });
    }

    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }
  }, []);

  // ── Fetch data ──
  const fetchRoutes = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/routes?userId=${userId}`);
      const data = await res.json();
      if (data.routes) setRoutes(data.routes);
    } catch (err) {
      console.error("Error fetching routes:", err);
    }
  }, [userId]);

  const fetchAlerts = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/alerts?userId=${userId}&limit=10`);
      const data = await res.json();
      if (data.alerts) setAlerts(data.alerts);
    } catch (err) {
      console.error("Error fetching alerts:", err);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      fetchRoutes();
      fetchAlerts();
      // Auto-refresh every 60 seconds
      const interval = setInterval(() => {
        fetchRoutes();
        fetchAlerts();
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [userId, fetchRoutes, fetchAlerts]);

  // ── Subscribe to push notifications ──
  const subscribePush = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

      if (!vapidKey) {
        addToast("Push notifications not configured yet", "error");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      // Send subscription to backend
      await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          subscription: subscription.toJSON(),
        }),
      });

      setPushSubscribed(true);
      setShowBanner(false);
      addToast("🔔 Push notifications enabled!");
    } catch (err) {
      console.error("Push subscription error:", err);
      addToast("Failed to enable notifications. Check permissions.", "error");
    }
  };

  // ── Create a new monitored route ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!origin || !destination || (!alertBelow && !alertAbove)) {
      addToast("Fill in origin, destination, and at least one threshold", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          origin,
          destination,
          alertBelow: alertBelow || null,
          alertAbove: alertAbove || null,
          pollInterval,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        addToast("🚗 Route monitoring started!");
        setOrigin("");
        setDestination("");
        setAlertBelow("");
        setAlertAbove("");
        fetchRoutes();
      } else {
        addToast(data.error || "Failed to create route", "error");
      }
    } catch (err) {
      addToast("Network error. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete a route ──
  const deleteRoute = async (id) => {
    try {
      await fetch(`/api/routes?id=${id}`, { method: "DELETE" });
      addToast("Route removed");
      fetchRoutes();
    } catch (err) {
      addToast("Failed to remove route", "error");
    }
  };

  // ── Pause/Resume a route ──
  const toggleRoute = async (id, currentStatus) => {
    const newStatus = currentStatus === "active" || currentStatus === "cooldown"
      ? "paused"
      : "active";
    try {
      await fetch("/api/routes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus, cooldownUntil: null }),
      });
      addToast(newStatus === "paused" ? "⏸ Route paused" : "▶ Route resumed");
      fetchRoutes();
    } catch (err) {
      addToast("Failed to update route", "error");
    }
  };

  // ── Threshold bar calculation ──
  const getThresholdPercent = (route) => {
    if (route.last_eta === null) return 50;
    const min = Math.min(route.alert_below || 0, route.last_eta) - 10;
    const max = Math.max(route.alert_above || 120, route.last_eta) + 10;
    const range = max - min;
    return Math.max(0, Math.min(100, ((route.last_eta - min) / range) * 100));
  };

  return (
    <div className="app-container">
      {/* ── Header ── */}
      <header className="app-header animate-fade-in">
        <div className="app-logo">
          <div className="app-logo-icon">🛣️</div>
          <div>
            <h1>Naksh</h1>
            <div className="app-logo-subtitle">ETA Monitor</div>
          </div>
        </div>
        <div className="header-actions">
          {pushSupported && !pushSubscribed && (
            <button className="btn btn-primary btn-sm" onClick={subscribePush}>
              🔔 Enable Alerts
            </button>
          )}
          {pushSubscribed && (
            <span className="status-badge watching">Notifications On</span>
          )}
        </div>
      </header>

      {/* ── Notification Permission Banner ── */}
      {pushSupported && !pushSubscribed && showBanner && (
        <div className="notification-banner animate-slide-up">
          <div className="notification-banner-text">
            <span className="icon">🔔</span>
            <p>
              <strong>Enable push notifications</strong> to get ETA alerts
              directly on your phone — even when this tab is closed.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn btn-primary btn-sm" onClick={subscribePush}>
              Allow Notifications
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowBanner(false)}
            >
              Later
            </button>
          </div>
        </div>
      )}

      {/* ── Main Grid ── */}
      <div className="main-grid">
        {/* ── Route Setup Panel ── */}
        <div className="glass-card animate-slide-up">
          <div className="glass-card-header">
            <div className="glass-card-title">
              <span className="icon">📍</span>
              New Route Monitor
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Origin</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Connaught Place, New Delhi"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Destination</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Cyber Hub, Gurugram"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </div>

            <div className="divider" />

            <div className="form-group">
              <label className="form-label">Alert Thresholds</label>
              <div className="form-row">
                <div className="form-input-with-unit">
                  <input
                    type="number"
                    className="form-input"
                    placeholder="e.g. 45"
                    value={alertBelow}
                    onChange={(e) => setAlertBelow(e.target.value)}
                    min="1"
                  />
                  <span className="form-input-unit">min ↓</span>
                </div>
                <div className="form-input-with-unit">
                  <input
                    type="number"
                    className="form-input"
                    placeholder="e.g. 60"
                    value={alertAbove}
                    onChange={(e) => setAlertAbove(e.target.value)}
                    min="1"
                  />
                  <span className="form-input-unit">min ↑</span>
                </div>
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-tertiary)",
                  marginTop: "6px",
                }}
              >
                Alert when ETA drops below ↓ or rises above ↑
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Check Every</label>
              <select
                className="form-select"
                value={pollInterval}
                onChange={(e) => setPollInterval(e.target.value)}
              >
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
              </select>
            </div>

            <button
              type="submit"
              className={`btn btn-monitor ${submitting ? "active" : ""}`}
              disabled={submitting}
            >
              <span className="btn-text">
                {submitting ? (
                  <>
                    <span className="spinner" style={{ display: "inline-block" }} />
                    Starting...
                  </>
                ) : (
                  "🚀 Start Monitoring"
                )}
              </span>
            </button>
          </form>
        </div>

        {/* ── Live Monitor Panel ── */}
        <div className="glass-card animate-slide-up" style={{ animationDelay: "0.1s" }}>
          <div className="glass-card-header">
            <div className="glass-card-title">
              <span className="icon">📡</span>
              Active Monitors
            </div>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--text-tertiary)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {routes.length} active
            </span>
          </div>

          {routes.length === 0 ? (
            <div className="empty-state">
              <div className="icon">🛣️</div>
              <p>No routes being monitored yet. Create one to get started.</p>
            </div>
          ) : (
            <div style={{ maxHeight: "500px", overflowY: "auto" }}>
              {routes.map((route) => (
                <div key={route.id} className="route-card">
                  <div className="route-card-header">
                    <div>
                      <div className="route-card-title">
                        {route.origin}
                        <span style={{ color: "var(--accent-cyan)", margin: "0 8px" }}>→</span>
                        {route.destination}
                      </div>
                      <div className="route-card-subtitle">
                        Checked {timeAgo(route.last_checked)}
                      </div>
                    </div>
                    <span className={`status-badge ${route.status}`}>
                      {route.status}
                    </span>
                  </div>

                  {/* ETA Display */}
                  {route.last_eta !== null && (
                    <div className="eta-display">
                      <div className="eta-number">{route.last_eta}</div>
                      <div className="eta-unit">minutes</div>
                    </div>
                  )}

                  {/* Threshold Bar */}
                  {route.last_eta !== null && (
                    <div className="threshold-bar-container">
                      <div className="threshold-bar-labels">
                        <span>
                          {route.alert_below ? `↓ ${route.alert_below}m` : ""}
                        </span>
                        <span>
                          {route.alert_above ? `↑ ${route.alert_above}m` : ""}
                        </span>
                      </div>
                      <div className="threshold-bar">
                        <div
                          className="threshold-bar-fill"
                          style={{ width: `${getThresholdPercent(route)}%` }}
                        />
                        <div
                          className="threshold-bar-marker"
                          style={{ left: `${getThresholdPercent(route)}%` }}
                        />
                        {route.alert_below && (
                          <div
                            className="threshold-line"
                            style={{
                              left: `${
                                ((route.alert_below -
                                  (Math.min(
                                    route.alert_below || 0,
                                    route.last_eta
                                  ) -
                                    10)) /
                                  (Math.max(
                                    route.alert_above || 120,
                                    route.last_eta
                                  ) +
                                    10 -
                                    (Math.min(
                                      route.alert_below || 0,
                                      route.last_eta
                                    ) -
                                      10))) *
                                100
                              }%`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Meta info */}
                  <div className="route-card-meta">
                    <div className="route-card-meta-item">
                      <span className="route-card-meta-label">Alert Below</span>
                      <span className="route-card-meta-value">
                        {route.alert_below ? `${route.alert_below}m` : "—"}
                      </span>
                    </div>
                    <div className="route-card-meta-item">
                      <span className="route-card-meta-label">Alert Above</span>
                      <span className="route-card-meta-value">
                        {route.alert_above ? `${route.alert_above}m` : "—"}
                      </span>
                    </div>
                    <div className="route-card-meta-item">
                      <span className="route-card-meta-label">Interval</span>
                      <span className="route-card-meta-value">
                        {route.poll_interval}m
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginTop: "16px",
                    }}
                  >
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => toggleRoute(route.id, route.status)}
                    >
                      {route.status === "paused" ? "▶ Resume" : "⏸ Pause"}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => deleteRoute(route.id)}
                    >
                      🗑 Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Alert History ── */}
      <div className="glass-card animate-slide-up" style={{ animationDelay: "0.2s" }}>
        <div className="glass-card-header">
          <div className="glass-card-title">
            <span className="icon">🔔</span>
            Alert History
          </div>
        </div>

        {alerts.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📭</div>
            <p>No alerts triggered yet. They'll appear here when your ETA thresholds are crossed.</p>
          </div>
        ) : (
          <div className="alert-timeline">
            {alerts.map((alert) => (
              <div key={alert.id} className="alert-item">
                <div
                  className={`alert-icon ${alert.threshold_crossed}`}
                >
                  {alert.threshold_crossed === "below" ? "📉" : "📈"}
                </div>
                <div className="alert-content">
                  <div className="alert-message">
                    ETA{" "}
                    {alert.threshold_crossed === "below"
                      ? "dropped below"
                      : "rose above"}{" "}
                    <strong>{alert.threshold_value} min</strong>
                    {" — "}
                    currently{" "}
                    <strong
                      style={{
                        color:
                          alert.threshold_crossed === "below"
                            ? "#00e676"
                            : "#ff6b6b",
                      }}
                    >
                      {alert.eta_at_trigger} min
                    </strong>
                  </div>
                  {alert.monitored_routes && (
                    <div className="alert-time">
                      {alert.monitored_routes.origin} →{" "}
                      {alert.monitored_routes.destination}
                      {" · "}
                      {timeAgo(alert.triggered_at)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Toast Notifications ── */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helper: Convert VAPID key to Uint8Array ──
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
