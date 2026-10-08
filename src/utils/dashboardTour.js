// App-controlled targets and copy; separate from any future tutorial CMS.
export const DASHBOARD_TOUR_STEPS = [
  { id: 'overview', path: '/admin', target: 'dashboard-overview', title: 'Welcome to CrayThrive',
    text: 'The Dashboard gives you a quick overview of your tanks, monitoring conditions, alerts, and important system information.' },
  { id: 'tanks', path: '/admin/tanks', target: 'add-tank', title: 'Manage Your Tanks',
    text: 'View your Juvenile and Breeder tanks, open tank details, and create a new tank from the web dashboard.',
    detail: 'New tanks can be created before pairing a monitoring device.' },
  { id: 'monitoring', target: 'tank-monitoring', title: 'Monitor Tank Conditions',
    text: 'Open a tank to review temperature, pH, water clarity/turbidity, water level, device status, and the latest available ammonia scan.',
    detail: 'Ammonia is manually scanned and keeps its own scan date and time.' },
  { id: 'readings', path: '/admin/readings', target: 'readings-overview', title: 'Review Monitoring History',
    text: 'Sensor Readings lets you review recorded water conditions and monitoring history.',
    detail: 'Historical ammonia scans are separate events with their own dates and times.' },
  { id: 'reports', path: '/admin/reports', target: 'reports-overview', title: 'Generate Reports',
    text: 'Use Reports to review records by date or tank and export available information using CSV or Print / Save as PDF.' },
  { id: 'marketplace', path: '/admin/marketplace', target: 'marketplace-overview', title: 'Crayfish Marketplace',
    text: 'Browse listings, manage your seller profile, create products, review orders, and access marketplace-related tools.' },
  { id: 'settings', path: '/admin/settings', target: 'settings-overview', title: 'Settings & Thresholds',
    text: 'Review your profile and configure monitoring thresholds used to evaluate tank conditions.',
    detail: "You're ready to use the CrayThrive dashboard. Replay this tour anytime in Settings → Help & Learning." },
];

export const TOUR_STORAGE_KEYS = {
  seen: 'craythrive_web_tour_seen', completed: 'craythrive_web_tour_completed',
  login: 'craythrive_web_tour_login',
};

function browserStorage(kind) {
  const fallback = new Map();
  return {
    getItem(key) { try { return window[kind].getItem(key) ?? fallback.get(key) ?? null; } catch { return fallback.get(key) ?? null; } },
    setItem(key, value) { fallback.set(key, value); try { window[kind].setItem(key, value); } catch { /* Tour still works without browser storage. */ } },
    removeItem(key) { fallback.delete(key); try { window[kind].removeItem(key); } catch { /* Non-security UX state only. */ } },
  };
}

export function createTourSessionStore({ local = browserStorage('localStorage'), session = browserStorage('sessionStorage'), makeId = () => crypto.randomUUID() } = {}) {
  function readLogin() {
    try { return JSON.parse(session.getItem(TOUR_STORAGE_KEYS.login)); } catch { return null; }
  }
  const writeLogin = value => session.setItem(TOUR_STORAGE_KEYS.login, JSON.stringify(value));
  function dismiss() {
    const login = readLogin();
    if (login) writeLogin({ ...login, dismissed: true });
  }
  return {
    // Called only by the successful password-login submit handler after role verification.
    // No JWT, password or security decision is stored here.
    beginLogin(userId) {
      if (!userId) return;
      writeLogin({ userId, loginId: makeId(), kind: local.getItem(TOUR_STORAGE_KEYS.seen) === 'true' ? 'returning' : 'first', offered: false, dismissed: false });
    },
    claimInvitation(userId) {
      const login = readLogin();
      if (!userId || login?.userId !== userId || login.offered || login.dismissed) return null;
      // Claim once per explicit login, including StrictMode, reloads and remounts.
      writeLogin({ ...login, offered: true });
      local.setItem(TOUR_STORAGE_KEYS.seen, 'true');
      return { kind: login.kind, loginId: login.loginId };
    },
    dismiss,
    complete() { local.setItem(TOUR_STORAGE_KEYS.completed, 'true'); dismiss(); },
    clearLogin() { session.removeItem(TOUR_STORAGE_KEYS.login); },
  };
}

export const dashboardTourSession = createTourSessionStore();

export function tankTourPath(href) {
  return typeof href === 'string' && /^\/admin\/tanks\/[^/?#]+$/.test(href) && href !== '/admin/tanks/add' ? href : null;
}

export function tourCardPosition(target, viewport, card) {
  const gutter = 16, gap = 12;
  const width = Math.min(card.width, viewport.width - gutter * 2);
  const height = Math.min(card.height, viewport.height - gutter * 2);
  let left = (viewport.width - width) / 2, top = (viewport.height - height) / 2;
  if (target) {
    left = target.left;
    if (target.bottom + gap + height <= viewport.height - gutter) top = target.bottom + gap;
    else if (target.top - gap - height >= gutter) top = target.top - gap - height;
    else if (target.right + gap + width <= viewport.width - gutter) { left = target.right + gap; top = target.top; }
    else if (target.left - gap - width >= gutter) { left = target.left - gap - width; top = target.top; }
    else top = viewport.height - height - gutter;
  }
  return { left: Math.max(gutter, Math.min(left, viewport.width - width - gutter)),
    top: Math.max(gutter, Math.min(top, viewport.height - height - gutter)) };
}
