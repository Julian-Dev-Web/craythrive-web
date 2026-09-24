import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight, LogOut, X } from "lucide-react";
import { APP_INFO } from "../constants/theme";

/**
 * Sidebar navigation.
 *
 * Renders navItems grouped by their `group` field (falls back to a single
 * ungrouped section if an item has no group), with a small uppercase label
 * above each section. AdminLayout keeps owning the actual state
 * (collapsed/mobile-open/profile/sign-out); this component just renders it.
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
  const groups = [];
  const groupIndexByName = new Map();

  navItems.forEach((item) => {
    const groupName = item.group || "";

    if (!groupIndexByName.has(groupName)) {
      groupIndexByName.set(groupName, groups.length);
      groups.push({ name: groupName, items: [] });
    }

    groups[groupIndexByName.get(groupName)].items.push(item);
  });

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
        {groups.map((group) => (
          <div className="modern-nav-group" key={group.name || "default"}>
            {group.name && (
              <span className="modern-nav-group-label">{group.name}</span>
            )}

            {group.items.map((item) => {
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
                  <span className="modern-nav-link-icon">
                    <Icon size={19} />
                  </span>
                  <span className="modern-nav-link-label">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
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

          <span className="modern-profile-status-dot" aria-hidden="true" />
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