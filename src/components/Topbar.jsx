import { Menu, Moon, Sun } from "lucide-react";
import NotificationBell from "./NotificationBell";

/**
 * Top bar, extracted from AdminLayout.jsx. Same behavior-preserving
 * extraction approach as Sidebar.jsx — AdminLayout still owns state
 * (theme mode, clock, profile, navigation), this just renders it.
 *
 * Theme toggle is light/dark only now (system mode removed).
 * Notifications open an inline dropdown (NotificationBell) instead of
 * navigating straight to /admin/alerts.
 */
export default function Topbar({
  pageTitle,
  onOpenMobileMenu,
  clockTime,
  clockDate,
  themeMode,
  onSetThemeMode,
  onOpenSettings,
  displayName,
}) {
  return (
    <header className="modern-admin-topbar admin-topbar">
      <div className="modern-topbar-left">
        <button
          type="button"
          className="modern-icon-button mobile-menu-button"
          onClick={onOpenMobileMenu}
          aria-label="Open sidebar"
        >
          <Menu size={22} />
        </button>

        <div>
          <p>CrayThrive Dashboard</p>
          <h1>{pageTitle}</h1>
        </div>
      </div>

      <div className="modern-topbar-right">
        <div className="modern-clock-card">
          <strong>{clockTime}</strong>
          <span>{clockDate}</span>
        </div>

        <div className="modern-theme-toggle">
          <button
            type="button"
            className={themeMode === "light" ? "is-active" : ""}
            onClick={() => onSetThemeMode("light")}
            title="Light mode"
          >
            <Sun size={16} />
          </button>

          <button
            type="button"
            className={themeMode === "dark" ? "is-active" : ""}
            onClick={() => onSetThemeMode("dark")}
            title="Dark mode"
          >
            <Moon size={16} />
          </button>
        </div>

        <NotificationBell />

        <button
          type="button"
          className="modern-user-pill"
          onClick={onOpenSettings}
          title="Open settings"
        >
          <span>{displayName}</span>
        </button>
      </div>
    </header>
  );
}