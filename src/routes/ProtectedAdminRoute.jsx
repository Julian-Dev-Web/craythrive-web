import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const ALLOWED_DASHBOARD_ROLES = ["user"];

export default function ProtectedAdminRoute() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let isMounted = true;

    const checkDashboardAccess = async () => {
      if (!isSupabaseConfigured || !supabase) {
        if (isMounted) setStatus("not-configured");
        return;
      }

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData?.session?.user) {
        if (isMounted) setStatus("unauthenticated");
        return;
      }

      const userId = sessionData.session.user.id;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role")
        .eq("id", userId)
        .single();

      if (profileError) {
        await supabase.auth.signOut();
        if (isMounted) setStatus("unauthenticated");
        return;
      }

      const role = String(profile?.role || "").toLowerCase();

      if (!ALLOWED_DASHBOARD_ROLES.includes(role)) {
        await supabase.auth.signOut();
        if (isMounted) setStatus("unauthenticated");
        return;
      }

      if (isMounted) setStatus("authorized");
    };

    checkDashboardAccess();

    return () => {
      isMounted = false;
    };
  }, []);

  if (status === "checking") {
    return (
      <main className="route-loading-page">
        <div className="route-loading-card">
          <Loader2 className="spin-icon" size={30} />
          <h2>Checking dashboard access...</h2>
          <p>Please wait while CrayThrive verifies your account permission.</p>
        </div>
      </main>
    );
  }

  if (status === "not-configured") {
    return (
      <main className="route-loading-page">
        <div className="route-loading-card">
          <ShieldAlert size={32} />
          <h2>Supabase is not configured.</h2>
          <p>
            Add your Supabase URL and anon key inside the .env file before
            opening the dashboard.
          </p>
        </div>
      </main>
    );
  }

  if (status !== "authorized") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}