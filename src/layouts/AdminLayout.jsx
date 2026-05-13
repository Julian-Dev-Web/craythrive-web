import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  Droplets,
  FileText,
  Home,
  LogOut,
  Menu,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingBag,
  Waves,
  X,
} from "lucide-react";
import { APP_INFO } from "../constants/theme";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const navItems = [
  { label: "Overview", path: "/admin", icon: Home, end: true },
  { label: "Tanks", path: "/admin/tanks", icon: Droplets },
  { label: "Readings", path: "/admin/readings", icon: Database },
  { label: "Marketplace", path: "/admin/marketplace", icon: ShoppingBag },
  { label: "Orders", path: "/admin/orders", icon: PackageCheck },
  { label: "Alerts", path: "/admin/alerts", icon: AlertTriangle },
  { label: "Reports", path: "/admin/reports", icon: FileText },
  { label: "Settings", path: "/admin/settings", icon: Settings },
];

const alertTables = ["alerts", "notifications", "tank_alerts"];
const userColumns = ["user_id", "owner_id", "profile_id", "created_by"];

function getPageTitle(pathname) {
  if (pathname === "/admin") return "Dashboard Overview";
  if (pathname.includes("/tanks")) return "Tanks";
  if (pathname.includes("/readings")) return "Sensor Readings";
  if (pathname.includes("/marketplace")) return "Marketplace";
  if (pathname.includes("/orders")) return "Orders";
  if (pathname.includes("/alerts")) return "Alerts";
  if (pathname.includes("/reports")) return "Reports";
  if (pathname.includes("/settings")) return "Settings";
  return "Dashboard";
}

function getDisplayName(profile, fallbackEmail) {
  return (
    profile?.username ||
    profile?.nickname ||
    profile?.display_name ||
    profile?.full_name ||
    [profile?.first_name, profile?.middle_name, profile?.last_name]
      .filter(Boolean)
      .join(" ") ||
    fallbackEmail ||
    "CrayThrive User"
  );
}

function getAvatarUrl(profile) {
  return (
    profile?.avatar_url ||
    profile?.profile_image_url ||
    profile?.profile_photo_url ||
    profile?.profile_picture_url ||
    profile?.profile_picture ||
    profile?.photo_url ||
    profile?.picture_url ||
    profile?.image_url ||
    profile?.display_photo_url ||
    ""
  );
}

function getAlertTitle(alert) {
  return (
    alert?.title ||
    alert?.alert_title ||
    alert?.type ||
    alert?.notification_type ||
    "CrayThrive Alert"
  );
}

function getAlertMessage(alert) {
  return (
    alert?.message ||
    alert?.body ||
    alert?.description ||
    alert?.notes ||
    "New system notification from your CrayThrive account."
  );
}

function getAlertSeverity(alert) {
  return String(alert?.severity || alert?.status || "info").toLowerCase();
}

function formatTime(value) {
  if (!value) return "Recently";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Recently";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadUserProfile() {
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;

  if (!user) {
    return {
      profile: null,
      email: "",
      userId: "",
    };
  }

  const userId = user.id;
  const email = user.email || "";

  const byId = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return {
      profile: byId.data,
      email,
      userId,
    };
  }

  if (email) {
    const byEmail = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      return {
        profile: byEmail.data,
        email,
        userId,
      };
    }
  }

  return {
    profile: null,
    email,
    userId,
  };
}

async function loadUserAlerts(userId) {
  if (!userId) return [];

  for (const tableName of alertTables) {
    for (const column of userColumns) {
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq(column, userId)
        .order("created_at", { ascending: false })
        .limit(8);

      if (!error && Array.isArray(data)) {
        return data;
      }
    }
  }

  return [];
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const notificationRef = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [profile, setProfile] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authUserId, setAuthUserId] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);

  const pageTitle = useMemo(
    () => getPageTitle(location.pathname),
    [location.pathname]
  );

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!isSupabaseConfigured || !supabase) return;

      const result = await loadUserProfile();

      if (!isMounted) return;

      setProfile(result.profile);
      setAuthEmail(result.email);
      setAuthUserId(result.userId);

      if (result.userId) {
        setIsLoadingAlerts(true);

        const userAlerts = await loadUserAlerts(result.userId);

        if (isMounted) {
          setAlerts(userAlerts);
          setIsLoadingAlerts(false);
        }
      }
    };

    run();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(event.target)
      ) {
        setNotificationsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const displayName = getDisplayName(profile, authEmail);
  const avatarUrl = getAvatarUrl(profile);

  const toggleDesktopSidebar = () => {
    setSidebarCollapsed((current) => !current);
  };

  const openMobileSidebar = () => {
    setSidebarOpen(true);
  };

  const handleRefreshAlerts = async () => {
    if (!authUserId || !supabase) return;

    setIsLoadingAlerts(true);
    const userAlerts = await loadUserAlerts(authUserId);
    setAlerts(userAlerts);
    setIsLoadingAlerts(false);
  };

  const handleLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }

    navigate("/login", { replace: true });
  };

  return (
    <main
      className={`admin-dashboard-shell ${
        sidebarCollapsed ? "is-sidebar-collapsed" : ""
      }`}
    >
      <button
        className={`admin-sidebar-backdrop ${sidebarOpen ? "is-visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-label="Close sidebar overlay"
      />

      <aside className={`admin-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="admin-sidebar-top">
          <div className="admin-sidebar-brand">
            <span className="admin-sidebar-logo-wrap">
              <img
                src={APP_INFO.logoPath}
                alt={`${APP_INFO.name} logo`}
                className="admin-sidebar-logo"
              />
            </span>

            <div className="admin-sidebar-brand-text">
              <strong>{APP_INFO.name}</strong>
              <span>Web Dashboard</span>
            </div>
          </div>

          <button
            className="admin-sidebar-toggle"
            onClick={toggleDesktopSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={20} />
            ) : (
              <PanelLeftClose size={20} />
            )}
          </button>

          <button
            className="admin-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="admin-nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                title={item.label}
                className={({ isActive }) =>
                  isActive ? "admin-nav-item is-active" : "admin-nav-item"
                }
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="admin-sidebar-bottom">
          <button className="admin-logout-button" onClick={handleLogout}>
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button
              className="admin-menu-button"
              onClick={openMobileSidebar}
              aria-label="Open sidebar"
            >
              <Menu size={22} />
            </button>

            <div>
              <p>CrayThrive Dashboard</p>
              <h1>{pageTitle}</h1>
            </div>
          </div>

          <div className="admin-topbar-actions">
            <div className="admin-notification-wrap" ref={notificationRef}>
              <button
                className="admin-icon-button admin-notification-button"
                aria-label="Notifications"
                onClick={() => setNotificationsOpen((current) => !current)}
              >
                <Bell size={20} />

                {alerts.length > 0 && (
                  <span className="notification-badge">
                    {alerts.length > 9 ? "9+" : alerts.length}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="notification-dropdown">
                  <div className="notification-dropdown-header">
                    <div>
                      <strong>Notifications</strong>
                      <span>{alerts.length} recent alert(s)</span>
                    </div>

                    <button type="button" onClick={handleRefreshAlerts}>
                      Refresh
                    </button>
                  </div>

                  <div className="notification-list">
                    {isLoadingAlerts ? (
                      <div className="notification-empty">
                        Loading notifications...
                      </div>
                    ) : alerts.length === 0 ? (
                      <div className="notification-empty">
                        <CheckCircle2 size={22} />
                        <strong>No notifications yet</strong>
                        <span>
                          Tank alerts, ammonia warnings, and marketplace alerts
                          will appear here.
                        </span>
                      </div>
                    ) : (
                      alerts.map((alert, index) => (
                        <button
                          type="button"
                          className="notification-item"
                          key={alert.id || index}
                          onClick={() => {
                            setNotificationsOpen(false);
                            navigate("/admin/alerts");
                          }}
                        >
                          <span
                            className={`notification-dot severity-${getAlertSeverity(
                              alert
                            )}`}
                          />

                          <div>
                            <strong>{getAlertTitle(alert)}</strong>
                            <p>{getAlertMessage(alert)}</p>
                            <small>{formatTime(alert.created_at)}</small>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="admin-user-chip">
              <div className="admin-avatar">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName} />
                ) : (
                  <Waves size={18} />
                )}
              </div>

              <div>
                <strong>{displayName}</strong>
                <span>Admin</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-content">
          <Outlet />
        </div>
      </section>
    </main>
  );
}