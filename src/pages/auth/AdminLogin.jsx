import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  Mail,
} from "lucide-react";
import { APP_INFO } from "../../constants/theme";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

async function getProfileByUser(user) {
  if (!user) return null;

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
      .eq("email", user.email)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) {
      return byEmail.data;
    }
  }

  return null;
}

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

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet. Please check your .env file.");
      return;
    }

    if (!email.trim() || !password.trim()) {
      setErrorMessage("Please enter your email and password.");
      return;
    }

    try {
      setIsSigningIn(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      const profile = await getProfileByUser(data.user);

      if (!profile) {
        await supabase.auth.signOut();
        setErrorMessage("Profile not found. Please check your CrayThrive account.");
        return;
      }

      const role = String(profile.role || "").toLowerCase();

      if (role !== "user") {
        await supabase.auth.signOut();
        setErrorMessage("Access denied. This account does not have dashboard access.");
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
        <form className="login-polished-card" onSubmit={handleLogin}>
          <div className="login-form-header">
            <span className="login-form-icon">
              <LockKeyhole size={24} />
            </span>

            <div>
              <h2>Sign In</h2>
              <p>Use your CrayThrive account to continue.</p>
            </div>
          </div>

          {errorMessage && (
            <div className="form-alert danger">
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          <label className="input-group">
            <span>Email Address</span>

            <div className="input-shell">
              <Mail size={19} />
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
            </div>
          </label>

          <label className="input-group">
            <span>Password</span>

            <div className="input-shell">
              <LockKeyhole size={19} />
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
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
          </label>

          <div className="auth-helper-row">
            <Link to="/forgot-password">Forgot password?</Link>
          </div>

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

          <p className="login-note">
            Account access is verified using your Supabase profile role.
          </p>
        </form>
      </section>
    </main>
  );
}