import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Save,
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
  { key: "hasSpecialChar", label: "Special char" },
];

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

  const progressPercent = `${(passedCount / passwordRules.length) * 100}%`;

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

      const { data } = await supabase.auth.getSession();

      if (data?.session?.user && isMounted) {
        setCanReset(true);
      }

      if (isMounted) setIsCheckingSession(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setCanReset(true);
        setIsCheckingSession(false);
      }
    });

    checkRecoverySession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
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

      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw new Error(error.message);
      }

      setSuccessMessage("Password updated successfully. Redirecting to login...");
      await supabase.auth.signOut();

      setTimeout(() => {
        navigate("/login", { replace: true });
      }, 1200);
    } catch (error) {
      setErrorMessage(error.message || "Could not update password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-polished-page reset-password-page">
      <div className="login-polished-bg" />
      <div className="login-polished-orb login-polished-orb-one" />
      <div className="login-polished-orb login-polished-orb-two" />

      <section className="login-polished-left">
        <Link to="/login" className="login-back-link">
          <ArrowLeft size={18} />
          Back to Login
        </Link>

        <div className="login-brand-hero">
          <h1>Create New Password</h1>
          <p>
            Set a stronger password for your CrayThrive account. Complete all
            password requirements before updating.
          </p>
        </div>

        <p className="login-copyright">© 2026 CrayThrive. All rights reserved.</p>
      </section>

      <section className="login-polished-right">
        <form
          className="login-polished-card reset-password-card"
          onSubmit={handleUpdatePassword}
        >
          <div className="login-form-header">
            <span className="login-form-icon">
              <KeyRound size={24} />
            </span>

            <div>
              <h2>New Password</h2>
              <p>Follow the password validation steps below.</p>
            </div>
          </div>

          {isCheckingSession && (
            <div className="form-alert warning">
              <Loader2 className="spin-icon" size={18} />
              <span>Checking password recovery session...</span>
            </div>
          )}

          {!isCheckingSession && !canReset && (
            <div className="form-alert danger">
              <AlertTriangle size={18} />
              <span>
                Reset session not found. Please open the latest password reset
                link from your email again.
              </span>
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
            <span>New Password</span>

            <div className="input-shell">
              <LockKeyhole size={19} />

              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter new password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
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

          <div className="reset-rule-meter">
            <div className="reset-rule-meter-top">
              <div>
                <span>Password Strength</span>
                <strong style={{ color: strength.color }}>{strength.label}</strong>
              </div>

              <b>{passedCount}/5</b>
            </div>

            <div className="reset-rule-line-area">
              <div className="reset-rule-base-line" />
              <div
                className="reset-rule-fill-line"
                style={{ width: progressPercent }}
              />

              <div className="reset-rule-steps">
                {passwordRules.map((rule, index) => {
                  const passed = checks[rule.key];

                  return (
                    <div
                      className={`reset-rule-step ${passed ? "is-passed" : ""}`}
                      key={rule.key}
                    >
                      <span className="reset-rule-circle">
                        {passed ? <Check size={14} /> : index + 1}
                      </span>

                      <small>{rule.label}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <label className="input-group">
            <span>Confirm Password</span>

            <div className="input-shell">
              <LockKeyhole size={19} />

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
            <div className={`password-match-note ${passwordsMatch ? "matched" : ""}`}>
              {passwordsMatch ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
              <span>{passwordsMatch ? "Passwords match" : "Passwords do not match"}</span>
            </div>
          )}

          <button
            className="login-submit"
            disabled={isSubmitting || isCheckingSession || !canReset}
          >
            {isSubmitting ? (
              <>
                Updating password...
                <Loader2 className="spin-icon" size={18} />
              </>
            ) : (
              <>
                Update Password
                <Save size={18} />
              </>
            )}
          </button>
        </form>
      </section>
    </main>
  );
}