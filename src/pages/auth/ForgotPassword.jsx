import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";

const DEFAULT_LIVE_SITE_URL = "https://www.craythrive.site";

function getSiteUrl() {
  const envSiteUrl = import.meta.env.VITE_APP_SITE_URL;
  const siteUrl = envSiteUrl || DEFAULT_LIVE_SITE_URL;

  return siteUrl.replace(/\/$/, "");
}

async function checkRegisteredProfile(email) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new Error("Could not verify this email. Please try again.");
  }

  return Boolean(data);
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const resetRedirectUrl = useMemo(() => {
    return `${getSiteUrl()}/reset-password`;
  }, []);

  const handleResetRequest = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet. Please check your .env file.");
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setErrorMessage("Please enter your registered email address.");
      return;
    }

    try {
      setIsSubmitting(true);

      const isRegistered = await checkRegisteredProfile(cleanEmail);

      if (!isRegistered) {
        setErrorMessage(
          "This email is not registered in CrayThrive. Please use the email you used in the mobile app."
        );
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: resetRedirectUrl,
      });

      if (error) {
        throw new Error(error.message);
      }

      setSuccessMessage(
        "Password reset link sent. Please check your inbox or spam folder, then open the reset link."
      );
    } catch (error) {
      setErrorMessage(error.message || "Could not send reset email. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-polished-page">
      <div className="login-polished-bg" />
      <div className="login-polished-orb login-polished-orb-one" />
      <div className="login-polished-orb login-polished-orb-two" />

      <section className="login-polished-left">
        <Link to="/login" className="login-back-link">
          <ArrowLeft size={18} />
          Back to Login
        </Link>

        <div className="login-brand-hero">
          <h1>Forgot Password?</h1>
          <p>
            Enter your registered CrayThrive account email. We will only send a
            reset link if the email exists in your CrayThrive profile.
          </p>
        </div>

        <p className="login-copyright">
          © 2026 CrayThrive. All rights reserved.
        </p>
      </section>

      <section className="login-polished-right">
        <form className="login-polished-card" onSubmit={handleResetRequest}>
          <div className="login-form-header">
            <span className="login-form-icon">
              <Mail size={24} />
            </span>

            <div>
              <h2>Reset Password</h2>
              <p>Use your registered email address.</p>
            </div>
          </div>

          {!isSupabaseConfigured && (
            <div className="form-alert warning">
              <AlertTriangle size={18} />
              <span>Supabase env is missing or invalid.</span>
            </div>
          )}

          {errorMessage && (
            <div className="form-alert danger">
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="form-alert success">
              <CheckCircle2 size={18} />
              <span>{successMessage}</span>
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

          <button className="login-submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                Checking email...
                <Loader2 className="spin-icon" size={18} />
              </>
            ) : (
              <>
                Send Reset Link
                <Send size={18} />
              </>
            )}
          </button>

          <p className="login-note">
            Reset links will open on{" "}
            <strong>craythrive.site/reset-password</strong>. Check spam if the
            email does not appear in your inbox.
          </p>
        </form>
      </section>
    </main>
  );
}