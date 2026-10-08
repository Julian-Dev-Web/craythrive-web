import { getSafeErrorMessage } from "../../utils/securityDiagnostics";
import { dashboardTourSession } from "../../utils/dashboardTour";
import { useState } from "react";
import {
  Link,
  useNavigate,
} from "react-router-dom";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LogIn,
  ShieldCheck,
  Smartphone,
  Waves,
} from "lucide-react";

import {
  APP_INFO,
} from "../../constants/theme";

import {
  isSupabaseConfigured,
} from "../../lib/supabase";

import {
  signInWithDashboardAccess,
} from "../../services/authService";

/*
|--------------------------------------------------------------------------
| APK DOWNLOAD
|--------------------------------------------------------------------------
|
| Permanent latest-release URL.
|
| Every GitHub release must contain a file named exactly:
|
| craythrive.apk
|
*/

const APK_DOWNLOAD_URL =
  "https://github.com/Julian-Dev-Web/craythrive-releases/releases/latest/download/craythrive.apk";

export default function AdminLogin() {
  const navigate =
    useNavigate();

  const [
    email,
    setEmail,
  ] =
    useState("");

  const [
    password,
    setPassword,
  ] =
    useState("");

  const [
    showPassword,
    setShowPassword,
  ] =
    useState(false);

  const [
    isSigningIn,
    setIsSigningIn,
  ] =
    useState(false);

  const [
    errorMessage,
    setErrorMessage,
  ] =
    useState("");

  /*
  |--------------------------------------------------------------------------
  | LOGIN
  |--------------------------------------------------------------------------
  */

  const handleLogin =
    async (
      event
    ) => {
      event.preventDefault();

      setErrorMessage("");

      if (
        !isSupabaseConfigured
      ) {
        setErrorMessage(
          "Supabase is not configured yet. Please check your .env file."
        );

        return;
      }

      if (
        !email.trim() ||
        !password.trim()
      ) {
        setErrorMessage(
          "Please enter your email and password."
        );

        return;
      }

      try {
        setIsSigningIn(
          true
        );

        const {
          user,
          profile,
          error,
        } =
          await signInWithDashboardAccess(
            email,
            password
          );

        if (error) {
          setErrorMessage(
            error
          );

          return;
        }

        if (!profile) {
          setErrorMessage(
            "Could not sign in. Please try again."
          );

          return;
        }

        dashboardTourSession.beginLogin(user?.id);
        navigate(
          "/admin",
          {
            replace:
              true,
          }
        );
      } catch (
        error
      ) {
        setErrorMessage(
          getSafeErrorMessage(error, "Could not sign in. Please try again.")
        );
      } finally {
        setIsSigningIn(
          false
        );
      }
    };

  return (
    <main className="admin-auth-page">
      {/* ================================================================
          BACKGROUND
      ================================================================= */}

      <div className="admin-auth-bg-grid" />

      <div className="admin-auth-glow admin-auth-glow-one" />

      <div className="admin-auth-glow admin-auth-glow-two" />

      {/* ================================================================
          BACK
      ================================================================= */}

      <Link
        to="/"
        className="admin-auth-back"
      >
        <ArrowLeft size={17} />

        <span>
          Back to Home
        </span>
      </Link>

      {/* ================================================================
          CARD
      ================================================================= */}

      <section className="admin-auth-card">
        {/* ==============================================================
            LEFT
        =============================================================== */}

        <div className="admin-auth-showcase">
          <div className="admin-showcase-pattern">
            <span className="pattern-ring pattern-ring-1" />

            <span className="pattern-ring pattern-ring-2" />

            <span className="pattern-ring pattern-ring-3" />

            <span className="pattern-ring pattern-ring-4" />
          </div>

          <div className="admin-showcase-content">
            <p className="admin-showcase-kicker">
              SMART AQUACULTURE
            </p>

            <h1>
              Welcome
              <br />
              to{" "}
              <span>
                CrayThrive.
              </span>
            </h1>

            <p className="admin-showcase-description">
              Monitor your crayfish tanks, review water
              conditions, manage thresholds, and stay
              connected to your aquaculture system from
              one intelligent dashboard.
            </p>

            <div className="admin-showcase-features">
              <div className="admin-feature-pill">
                <ShieldCheck size={17} />
                Secure access
              </div>

              <div className="admin-feature-pill">
                <Waves size={17} />
                Live monitoring
              </div>
            </div>
          </div>

          <div className="admin-showcase-footer">
            <span>
              © 2026 CrayThrive
            </span>

            <div className="admin-showcase-status">
              <span />
              System ready
            </div>
          </div>
        </div>

        {/* ==============================================================
            RIGHT
        =============================================================== */}

        <div className="admin-auth-form-panel">
          <div className="admin-auth-form-wrap">
            {/* MOBILE BRAND */}

            <div className="admin-auth-mobile-brand">
              <div
                className="admin-auth-mobile-logo"
                style={{
                  backgroundImage:
                    `url(${APP_INFO.logoPath})`,
                }}
              />

              <strong>
                {APP_INFO.name}
              </strong>
            </div>

            {/* HEADING */}

            <div className="admin-form-heading">
              <span className="admin-form-eyebrow">
                ACCOUNT ACCESS
              </span>

              <h2>
                Welcome back!
              </h2>

              <p>
                Sign in using your registered CrayThrive
                account to continue to your dashboard.
              </p>
            </div>

            {/* ERROR */}

            {errorMessage && (
              <div className="admin-auth-alert">
                <AlertTriangle size={18} />

                <span>
                  {errorMessage}
                </span>
              </div>
            )}

            {/* FORM */}

            <form
              className="admin-auth-form"
              onSubmit={handleLogin}
            >
              {/* EMAIL */}

              <label className="admin-auth-field">
                <span>
                  Email address
                </span>

                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) =>
                    setEmail(
                      event.target.value
                    )
                  }
                  autoComplete="email"
                  disabled={isSigningIn}
                />
              </label>

              {/* PASSWORD */}

              <label className="admin-auth-field">
                <span>
                  Password
                </span>

                <div className="admin-password-field">
                  <input
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) =>
                      setPassword(
                        event.target.value
                      )
                    }
                    autoComplete="current-password"
                    disabled={isSigningIn}
                  />

                  <button
                    type="button"
                    className="admin-password-toggle"
                    onClick={() =>
                      setShowPassword(
                        (current) =>
                          !current
                      )
                    }
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </label>

              {/* FORGOT */}

              <div className="admin-forgot-row">
                <Link to="/forgot-password">
                  Forgot password?
                </Link>
              </div>

              {/* LOGIN */}

              <button
                type="submit"
                className="admin-auth-submit"
                disabled={isSigningIn}
              >
                {isSigningIn ? (
                  <>
                    <span>
                      Signing in...
                    </span>

                    <LogIn
                      className="admin-auth-spin"
                      size={18}
                    />
                  </>
                ) : (
                  <>
                    <span>
                      Login
                    </span>

                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>

            {/* DIVIDER */}

            <div className="admin-auth-divider">
              <span />

              <p>
                New to CrayThrive?
              </p>

              <span />
            </div>

            {/* APK DOWNLOAD */}

            <a
              href={APK_DOWNLOAD_URL}
              className="admin-auth-download"
              aria-label="Download CrayThrive Android APK"
            >
              <div className="admin-download-icon">
                <Smartphone size={19} />
              </div>

              <div>
                <span>
                  Get the CrayThrive mobile app
                </span>

                <small>
                  Download the latest Android APK
                </small>
              </div>

              <ArrowRight
                className="admin-download-arrow"
                size={18}
              />
            </a>

            {/* SECURITY */}

            <div className="admin-auth-security-note">
              <ShieldCheck size={16} />

              <p>
                Account access is securely verified using
                your Supabase profile and assigned
                dashboard role.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
