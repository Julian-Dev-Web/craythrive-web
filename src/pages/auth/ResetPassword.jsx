import { getSafeErrorMessage } from "../../utils/securityDiagnostics";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Save,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  getPasswordChecks,
  getPasswordStrength,
  isPasswordStrong,
} from "../../utils/passwordRules";

const passwordRules = [
  { key: "hasMinLength", label: "8+ characters" },
  { key: "hasUppercase", label: "Uppercase" },
  { key: "hasLowercase", label: "Lowercase" },
  { key: "hasNumber", label: "Number" },
  { key: "hasSpecialChar", label: "Special" },
];

async function isSameAsCurrentPassword(newPassword) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email;

  if (!email) return false;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: newPassword,
  });

  return !error;
}

export default function ResetPassword() {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [canReset, setCanReset] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const checks = useMemo(() => getPasswordChecks(password), [password]);
  const strength = useMemo(() => getPasswordStrength(password), [password]);

  const passedCount = useMemo(() => {
    return passwordRules.filter((rule) => checks[rule.key]).length;
  }, [checks]);

  const passwordsMatch =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  useEffect(() => {
    let isMounted = true;

    const checkRecoverySession = async () => {
      if (!isSupabaseConfigured || !supabase) {
        if (isMounted) setIsCheckingSession(false);
        return;
      }

      try {
        const { data, error } = await supabase.auth.getUser();
        if (!error && data?.user && isMounted) setCanReset(true);
      } catch {
        if (isMounted) setCanReset(false);
      } finally {
        if (isMounted) setIsCheckingSession(false);
      }
    };

    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && isMounted) {
        setCanReset(true);
        setIsCheckingSession(false);
      }
      if (event === "SIGNED_OUT" && isMounted) setCanReset(false);
    }).data.subscription;

    checkRecoverySession();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const handleUpdatePassword = async (event) => {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage("Supabase is not configured yet. Please check your .env file.");
      return;
    }

    if (!password || !confirmPassword) {
      setErrorMessage("Please enter and confirm your new password.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (!isPasswordStrong(password)) {
      setErrorMessage(
        "Password must have at least 8 characters, uppercase, lowercase, number, and special character."
      );
      return;
    }

    try {
      setIsSubmitting(true);

      const sameAsCurrentPassword = await isSameAsCurrentPassword(password);

      if (sameAsCurrentPassword) {
        setErrorMessage("New password cannot be the same as your current password.");
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      setSuccessMessage("Password updated successfully. Redirecting to login...");
      await supabase.auth.signOut({ scope: 'local' });

      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 1200);
    } catch (error) {
      setErrorMessage(getSafeErrorMessage(error, "Could not update password. Please try again."));
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

            <h1>Create new password</h1>

            <p className="admin-showcase-description">
              Set a stronger password for your CrayThrive account. Complete
              all password requirements before updating.
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
          <div className="admin-auth-form-wrap admin-reset-form-wrap">
            <div className="admin-form-heading">
              <span className="admin-form-eyebrow">NEW PASSWORD</span>
              <h2>Set new password</h2>
              <p>Follow the password validation steps below.</p>
            </div>

            {isCheckingSession && (
              <div className="admin-auth-alert warning">
                <Loader2 className="admin-auth-spin" size={18} />
                <span>Checking password recovery session...</span>
              </div>
            )}

            {!isCheckingSession && !canReset && (
              <div className="admin-auth-alert danger">
                <AlertTriangle size={18} />
                <span>
                  Reset session not found. Please open the latest password
                  reset link from your email again.
                </span>
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

            <form className="admin-auth-form" onSubmit={handleUpdatePassword}>
              <label className="admin-auth-field">
                <span>New password</span>

                <div className="admin-password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter new password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                  />

                  <button
                    type="button"
                    className="admin-password-toggle"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>

              <div className="admin-rule-meter">
                <div className="admin-rule-meter-top">
                  <div>
                    <span>Password strength</span>
                    <strong style={{ color: strength.color }}>{strength.label}</strong>
                  </div>

                  <b>{passedCount}/5</b>
                </div>

                <div className="admin-rule-line-area">
                  <div className="admin-rule-base-line" />
                  <div
                    className="admin-rule-fill-line"
                    style={{ width: `${(passedCount / passwordRules.length) * 100}%` }}
                  />
                </div>

                <div className="admin-rule-steps">
                  {passwordRules.map((rule) => {
                    const passed = checks[rule.key];

                    return (
                      <div className={`admin-rule-step ${passed ? "is-passed" : ""}`} key={rule.key}>
                        <span className="admin-rule-circle">
                          {passed ? <Check size={12} /> : null}
                        </span>
                        <small>{rule.label}</small>
                      </div>
                    );
                  })}
                </div>
              </div>

              <label className="admin-auth-field">
                <span>Confirm password</span>

                <div className="admin-password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </label>

              {confirmPassword.length > 0 && (
                <div className={`admin-password-match ${passwordsMatch ? "matched" : ""}`}>
                  {passwordsMatch ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  <span>{passwordsMatch ? "Passwords match" : "Passwords do not match"}</span>
                </div>
              )}

              <button
                type="submit"
                className="admin-auth-submit"
                disabled={isSubmitting || isCheckingSession || !canReset}
              >
                {isSubmitting ? (
                  <>
                    <span>Updating password...</span>
                    <Loader2 className="admin-auth-spin" size={18} />
                  </>
                ) : (
                  <>
                    <span>Update password</span>
                    <Save size={18} />
                  </>
                )}
              </button>
            </form>

            <div className="admin-auth-security-note">
              <ShieldCheck size={16} />
              <p>Your session is verified through the Supabase password recovery link.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
