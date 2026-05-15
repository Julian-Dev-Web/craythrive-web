import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  ChevronLeft,
  ChevronRight,
  Database,
  Droplets,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PackageCheck,
  Settings,
  ShoppingBag,
  Sun,
  Waves,
  X,
} from "lucide-react";
import { APP_INFO } from "../constants/theme";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const navItems = [
  {
    label: "Overview",
    path: "/admin",
    icon: LayoutDashboard,
    end: true,
  },
  {
    label: "Tanks",
    path: "/admin/tanks",
    icon: Droplets,
  },
  {
    label: "Readings",
    path: "/admin/readings",
    icon: Database,
  },
  {
    label: "Marketplace",
    path: "/admin/marketplace",
    icon: ShoppingBag,
  },
  {
    label: "Orders",
    path: "/admin/orders",
    icon: PackageCheck,
  },
  {
    label: "Alerts",
    path: "/admin/alerts",
    icon: AlertTriangle,
  },
  {
    label: "Reports",
    path: "/admin/reports",
    icon: FileText,
  },
  {
    label: "Settings",
    path: "/admin/settings",
    icon: Settings,
  },
];

function getInitialTheme() {
  return localStorage.getItem("craythrive_dashboard_theme") || "dark";
}

function getResolvedTheme(themeMode) {
  if (themeMode !== "system") return themeMode;

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getPageTitle(pathname) {
  const current = navItems.find((item) => {
    if (item.end) return pathname === item.path;
    return pathname.startsWith(item.path);
  });

  return current?.label || "Dashboard";
}

function formatPhilippinesTime(date) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}

function formatPhilippinesDate(date) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

async function getProfileByUser(user) {
  if (!user || !supabase) return null;

  const byId = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!byId.error && byId.data) {
    return byId.data;
  }

  if (user.email) {
    const byEmail = await supabase
      .from("profiles")
      .select("*")
      .ilike("email", user.email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      return byEmail.data;
    }
  }

  return null;
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [themeMode, setThemeMode] = useState(getInitialTheme);
  const [profile, setProfile] = useState(null);
  const [clock, setClock] = useState(new Date());

  const resolvedTheme = useMemo(() => getResolvedTheme(themeMode), [themeMode]);
  const pageTitle = useMemo(
    () => getPageTitle(location.pathname),
    [location.pathname]
  );

  const displayName =
    profile?.username ||
    profile?.full_name ||
    profile?.first_name ||
    profile?.email?.split("@")?.[0] ||
    "CrayThrive User";

  const avatarUrl =
    profile?.avatar_url ||
    profile?.profile_image_url ||
    profile?.profile_picture_url ||
    profile?.photo_url ||
    "";

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("craythrive_dashboard_theme", themeMode);
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.setAttribute("data-theme-mode", themeMode);
  }, [themeMode, resolvedTheme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const handleSystemThemeChange = () => {
      if (themeMode === "system") {
        document.documentElement.setAttribute(
          "data-theme",
          getResolvedTheme("system")
        );
      }
    };

    media.addEventListener("change", handleSystemThemeChange);

    return () => {
      media.removeEventListener("change", handleSystemThemeChange);
    };
  }, [themeMode]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!isSupabaseConfigured || !supabase) return;

      const { data } = await supabase.auth.getSession();
      const user = data?.session?.user;

      if (!user) return;

      const profileData = await getProfileByUser(user);
      setProfile(profileData || { email: user.email });
    };

    loadProfile();
  }, []);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }

    navigate("/login", { replace: true });
  };

  return (
    <div
      className={`modern-admin-shell admin-dashboard-shell ${
        isCollapsed ? "sidebar-collapsed" : ""
      }`}
    >
      <aside
        className={`modern-admin-sidebar ${isCollapsed ? "is-collapsed" : ""} ${
          isMobileOpen ? "is-mobile-open" : ""
        }`}
      >
        <div className="modern-sidebar-brand">
          <div
            className="modern-sidebar-logo"
            style={{
              backgroundImage: `url(${APP_INFO.logoPath})`,
            }}
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
          onClick={() => setIsMobileOpen(false)}
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

        <div className="modern-sidebar-profile">
          <div className="modern-profile-avatar">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} />
            ) : (
              <Waves size={21} />
            )}
          </div>

          <div className="modern-profile-text">
            <strong>{displayName}</strong>
            <span>Admin</span>
          </div>
        </div>

        <button
          type="button"
          className="modern-signout-button"
          onClick={handleSignOut}
          title="Sign out"
        >
          <LogOut size={19} />
          <span>Sign Out</span>
        </button>

        <button
          type="button"
          className="modern-sidebar-collapse"
          onClick={() => setIsCollapsed((current) => !current)}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight size={22} /> : <ChevronLeft size={22} />}
        </button>
      </aside>

      {isMobileOpen && (
        <button
          type="button"
          className="modern-sidebar-overlay"
          onClick={() => setIsMobileOpen(false)}
          aria-label="Close sidebar overlay"
        />
      )}

      <div className="modern-admin-main">
        <header className="modern-admin-topbar admin-topbar">
          <div className="modern-topbar-left">
            <button
              type="button"
              className="modern-icon-button mobile-menu-button"
              onClick={() => setIsMobileOpen(true)}
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
              <strong>{formatPhilippinesTime(clock)}</strong>
              <span>{formatPhilippinesDate(clock)}</span>
            </div>

            <div className="modern-theme-toggle">
              <button
                type="button"
                className={themeMode === "light" ? "is-active" : ""}
                onClick={() => setThemeMode("light")}
                title="Light mode"
              >
                <Sun size={16} />
              </button>

              <button
                type="button"
                className={themeMode === "dark" ? "is-active" : ""}
                onClick={() => setThemeMode("dark")}
                title="Dark mode"
              >
                <Moon size={16} />
              </button>

              <button
                type="button"
                className={themeMode === "system" ? "is-active" : ""}
                onClick={() => setThemeMode("system")}
                title="System mode"
              >
                <Monitor size={16} />
              </button>
            </div>

            <button
              type="button"
              className="modern-icon-button"
              aria-label="Notifications"
              onClick={() => navigate("/admin/alerts")}
            >
              <Bell size={20} />
            </button>

            <button
              type="button"
              className="modern-user-pill"
              onClick={() => navigate("/admin/settings")}
              title="Open settings"
            >
              <span>{displayName}</span>
            </button>
          </div>
        </header>

        <main className="modern-admin-content admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}