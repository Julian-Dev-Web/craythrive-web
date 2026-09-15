import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Eye, EyeOff, LogIn } from "lucide-react";
import { APP_INFO } from "../../constants/theme";
import { isSupabaseConfigured } from "../../lib/supabase";
import { signInWithDashboardAccess } from "../../services/authService";

const APK_DOWNLOAD_URL = "/downloads/craythrive.apk";

export default function AdminLogin() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleLogin = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    if (!isSupabaseConfigured) {
      setErrorMessage("Supabase is not configured yet. Please check your .env file.");
      return;
    }

    if (!email.trim() || !password.trim()) {
      setErrorMessage("Please enter your email and password.");
      return;
    }

    try {
      setIsSigningIn(true);

      const { profile, error } = await signInWithDashboardAccess(email, password);

      if (error) {
        setErrorMessage(error);
        return;
      }

      if (!profile) {
        setErrorMessage("Could not sign in. Please try again.");
        return;
      }

      navigate("/admin", { replace: true });
    } catch (error) {
      setErrorMessage(error.message || "Could not sign in. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <main className="login-polished-page">
      <div className="login-polished-bg" />
      <div className="login-polished-orb login-polished-orb-one" />
      <div className="login-polished-orb login-polished-orb-two" />

      <section className="login-polished-left">
        <Link to="/" className="login-back-link">
          <ArrowLeft size={18} />
          Back to Home
        </Link>

        <div className="login-brand-hero">
          <div
            className="admin-login-logo-shell"
            role="img"
            aria-label={`${APP_INFO.name} logo`}
            style={{
              backgroundImage: `url(${APP_INFO.logoPath})`,
            }}
          />

          <h1>CrayThrive Login</h1>
          <p>Sign in using your registered CrayThrive account.</p>
        </div>

        <p className="login-copyright">© 2026 CrayThrive. All rights reserved.</p>
      </section>

      <section className="login-polished-right">
        <form className="login-simple-card" onSubmit={handleLogin}>
          <span className="login-simple-brand">{APP_INFO.name}</span>

          <div className="login-simple-header">
            <h2>Sign In</h2>
            <p>
              Need an account?{" "}
              <a href={APK_DOWNLOAD_URL} download>
                Download the mobile app
              </a>{" "}
              — it's free.
            </p>
          </div>

          {errorMessage && (
            <div className="form-alert danger">
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          <label className="input-simple-group">
            <span>Email Address</span>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>

          <label className="input-simple-group">
            <span>Password</span>
            <div className="input-simple-shell">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <button className="login-submit" disabled={isSigningIn}>
            {isSigningIn ? (
              <>
                Signing in...
                <LogIn className="spin-icon" size={18} />
              </>
            ) : (
              <>
                Sign In
                <ArrowRight size={18} />
              </>
            )}
          </button>

          <div className="login-simple-footer">
            <span>Account access is verified using your Supabase profile role.</span>
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
        </form>
      </section>
    </main>
  );
}