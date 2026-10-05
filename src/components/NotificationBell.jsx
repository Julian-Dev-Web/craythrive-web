import { getSafeErrorMessage } from "../utils/securityDiagnostics";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, Loader2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { TABLES } from "../constants/schema";

const RECENT_ALERTS_LIMIT = 6;

function formatRelativeTime(isoString) {
  if (!isoString) return "";

  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Notification bell with an inline dropdown, instead of navigating straight
 * to /admin/alerts. Fetches real rows from the `alerts` table (confirmed
 * columns: id, user_id, tank_id, title, message, status, is_read,
 * created_at) — no placeholder/fake notifications.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const containerRef = useRef(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const unresolvedCount = alerts.filter((alert) => alert.status !== "resolved").length;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadAlerts = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured.");
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage("");

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      if (!userId) {
        setAlerts([]);
        return;
      }

      const { data, error } = await supabase
        .from(TABLES.ALERTS)
        .select("id, tank_id, title, message, status, is_read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(RECENT_ALERTS_LIMIT);

      if (error) throw error;

      setAlerts(data || []);
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error, "Could not load notifications."));
    } finally {
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
  };

  const handleToggle = () => {
    const nextIsOpen = !isOpen;
    setIsOpen(nextIsOpen);

    if (nextIsOpen && !hasLoadedOnce) {
      loadAlerts();
    }
  };

  const handleViewAll = () => {
    setIsOpen(false);
    navigate("/admin/alerts");
  };

  return (
    <div className="modern-notification-wrap" ref={containerRef}>
      <button
        type="button"
        className="modern-icon-button"
        aria-label="Notifications"
        onClick={handleToggle}
      >
        <Bell size={20} />
        {unresolvedCount > 0 && (
          <span className="modern-notification-dot">{unresolvedCount > 9 ? "9+" : unresolvedCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="modern-notification-panel">
          <div className="modern-notification-panel-head">
            <strong>Notifications</strong>
            <span>{unresolvedCount} unresolved</span>
          </div>

          <div className="modern-notification-list">
            {isLoading && (
              <div className="modern-notification-state">
                <Loader2 className="spin-icon" size={20} />
                <span>Loading notifications...</span>
              </div>
            )}

            {!isLoading && errorMessage && (
              <div className="modern-notification-state danger">
                <AlertTriangle size={20} />
                <span>{errorMessage}</span>
              </div>
            )}

            {!isLoading && !errorMessage && alerts.length === 0 && (
              <div className="modern-notification-state">
                <Bell size={20} />
                <span>No notifications yet.</span>
              </div>
            )}

            {!isLoading &&
              !errorMessage &&
              alerts.map((alert) => (
                <button
                  type="button"
                  className={`modern-notification-item ${alert.is_read ? "" : "is-unread"}`}
                  key={alert.id}
                  onClick={handleViewAll}
                >
                  <span className="modern-notification-item-title">
                    {alert.title || "Alert"}
                  </span>
                  {alert.message && (
                    <span className="modern-notification-item-message">{alert.message}</span>
                  )}
                  <span className="modern-notification-item-time">
                    {formatRelativeTime(alert.created_at)}
                  </span>
                </button>
              ))}
          </div>

          <button type="button" className="modern-notification-viewall" onClick={handleViewAll}>
            View all alerts
          </button>
        </div>
      )}
    </div>
  );
}