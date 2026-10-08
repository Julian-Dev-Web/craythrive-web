import test from 'node:test';
import assert from 'node:assert/strict';
import { createTourSessionStore, TOUR_STORAGE_KEYS, DASHBOARD_TOUR_STEPS, tankTourPath, tourCardPosition } from '../src/utils/dashboardTour.js';

function fixture() {
  const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  };
  const local = storage(), session = storage(); let id = 0;
  const store = createTourSessionStore({ local, session, makeId: () => String(++id) });
  return { store, local, session };
}

test('restored sessions do not offer tours; only an explicit login ticket introduces once', () => {
  const { store, local, session } = fixture();
  assert.equal(store.claimInvitation('farmer'), null);
  store.beginLogin('farmer');
  assert.equal(local.getItem(TOUR_STORAGE_KEYS.seen), null);
  assert.equal(store.claimInvitation('different-farmer'), null);
  assert.deepEqual(store.claimInvitation('farmer'), { kind: 'first', loginId: '1' });
  assert.equal(local.getItem(TOUR_STORAGE_KEYS.seen), 'true');
  for (let i = 0; i < 5; i++) assert.equal(store.claimInvitation('farmer'), null);
  const remounted = createTourSessionStore({ local, session });
  assert.equal(remounted.claimInvitation('farmer'), null);
});

test('dismissal/completion persist for this login; a future explicit login offers only a refresher', () => {
  const { store, local, session } = fixture();
  store.beginLogin('farmer'); store.claimInvitation('farmer'); store.dismiss();
  assert.equal(JSON.parse(session.getItem(TOUR_STORAGE_KEYS.login)).dismissed, true);
  assert.equal(store.claimInvitation('farmer'), null);
  store.complete(); assert.equal(local.getItem(TOUR_STORAGE_KEYS.completed), 'true');
  store.clearLogin(); assert.equal(session.getItem(TOUR_STORAGE_KEYS.login), null);
  store.beginLogin('farmer');
  assert.deepEqual(store.claimInvitation('farmer'), { kind: 'returning', loginId: '2' });
  // Completion is deliberately never an authorization or replay gate.
  assert.equal(local.getItem(TOUR_STORAGE_KEYS.completed), 'true');
});

test('malformed UX storage and missing identity do not introduce a tour', () => {
  const { store, session } = fixture();
  session.setItem(TOUR_STORAGE_KEYS.login, '{broken');
  assert.equal(store.claimInvitation('farmer'), null);
  session.setItem(TOUR_STORAGE_KEYS.login, 'null');
  assert.equal(store.claimInvitation('farmer'), null);
  store.beginLogin(null); assert.equal(store.claimInvitation(null), null);
});

test('tour only opens a tank route from an existing tank link and includes no unimplemented AI screen', () => {
  assert.equal(tankTourPath('/admin/tanks/my-tank'), '/admin/tanks/my-tank');
  for (const path of [null, '/admin/tanks/add', '/admin/tanks/a/edit', '/admin/tanks/a?write=true', 'https://example.com', 'javascript:alert(1)']) assert.equal(tankTourPath(path), null);
  assert.equal(DASHBOARD_TOUR_STEPS.length, 7);
  assert.ok(!DASHBOARD_TOUR_STEPS.some(step => step.id === 'ai'));
  assert.match(DASHBOARD_TOUR_STEPS[2].detail, /manually scanned/);
});

test('card placement stays within phone/desktop viewport and uses available space around the target', () => {
  for (const [width, height] of [[390, 844], [768, 1024], [1366, 768], [1440, 900]]) {
    for (const rect of [null, { left: 10, top: 30, right: width - 10, bottom: 180 }, { left: width - 80, top: height - 120, right: width - 10, bottom: height - 20 }]) {
      const position = tourCardPosition(rect, { width, height }, { width: 360, height: 320 });
      assert.ok(position.left >= 16 && position.top >= 16);
      assert.ok(position.left + Math.min(360, width - 32) <= width - 16);
      assert.ok(position.top + 320 <= height - 16);
    }
  }
  assert.equal(tourCardPosition({ left: 20, top: 20, right: 200, bottom: 100 }, { width: 390, height: 844 }, { width: 358, height: 300 }).top, 112);
});
