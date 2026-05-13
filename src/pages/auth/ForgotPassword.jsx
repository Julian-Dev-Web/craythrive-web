import { useState } from "react";
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

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleResetRequest = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet. Please check your .env file.");
      return;
    }

    if (!email.trim()) {
      setErrorMessage("Please enter your registered email address.");
      return;
    }

    try {
      setIsSubmitting(true);

      const redirectTo = `${window.location.origin}/reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (error) {
        throw new Error(error.message);
      }

      setSuccessMessage(
        "Password reset link sent. Please check your email and open the reset link."
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
            Enter your CrayThrive account email. We will send a secure password
            reset link to your inbox.
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
                Sending reset link...
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
            Open the email link, then create a new password on the reset page.
          </p>
        </form>
      </section>
    </main>
  );
}