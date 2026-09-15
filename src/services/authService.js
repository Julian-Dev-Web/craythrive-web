import { supabase, isSupabaseConfigured } from "../lib/supabase";

/*
 * Roles that are allowed to access the CrayThrive web dashboard.
 *
 * IMPORTANT: this was corrected to "user" — the actual CrayThrive
 * mobile app registers accounts with profiles.role = "user" (confirmed
 * directly against the codebase), not "admin"/"super_admin". This web
 * dashboard is a per-user account dashboard, not a separate staff panel.
 * If you later introduce a real staff/admin role, add it here alongside
 * "user" rather than replacing it.
 */
const DASHBOARD_ROLES = new Set([
  "user",
]);

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function getReadableAuthError(error) {
  if (!error) {
    return "Could not sign in. Please try again.";
  }

  const message = String(error.message || "").toLowerCase();

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

  return error.message || "Could not sign in. Please try again.";
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

  // First try profiles.id
  const {
    data: profileById,
    error: profileByIdError,
  } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (!profileByIdError && profileById) {
    return {
      profile: profileById,
      error: null,
    };
  }

  // Fallback for projects using profiles.user_id
  const {
    data: profileByUserId,
    error: profileByUserIdError,
  } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profileByUserIdError && profileByUserId) {
    return {
      profile: profileByUserId,
      error: null,
    };
  }

  /*
   * Return the useful Supabase error only if both attempts failed.
   * If neither query produced an error but there was simply no row,
   * return our own message.
   */
  if (profileByIdError && profileByUserIdError) {
    console.error("Could not load user profile:", {
      profileByIdError,
      profileByUserIdError,
    });
  }

  return {
    profile: null,
    error:
      "Your CrayThrive account does not have a profile record yet.",
  };
}

/*
 * Checks whether the profile is permitted to open the web dashboard.
 */
export function hasDashboardAccess(profile) {
  if (!profile) {
    return false;
  }

  const role = normalizeRole(
    profile.role ??
      profile.user_role ??
      profile.account_role
  );

  return DASHBOARD_ROLES.has(role);
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
    } = await fetchProfile(user.id);

    if (profileError || !profile) {
      // Do not leave an authenticated session hanging
      // when dashboard access cannot be verified.
      await supabase.auth.signOut();

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
      await supabase.auth.signOut();

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
    console.error("CrayThrive login error:", error);

    return {
      user: null,
      session: null,
      profile: null,
      error:
        error?.message ||
        "An unexpected error occurred while signing in.",
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
      console.error("Could not get current user:", error);
      return null;
    }

    return data?.user ?? null;
  } catch (error) {
    console.error("Could not get current user:", error);
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
      console.error("Could not get current session:", error);
      return null;
    }

    return data?.session ?? null;
  } catch (error) {
    console.error("Could not get current session:", error);
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
    console.error("Could not get current profile:", error);
    return { user, profile: null };
  }
}

/*
 * Used by protected dashboard routes.
 */
export async function checkDashboardAccess() {
  if (!isSupabaseConfigured || !supabase) {
    return "not-configured";
  }

  const user = await getCurrentUser();

  if (!user) {
    return "unauthenticated";
  }

  const { profile } = await fetchProfile(user.id);

  if (!hasDashboardAccess(profile)) {
    await signOut();
    return "unauthenticated";
  }

  return "authorized";
}

/* Used by ForgotPassword.jsx to confirm an email belongs to a real account. */
export async function checkRegisteredProfileByEmail(email) {
  if (!supabase) return false;

  const cleanEmail = String(email || "").trim().toLowerCase();

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email")
    .ilike("email", cleanEmail)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Could not verify this email. Please try again.");
  }

  return Boolean(data);
}

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
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Sign out error:", error);

      return {
        error: error.message,
      };
    }

    return {
      error: null,
    };
  } catch (error) {
    console.error("Sign out error:", error);

    return {
      error:
        error?.message ||
        "Could not sign out. Please try again.",
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