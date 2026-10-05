import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "../lib/supabase";
import { checkDashboardAccess } from "../services/authService";

export default function ProtectedAdminRoute() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let isMounted = true;

    const verifyAccess = async () => {
      try {
        const result = await checkDashboardAccess();
        if (isMounted) setStatus(result);
      } catch {
        if (isMounted) setStatus("unauthenticated");
      }
    };
    verifyAccess();
    const subscription = supabase?.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT" && isMounted) {
        isMounted = false;
        setStatus("unauthenticated");
      }
    }).data.subscription;

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
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
            Add your Supabase URL and publishable key inside the .env file before
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
