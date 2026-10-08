// Shared by the browser guard and authenticated server endpoints.
export function hasDashboardAccess(profile) {
  if (!profile) return false;
  const role = String(profile.role ?? profile.user_role ?? profile.account_role ?? '')
    .trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  return role === 'user';
}
