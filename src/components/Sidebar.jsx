import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Fish,
  Activity,
  FileText,
  Store,
  Users,
  Settings,
  SlidersHorizontal,
  LogOut,
} from "lucide-react";

export default function Sidebar() {
  const navItems = [
    {
      label: "Dashboard",
      path: "/admin",
      icon: LayoutDashboard,
      end: true,
    },
    {
      label: "Tanks",
      path: "/admin/tanks",
      icon: Fish,
    },
    {
      label: "Sensor Readings",
      path: "/admin/sensor-readings",
      icon: Activity,
    },
    {
      label: "Reports",
      path: "/admin/reports",
      icon: FileText,
    },
    {
      label: "Marketplace",
      path: "/admin/marketplace",
      icon: Store,
    },
    {
      label: "Users",
      path: "/admin/users",
      icon: Users,
    },
    {
      label: "Threshold Settings",
      path: "/admin/threshold-settings",
      icon: SlidersHorizontal,
    },
    {
      label: "Settings",
      path: "/admin/settings",
      icon: Settings,
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div>
            <h2>CrayThrive</h2>
            <span>Admin Dashboard</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ label, path, icon: Icon, end }) => (
          <NavLink
            key={path}
            to={path}
            end={end}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? "active" : ""}`
            }
          >
            <Icon size={19} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <strong>Julians</strong>
            <span>Admin</span>
          </div>
        </div>

        <button className="sidebar-logout" type="button">
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}