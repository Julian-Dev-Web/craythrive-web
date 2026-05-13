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
  X,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import {
  getPasswordChecks,
  getPasswordStrength,
  isPasswordStrong,
} from "../../utils/passwordRules";

const rules = [
  { key: "hasMinLength", label: "8+ characters" },
  { key: "hasUppercase", label: "Uppercase" },
  { key: "hasLowercase", label: "Lowercase" },
  { key: "hasNumber", label: "Number" },
  { key: "hasSpecialChar", label: "Special" },
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

  const passedCount = useMemo(
    () => rules.filter((rule) => checks[rule.key]).length,
    [checks]
  );

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

      const { error } = await supabase.auth.updateUser({ password });

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
    <main className="ct-reset-page">
      <div className="ct-reset-bg-orb one" />
      <div className="ct-reset-bg-orb two" />

      <Link to="/login" className="ct-reset-back">
        <ArrowLeft size={18} />
        Back to Login
      </Link>

      <section className="ct-reset-card">
        <div className="ct-reset-illustration">
          <KeyRound size={48} />
        </div>

        <div className="ct-reset-heading">
          <h1>Reset Password</h1>
          <p>Create a strong password for your CrayThrive account.</p>
        </div>

        <form onSubmit={handleUpdatePassword} className="ct-reset-form">
          {isCheckingSession && (
            <div className="ct-reset-alert warning">
              <Loader2 className="spin-icon" size={18} />
              <span>Checking password recovery session...</span>
            </div>
          )}

          {!isCheckingSession && !canReset && (
            <div className="ct-reset-alert danger">
              <AlertTriangle size={18} />
              <span>
                Reset session not found. Please open the latest password reset
                link from your email.
              </span>
            </div>
          )}

          {errorMessage && (
            <div className="ct-reset-alert danger">
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="ct-reset-alert success">
              <CheckCircle2 size={18} />
              <span>{successMessage}</span>
            </div>
          )}

          <label className="ct-reset-field">
            <span>New password</span>

            <div className="ct-reset-input">
              <LockKeyhole size={18} />

              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter new password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />

              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <div className="ct-strength">
            <div className="ct-strength-top">
              <span>Password strength</span>
              <strong className={`score-${strength.label.toLowerCase()}`}>
                {strength.label}
              </strong>
            </div>

            <div className="ct-strength-bars">
              {rules.map((rule, index) => {
                const passed = checks[rule.key];

                return (
                  <div
                    key={rule.key}
                    className={`ct-strength-segment ${passed ? "passed" : ""}`}
                  >
                    <i />
                    <span>{rule.label}</span>
                    <b>{passed ? <Check size={13} /> : index + 1}</b>
                  </div>
                );
              })}
            </div>

            <p className="ct-strength-helper">
              {passedCount === rules.length
                ? "All requirements completed."
                : `${passedCount} of ${rules.length} requirements completed.`}
            </p>
          </div>

          <label className="ct-reset-field">
            <span>Re-enter password</span>

            <div className="ct-reset-input">
              <LockKeyhole size={18} />

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
            <div className={`ct-match ${passwordsMatch ? "matched" : ""}`}>
              {passwordsMatch ? <Check size={16} /> : <X size={16} />}
              <span>{passwordsMatch ? "Passwords match" : "Passwords do not match"}</span>
            </div>
          )}

          <button
            className="ct-reset-submit"
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

        <p className="ct-reset-footer">© 2026 CrayThrive. All rights reserved.</p>
      </section>
    </main>
  );
}