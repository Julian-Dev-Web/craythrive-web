import { logDiagnostic, getSafeErrorMessage } from "../utils/securityDiagnostics";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { hasDashboardAccess } from "../utils/dashboardAccess.js";
import { readDashboardProfile, readDashboardSession, signOutLocalSession } from './dashboardSession.js';
export { hasDashboardAccess } from "../utils/dashboardAccess.js";

/*
 * Roles that are allowed to access the CrayThrive web dashboard.
 *
 * IMPORTANT: this was corrected to "user" — the actual CrayThrive
 * mobile app registers accounts with profiles.role = "user" (confirmed
 * directly against the codebase), not "admin"/"super_admin". This web
 * dashboard is a per-user account dashboard, not a separate staff panel.
 * Developer Mode is independently authorized server-side against one Auth UUID;
 * dashboard roles never grant developer access.
 */
function getReadableAuthError(error) {
  if (!error) {
    return "Could not sign in. Please try again.";
  }

  const message = String(error?.message || "").toLowerCase();

  if (
    message.includes("invalid login credentials") ||
    message.includes("invalid credentials")
  ) {
    return "Incorrect email or password.";
  }

  if (message.includes("email not confirmed")) {
    return "Please verify your email address before signing in.";
  }

  if (message.includes("too many requests")) {
    return "Too many sign-in attempts. Please wait a moment and try again.";
  }

  if (message.includes("network")) {
    return "Unable to connect to the server. Please check your internet connection.";
  }

  return getSafeErrorMessage(error, "Could not sign in. Please try again.");
}

/*
 * Find the user's profile.
 *
 * Most Supabase projects use:
 * profiles.id = auth.users.id
 *
 * But this also supports:
 * profiles.user_id = auth.users.id
 */
async function fetchProfile(userId) {
  if (!userId) {
    return {
      profile: null,
      error: "User ID is missing.",
    };
  }

  return readDashboardProfile(supabase, userId);
}

/*
 * MAIN LOGIN FUNCTION
 *
 * Used by:
 * src/pages/auth/AdminLogin.jsx
 *
 * Returns:
 * {
 *   user,
 *   session,
 *   profile,
 *   error
 * }
 */
export async function signInWithDashboardAccess(email, password) {
  if (!isSupabaseConfigured || !supabase) {
    return {
      user: null,
      session: null,
      profile: null,
      error:
        "Supabase is not configured yet. Please check your environment variables.",
    };
  }

  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();

  if (!normalizedEmail || !password) {
    return {
      user: null,
      session: null,
      profile: null,
      error: "Please enter your email and password.",
    };
  }

  try {
    /*
     * Step 1:
     * Authenticate against Supabase Auth.
     */
    const {
      data,
      error: signInError,
    } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (signInError) {
      return {
        user: null,
        session: null,
        profile: null,
        error: getReadableAuthError(signInError),
      };
    }

    const user = data?.user ?? null;
    const session = data?.session ?? null;

    if (!user) {
      return {
        user: null,
        session: null,
        profile: null,
        error: "Could not retrieve your account information.",
      };
    }

    /*
     * Step 2:
     * Retrieve the CrayThrive profile.
     */
    const {
      profile,
      error: profileError,
      status: profileStatus,
    } = await fetchProfile(user.id);

    if (profileError || !profile) {
      // A network/profile outage must not revoke this or any other device session.
      if (profileStatus === 'missing') await signOutLocalSession(supabase);

      return {
        user: null,
        session: null,
        profile: null,
        error:
          profileError ||
          "Could not verify your CrayThrive profile.",
      };
    }

    /*
     * Step 3:
     * Check dashboard role.
     */
    if (!hasDashboardAccess(profile)) {
      await signOutLocalSession(supabase);

      return {
        user: null,
        session: null,
        profile: null,
        error:
          "Your account does not have permission to access the CrayThrive web dashboard.",
      };
    }

    /*
     * Successful authentication + role verification.
     */
    return {
      user,
      session,
      profile,
      error: null,
    };
  } catch (error) {
    logDiagnostic("CrayThrive login error:", error);

    return {
      user: null,
      session: null,
      profile: null,
      error:
        getSafeErrorMessage(error, "An unexpected error occurred while signing in."),
    };
  }
}

/*
 * Returns the currently authenticated Supabase user.
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  try {
    const {
      data,
      error,
    } = await supabase.auth.getUser();

    if (error) {
      logDiagnostic("Could not get current user:", error);
      return null;
    }

    return data?.user ?? null;
  } catch (error) {
    logDiagnostic("Could not get current user:", error);
    return null;
  }
}

/*
 * Returns the current Supabase session.
 */
export async function getCurrentSession() {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  try {
    const {
      data,
      error,
    } = await supabase.auth.getSession();

    if (error) {
      logDiagnostic("Could not get current session:", error);
      return null;
    }

    return data?.session ?? null;
  } catch (error) {
    logDiagnostic("Could not get current session:", error);
    return null;
  }
}

/*
 * Returns the profile belonging to the currently
 * authenticated Supabase user.
 */
export async function getCurrentProfile() {
  const user = await getCurrentUser();

  if (!user) {
    return { user: null, profile: null };
  }

  try {
    const { profile } = await fetchProfile(user.id);
    return { user, profile: profile ?? null };
  } catch (error) {
    logDiagnostic("Could not get current profile:", error);
    return { user, profile: null };
  }
}

/*
 * Used by protected dashboard routes.
 */
export async function checkDashboardAccess() {
  return (await verifyDashboardSession()).status;
}

export const verifyDashboardSession = () => readDashboardSession(supabase, hasDashboardAccess);

/*
 * Logout
 */
export async function signOut() {
  if (!isSupabaseConfigured || !supabase) {
    return {
      error: null,
    };
  }

  try {
    const { error } = await signOutLocalSession(supabase);

    if (error) {
      logDiagnostic("Sign out error:", error);

      return {
        error: "Could not sign out. Please try again.",
      };
    }

    return {
      error: null,
    };
  } catch (error) {
    logDiagnostic("Sign out error:", error);

    return {
      error:
        getSafeErrorMessage(error, "Could not sign out. Please try again."),
    };
  }
}

/*
 * Optional helper for auth listeners.
 */
export function onAuthStateChange(callback) {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  return supabase.auth.onAuthStateChange(
    (event, session) => {
      callback?.(event, session);
    }
  );
}
