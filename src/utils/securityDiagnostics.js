// Keep provider details, request bodies, sessions and tokens out of console output.
export function logDiagnostic(label, ...details) {
  const error = details.find(detail => detail && typeof detail === "object" && (detail.code || detail.status));
  const code = String(error?.code || "");
  const status = Number(error?.status);
  console.warn(label, {
    ...(/^[A-Za-z0-9_-]{1,40}$/.test(code) ? { code } : {}),
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
  });
}

export function getSafeErrorMessage(error, fallback) {
  if (error?.status === 429) return "Too many requests. Please wait before trying again.";
  if (["42501", "PGRST301"].includes(error?.code) || [401, 403].includes(error?.status)) {
    return "You do not have permission for this action. Please sign in again or contact support.";
  }
  return fallback;
}
