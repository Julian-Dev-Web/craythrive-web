import useServerTime from '../hooks/useServerTime';
import { formatPhilippineDate, formatPhilippineTime } from '../utils/philippineTime';
import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Database,
  Droplets,
  FileText,
  LayoutDashboard,
  PackageCheck,
  Settings,
  ShoppingBag,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import { getCurrentProfile, signOut } from "../services/authService";
import { isSupabaseConfigured } from "../lib/supabase";
import DashboardTourProvider from "../components/tour/DashboardTourProvider";
import DashboardTourInvitation from "../components/tour/DashboardTourInvitation";

const navItems = [
  { label: "Overview", path: "/admin", icon: LayoutDashboard, end: true, group: "Overview" },
  { label: "Tanks", path: "/admin/tanks", icon: Droplets, group: "Monitoring" },
  { label: "Readings", path: "/admin/readings", icon: Database, group: "Monitoring" },
  { label: "Alerts", path: "/admin/alerts", icon: AlertTriangle, group: "Monitoring" },
  { label: "Marketplace", path: "/admin/marketplace", icon: ShoppingBag, group: "Marketplace" },
  { label: "Orders", path: "/admin/orders", icon: PackageCheck, group: "Marketplace" },
  { label: "Reports", path: "/admin/reports", icon: FileText, group: "System" },
  { label: "Settings", path: "/admin/settings", icon: Settings, group: "System" },
];

function getInitialTheme() {
  const stored = localStorage.getItem("craythrive_dashboard_theme");
  return stored === "light" || stored === "dark" ? stored : "dark";
}

function getPageTitle(pathname) {
  const current = navItems.find((item) =>
    item.end ? pathname === item.path : pathname.startsWith(item.path)
  );
  return current?.label || "Dashboard";
}

function formatPhilippinesTime(date) { return formatPhilippineTime(date, { second: '2-digit' }, 'Time unavailable'); }

function formatPhilippinesDate(date) { return formatPhilippineDate(date, { weekday: 'short' }, ''); }

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [themeMode, setThemeMode] = useState(getInitialTheme);
  const [profile, setProfile] = useState(null);
  const clock = useServerTime();

  const pageTitle = useMemo(() => getPageTitle(location.pathname), [location.pathname]);

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
    localStorage.setItem("craythrive_dashboard_theme", themeMode);
    document.documentElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!isSupabaseConfigured) return;
      const { user, profile: profileData } = await getCurrentProfile();
      if (!user) return;
      setProfile(profileData || { email: user.email });
    };

    loadProfile();
  }, []);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <DashboardTourProvider>
    <div className={`modern-admin-shell admin-dashboard-shell ${isCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        navItems={navItems}
        isCollapsed={isCollapsed}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
        onToggleCollapse={() => setIsCollapsed((current) => !current)}
        displayName={displayName}
        avatarUrl={avatarUrl}
        onSignOut={handleSignOut}
      />

      {isMobileOpen && (
        <button
          type="button"
          className="modern-sidebar-overlay"
          onClick={() => setIsMobileOpen(false)}
          aria-label="Close sidebar overlay"
        />
      )}

      <div className="modern-admin-main">
        <Topbar
          pageTitle={pageTitle}
          onOpenMobileMenu={() => setIsMobileOpen(true)}
          clockTime={formatPhilippinesTime(clock)}
          clockDate={formatPhilippinesDate(clock)}
          themeMode={themeMode}
          onSetThemeMode={setThemeMode}
          onOpenSettings={() => navigate("/admin/settings")}
          displayName={displayName}
        />

        <main className="modern-admin-content admin-content" tabIndex={-1}>
          <DashboardTourInvitation />
          <Outlet />
        </main>
      </div>
    </div>
    </DashboardTourProvider>
  );
}
