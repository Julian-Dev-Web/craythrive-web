import { NavLink } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
} from "lucide-react";

import "../styles/sidebar.css";

export default function Sidebar({
  navItems = [],
  isCollapsed = false,
  isMobileOpen = false,
  onCloseMobile,
  onToggleCollapse,
  displayName = "CrayThrive User",
  onSignOut,
}) {
  return (
    <aside
      className={[
        "modern-sidebar",
        isCollapsed ? "is-collapsed" : "",
        isMobileOpen ? "is-mobile-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* BRAND */}
      <div className="modern-sidebar-header">
        <div className="modern-sidebar-brand">
          {!isCollapsed && (
            <div className="modern-sidebar-brand-text">
              <strong>CrayThrive</strong>
              <span>Admin Dashboard</span>
            </div>
          )}

          {isCollapsed && (
            <strong className="modern-sidebar-brand-mini">CT</strong>
          )}
        </div>

        <button
          type="button"
          className="modern-sidebar-mobile-close"
          onClick={onCloseMobile}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
      </div>

      {/* NAVIGATION */}
      <nav className="modern-sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              title={isCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                `modern-sidebar-link ${isActive ? "active" : ""}`
              }
            >
              <span className="modern-sidebar-link-icon">
                <Icon size={19} strokeWidth={1.9} />
              </span>

              {!isCollapsed && (
                <span className="modern-sidebar-link-label">
                  {item.label}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* BOTTOM */}
      <div className="modern-sidebar-bottom">
        {/* SIMPLE PROFILE - NO WATER/WAVE ICON */}
        {!isCollapsed && (
          <div className="modern-sidebar-profile">
            <div className="modern-sidebar-profile-text">
              <strong>{displayName}</strong>
              <span>Admin</span>
            </div>
          </div>
        )}

        <button
          type="button"
          className="modern-sidebar-signout"
          onClick={onSignOut}
          title={isCollapsed ? "Logout" : undefined}
        >
          <LogOut size={18} />

          {!isCollapsed && <span>Logout</span>}
        </button>
      </div>

      {/* COLLAPSE BUTTON */}
      <button
        type="button"
        className="modern-sidebar-collapse"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <ChevronRight size={17} />
        ) : (
          <ChevronLeft size={17} />
        )}
      </button>
    </aside>
  );
}