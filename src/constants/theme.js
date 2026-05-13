export const COLORS = {
  background: "#f6f5ed",
  backgroundSoft: "#eef5f1",
  surface: "#ffffff",
  surfaceSoft: "#f7fbf8",
  teal: "#0f8f7f",
  tealDark: "#0b5f58",
  tealLight: "#5fc7b4",
  cyan: "#22b8cf",
  green: "#4fa979",
  yellow: "#facc15",
  orange: "#fb923c",
  red: "#ef4444",
  text: "#333333",
  textMuted: "#6b7280",
  border: "rgba(15, 95, 88, 0.16)",
  cardShadow: "0 24px 70px rgba(35, 53, 48, 0.12)",
};

export const STATUS_COLORS = {
  active: COLORS.green,
  pending: COLORS.yellow,
  confirmed: COLORS.cyan,
  completed: COLORS.green,
  cancelled: COLORS.red,
  hidden: COLORS.textMuted,
  sold: COLORS.tealLight,
  reserved: COLORS.orange,
  deleted: COLORS.red,
  resolved: COLORS.green,
  warning: COLORS.yellow,
  critical: COLORS.red,
  info: COLORS.cyan,
};

export const APP_INFO = {
  name: "CrayThrive",
  subtitle: "Smart Crayfish Tank Monitoring Dashboard",
  domain: "craythrive.site",
  logoPath: "/craythrive-logo.png",
};