import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight, LogOut, X } from "lucide-react";
import { APP_INFO } from "../constants/theme";

/**
 * Sidebar navigation, extracted from AdminLayout.jsx.
 *
 * This is a pure, behavior-preserving extraction — the JSX, class names, and
 * props map exactly to what AdminLayout used to render inline. AdminLayout
 * keeps owning the actual state (collapsed/mobile-open/profile/sign-out);
 * this component just renders it.
 */
export default function Sidebar({
  navItems,
  isCollapsed,
  isMobileOpen,
  onCloseMobile,
  onToggleCollapse,
  displayName,
  avatarUrl,
  onSignOut,
}) {
  return (
    <aside
      className={`modern-admin-sidebar ${isCollapsed ? "is-collapsed" : ""} ${
        isMobileOpen ? "is-mobile-open" : ""
      }`}
    >
      <div className="modern-sidebar-brand">
        <div
          className="modern-sidebar-logo"
          style={{ backgroundImage: `url(${APP_INFO.logoPath})` }}
          aria-label={`${APP_INFO.name} logo`}
        />

        <div className="modern-sidebar-brand-text">
          <strong>CrayThrive</strong>
          <span>Web Dashboard</span>
        </div>
      </div>

      <button
        type="button"
        className="modern-mobile-close"
        onClick={onCloseMobile}
        aria-label="Close sidebar"
      >
        <X size={20} />
      </button>

      <nav className="modern-sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `modern-nav-link ${isActive ? "is-active" : ""}`
              }
              title={item.label}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {!isCollapsed && (
        <div className="modern-sidebar-profile">
          {avatarUrl && (
            <div className="modern-profile-avatar">
              <img src={avatarUrl} alt={displayName} />
            </div>
          )}

          <div className="modern-profile-text">
            <strong>{displayName}</strong>
            <span>Admin</span>
          </div>
        </div>
      )}

      <button
        type="button"
        className="modern-signout-button"
        onClick={onSignOut}
        title="Sign out"
      >
        <LogOut size={19} />
        <span>Sign Out</span>
      </button>

      <button
        type="button"
        className="modern-sidebar-collapse"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <ChevronRight size={22} />
        ) : (
          <ChevronLeft size={22} />
        )}
      </button>
    </aside>
  );
}