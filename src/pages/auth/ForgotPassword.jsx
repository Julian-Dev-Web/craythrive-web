import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Send,
  ShieldCheck,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { checkRegisteredProfileByEmail } from "../../services/authService";

const DEFAULT_LIVE_SITE_URL = "https://www.craythrive.site";

function getSiteUrl() {
  const envSiteUrl = import.meta.env.VITE_APP_SITE_URL;
  const siteUrl = envSiteUrl || DEFAULT_LIVE_SITE_URL;

  return siteUrl.replace(/\/$/, "");
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

      const isRegistered = await checkRegisteredProfileByEmail(cleanEmail);

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
    <main className="admin-auth-page">
      <div className="admin-auth-bg-grid" />
      <div className="admin-auth-glow admin-auth-glow-one" />
      <div className="admin-auth-glow admin-auth-glow-two" />

      <Link to="/login" className="admin-auth-back">
        <ArrowLeft size={17} />
        <span>Back to Login</span>
      </Link>

      <section className="admin-auth-card">
        <div className="admin-auth-showcase">
          <div className="admin-showcase-pattern">
            <span className="pattern-ring pattern-ring-1" />
            <span className="pattern-ring pattern-ring-2" />
            <span className="pattern-ring pattern-ring-3" />
            <span className="pattern-ring pattern-ring-4" />
          </div>

          <div className="admin-showcase-content">
            <p className="admin-showcase-kicker">ACCOUNT RECOVERY</p>

            <h1>Forgot your password?</h1>

            <p className="admin-showcase-description">
              Enter your registered CrayThrive account email. We will only send
              a reset link if the email exists in your CrayThrive profile.
            </p>
          </div>

          <div className="admin-showcase-footer">
            <span>© 2026 CrayThrive</span>

            <div className="admin-showcase-status">
              <span />
              System ready
            </div>
          </div>
        </div>

        <div className="admin-auth-form-panel">
          <div className="admin-auth-form-wrap">
            <div className="admin-form-heading">
              <span className="admin-form-eyebrow">PASSWORD RESET</span>
              <h2>Reset password</h2>
              <p>Use your registered email address to receive a reset link.</p>
            </div>

            {!isSupabaseConfigured && (
              <div className="admin-auth-alert warning">
                <AlertTriangle size={18} />
                <span>Supabase env is missing or invalid.</span>
              </div>
            )}

            {errorMessage && (
              <div className="admin-auth-alert danger">
                <AlertTriangle size={18} />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="admin-auth-alert success">
                <CheckCircle2 size={18} />
                <span>{successMessage}</span>
              </div>
            )}

            <form className="admin-auth-form" onSubmit={handleResetRequest}>
              <label className="admin-auth-field">
                <span>Email address</span>

                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  disabled={isSubmitting}
                />
              </label>

              <button type="submit" className="admin-auth-submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <span>Checking email...</span>
                    <Loader2 className="admin-auth-spin" size={18} />
                  </>
                ) : (
                  <>
                    <span>Send reset link</span>
                    <Send size={18} />
                  </>
                )}
              </button>
            </form>

            <div className="admin-auth-security-note">
              <ShieldCheck size={16} />
              <p>
                Reset links open on <strong>craythrive.site/reset-password</strong>.
                Check spam if the email does not appear in your inbox.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}