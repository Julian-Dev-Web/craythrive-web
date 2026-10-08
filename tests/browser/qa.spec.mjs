import { test, expect } from './fixtures.mjs';
import fs from 'node:fs/promises';
const image = { name: 'qa.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBf8AAAAASUVORK5CYII=', 'base64') };

async function open(page, route) {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}
async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const routes = ['/', '/login', '/forgot-password', '/reset-password', '/admin', '/admin/tanks', '/admin/tanks/tank-a', '/admin/readings', '/admin/reports', '/admin/marketplace', '/admin/marketplace/sell', '/admin/marketplace/listing-a', '/admin/marketplace/listing-a/edit', '/admin/marketplace/seller-profile', '/admin/orders', '/admin/settings', '/admin/alerts'];
for (const route of routes) {
  test(`route loads and direct refresh works: ${route}`, async ({ page, qa }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1,h2').first()).toBeVisible();
    if (route.startsWith('/admin')) {
      await expect(page.locator('.modern-admin-content')).toBeVisible();
      await expect(page.locator('.modern-admin-content')).not.toContainText('Checking dashboard access');
      await expect(page).toHaveURL(new RegExp(route.replaceAll('/', '\\/') + '$'));
    }
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1,h2').first()).toBeVisible();
    expect(qa.writes).toEqual([]);
  });
}

test('invalid route, alias, browser Back and Forward', async ({ page, qa }) => {
  await page.goto('/not-a-route'); await expect(page).toHaveURL('/');
  await page.goto('/admin/login'); await expect(page).toHaveURL('/login');
  await page.goto('/admin/tanks'); await expect(page.locator('.modern-admin-content')).toBeVisible();
  await page.goto('/admin/readings'); await expect(page.locator('.modern-admin-content')).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL('/admin/tanks');
  await page.goForward(); await expect(page).toHaveURL('/admin/readings');
  expect(qa.writes).toEqual([]);
});

test('tank monitoring has no Add/Edit forms or setup requests and old form links redirect', async ({ page, qa }) => {
  const setupRequests = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/tank-schema') setupRequests.push(request.url()); });
  await page.goto('/admin/tanks');
  await expect(page.getByText('Tank A', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add Tank', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.goto('/admin/tanks/tank-a');
  await expect(page.getByRole('heading', { name: 'Tank A', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit Tank', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Tank Planning Guide' })).toHaveCount(0);
  await expect(page.locator('.modern-tank-detail-hero-card')).toContainText('Critical');
  for (const route of ['/admin/tanks/add', '/admin/tanks/tank-a/edit']) {
    await page.goto(route); await expect(page).toHaveURL('/admin/tanks');
    await expect(page.getByText('Tank A', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('form', { name: /add tank|edit tank/i })).toHaveCount(0);
  }
  expect(setupRequests).toEqual([]); expect(qa.writes).toEqual([]);
});

test('protected routes reject absent and expired sessions', async ({ page, qa, context }) => {
  qa.authenticated = false;
  await context.addInitScript(() => localStorage.removeItem('sb-qa-auth-token'));
  for (const route of routes.filter(route => route.startsWith('/admin') && route !== '/admin/login')) {
    await page.goto(route); await expect(page).toHaveURL('/login');
  }
});

test('expired persisted session redirects to login', async ({ page, qa }) => {
  qa.expired = true;
  await page.goto('/admin/tanks'); await expect(page).toHaveURL('/login');
});

test('tank safety uses current thresholds and changes after refresh', async ({ page, qa }) => {
  await page.goto('/admin/tanks');
  await expect(page.getByText('Tank A', { exact: true }).first()).toBeVisible();
  const card = page.locator('.modern-tank-card').filter({ hasText: 'Tank A' });
  await expect(card).toContainText('0.6 cm');
  await expect(card).toContainText('Critical');
  qa.data.threshold_settings[0].thresholds.waterLevelMin = 0.5;
  qa.data.threshold_settings[0].thresholds.phMin = 4.5;
  await page.reload();
  await expect(card).toContainText('Normal');
  await expect(card).not.toContainText('Critical');
  expect(qa.writes).toEqual([]);
});

test('empty tanks and missing readings are neutral', async ({ page, qa }) => {
  qa.data.tanks = []; qa.data.sensor_readings = []; qa.data.ammonia_readings = [];
  await page.goto('/admin/tanks');
  await expect(page.locator('.modern-admin-content')).toContainText(/No tanks/i);
});

test('dashboard current health ignores an old unsafe water reading', async ({ page, qa }) => {
  qa.data.tanks = [qa.data.tanks[1]];
  const current = qa.data.sensor_readings[1];
  qa.data.sensor_readings = [current, { ...current, id: 'old-unsafe', water_depth_cm: 0.6, created_at: new Date(Date.now() - 86400000).toISOString() }];
  qa.data.ammonia_readings = [{ ...qa.data.ammonia_readings[1], ammonia: 0.1 }];
  await open(page, '/admin');
  await expect(page.locator('.farmer-status-content h2')).toHaveText('Normal');
});

test('settings invalid saved thresholds use the same fallback as monitoring', async ({ page, qa }) => {
  qa.data.threshold_settings[0].thresholds.temperatureMin = '';
  qa.data.threshold_settings[0].thresholds.phMin = false;
  await open(page, '/admin/settings');
  await expect(page.getByLabel('Minimum Temperature value')).toHaveValue('20');
  await expect(page.getByLabel('Minimum pH value')).toHaveValue('6.5');
});

test('threshold save re-evaluates existing readings across monitoring pages', async ({ page, qa }) => {
  await open(page, '/admin/settings');
  await page.getByLabel('Minimum Water Level value').fill('0.5');
  await page.getByLabel('Minimum pH value').fill('4.5');
  await page.getByLabel('Maximum Ammonia value').fill('0.7');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).first().click();
  await expect.poll(() => qa.writes.filter(row => row.table === 'threshold_settings').length).toBe(1);
  for (const [route, status] of [['/admin', '.farmer-status-content h2'], ['/admin/tanks/tank-a', '.modern-tank-detail-metric-grid'], ['/admin/readings', '.modern-reading-metric-grid'], ['/admin/reports', '.cray-report-metric-grid']]) {
    await open(page, route);
    if (route === '/admin') await expect(page.locator(status)).toHaveText('Normal');
    else await expect(page.locator(status)).not.toContainText('Critical');
    await expect(page.locator('.modern-admin-content')).not.toContainText('below the configured minimum');
  }
});

for (const route of ['/admin/marketplace/sell', '/admin/marketplace/listing-a/edit']) {
  test(`image preview is released on SPA navigation: ${route}`, async ({ page, qa, context }) => {
    await context.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      window.__qaCreatedUrls = []; window.__qaRevokedUrls = [];
      URL.createObjectURL = blob => { const url = create(blob); window.__qaCreatedUrls.push(url); return url; };
      URL.revokeObjectURL = url => { window.__qaRevokedUrls.push(url); revoke(url); };
    });
    await open(page, route);
    await page.locator('input[type=file]').first().setInputFiles(image);
    await expect(page.locator('img[src^="blob:"]')).toBeVisible();
    const created = await page.evaluate(() => window.__qaCreatedUrls.at(-1));
    await page.locator('a[href="/admin/marketplace"]').first().click();
    await expect(page).toHaveURL('/admin/marketplace');
    expect(await page.evaluate(() => window.__qaRevokedUrls)).toContain(created);
    expect(qa.writes).toEqual([]);
  });
}

test('valid/invalid/empty login, repeated submit protection, persisted session and logout', async ({ page, qa }) => {
  await open(page, '/login');
  const submit = page.getByRole('button', { name: 'Login', exact: true });
  await submit.click();
  await expect(page.getByText('Please enter your email and password.')).toBeVisible();
  expect(qa.authRequests.filter(path => path.endsWith('/token'))).toHaveLength(0);
  await page.getByPlaceholder('name@example.com').fill('farmer@example.invalid');
  await page.getByPlaceholder('Enter your password').fill('qa-password-never-a-real-password');
  qa.invalidLogin = true;
  await submit.click();
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  qa.invalidLogin = false; qa.authDelay = 600;
  await submit.click();
  await expect(page.getByRole('button', { name: /Signing in/ })).toBeDisabled();
  await expect(page).toHaveURL('/admin');
  await page.reload();
  await expect(page.locator('.modern-admin-content')).toBeVisible();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/admin'); await expect(page).toHaveURL('/login');
  expect(qa.errors.join(' ')).not.toContain('qa-password-never-a-real-password');
});

test('forgot password validates empty input and submits generic recovery response', async ({ page, qa }) => {
  await open(page, '/forgot-password');
  await page.getByRole('button', { name: /send.*(link|email)/i }).click();
  expect(qa.authRequests.filter(path => path.endsWith('/recover'))).toHaveLength(0);
  await page.locator('input[type=email]').fill('farmer@example.invalid');
  await page.getByRole('button', { name: /send.*(link|email)/i }).click();
  await expect(page.getByText(/^If an account exists for this email/)).toBeVisible();
  expect(qa.authRequests.filter(path => path.endsWith('/recover'))).toHaveLength(1);
});

test('Tank Details agrees with Tanks for water, pH, temperature and ammonia', async ({ page, qa }) => {
  await open(page, '/admin/tanks/tank-a');
  for (const [name, value, severity] of [['Water Level', '0.6 cm', 'Critical'], ['pH Level', '4.8', 'Critical'], ['Temperature', '26.3', 'Normal'], ['Ammonia', '0.1 mg/L', 'Normal']]) {
    const metric = page.locator('.modern-tank-detail-metric').filter({ hasText: name });
    await expect(metric).toContainText(value);
    await expect(metric.locator('.safety-status')).toHaveText(severity);
    await expect(metric.locator('.safety-status svg')).toBeVisible();
  }
  await open(page, '/admin/tanks');
  const tank = page.locator('.modern-tank-card').filter({ hasText: 'Tank A' });
  await expect(tank.locator('.modern-tank-sensor-card').filter({ hasText: 'pH Level' })).toContainText('4.8');
  await expect(tank.locator('.modern-tank-safety-chip')).toContainText('2 parameter(s)');
  const unpaired = page.locator('.modern-tank-card').filter({ hasText: 'Unpaired Tank' });
  await expect(unpaired.locator('.modern-tank-card-top .safety-status')).toHaveText('No Data');
  expect(qa.writes).toEqual([]);
});

test('readings sensor/severity/tank filters and refresh preserve independent ammonia history', async ({ page, qa }) => {
  await open(page, '/admin/readings');
  const rows = page.locator('.modern-reading-table-body .modern-reading-table-row');
  await expect(rows).toHaveCount(4);
  for (const parameter of ['Temperature', 'pH Level', 'Water Clarity', 'Water Level']) {
    await choose(page, 'Filter readings by water parameter', parameter);
    await expect(rows).toHaveCount(2);
  }
  await choose(page, 'Filter readings by condition', 'Normal');
  await expect(rows).toHaveCount(1);
  await choose(page, 'Filter readings by condition', 'Critical');
  await expect(rows).toHaveCount(1);
  await choose(page, 'Filter readings by condition', 'Warning');
  await expect(page.getByText('No readings found')).toBeVisible();
  await choose(page, 'Filter readings by condition', 'All Conditions');
  await choose(page, 'Filter readings by water parameter', 'Ammonia');
  await expect(rows).toHaveCount(2);
  await choose(page, 'Filter readings by tank', 'Tank A');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('0.10 mg/L');
  await expect(page.locator('.modern-reading-metric').filter({ hasText: 'Ammonia' })).toContainText('Normal');
  qa.data.ammonia_readings = [];
  await page.getByRole('button', { name: /refresh/i }).first().click();
  await expect(page.locator('.modern-reading-metric').filter({ hasText: 'Ammonia' })).toContainText('No Scan');
  expect(qa.writes).toEqual([]);
});

test('readings pagination retains filters', async ({ page, qa }) => {
  qa.data.sensor_readings = Array.from({ length: 30 }, (_, index) => ({ ...qa.data.sensor_readings[0], id: `water-${index}` }));
  qa.data.ammonia_readings = [];
  await open(page, '/admin/readings');
  await page.getByRole('button', { name: /next/i }).click();
  await expect(page.locator('.modern-reading-pagination')).toContainText(/Page 2/i);
  await choose(page, 'Filter readings by condition', 'Warning');
  await expect(page.getByText('No readings found')).toBeVisible();
});

test('tank and marketplace report CSV downloads and print preparation', async ({ page, qa }) => {
  await open(page, '/admin/reports');
  const download = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    return fs.readFile(await (await pending).path(), 'utf8');
  };
  const print = async () => {
    const pending = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Print Report', exact: true }).click();
    const popup = await pending;
    await expect(popup.locator('table').first()).toBeVisible();
    return popup;
  };
  const csv = await download();
  expect(csv).toContain('Temperature Condition');
  expect(csv).toContain('Ammonia Condition');
  expect(csv).toContain('Water Reading'); expect(csv).toContain('Ammonia Reading');
  expect(csv).toContain('0.6 cm,Critical');
  const allTanks = await print();
  await expect(allTanks.locator('body')).toContainText('Ammonia Scans');
  await expect(allTanks.locator('body')).toContainText('0.60 mg/L');
  await allTanks.close();
  await choose(page, 'Choose which tank to include in the report', 'Tank A');
  expect(await download()).not.toContain('Tank B');
  const selected = await print();
  await expect(selected.locator('body')).toContainText('Tank A');
  await expect(selected.locator('body')).not.toContainText('Tank B');
  await selected.close();
  await page.getByRole('button', { name: 'Marketplace Report', exact: true }).click();
  expect(await download()).toContain('Marketplace');
  const market = await print();
  await expect(market.locator('body')).toContainText('QA Legacy Crayfish');
  await expect(market.locator('body')).toContainText('Pending');
  await market.close();
  expect(qa.writes).toEqual([]);
});

test('marketplace legacy category, search, seller links, hide activate and soft removal', async ({ page, qa }) => {
  page.on('dialog', dialog => dialog.accept());
  await open(page, '/admin/marketplace');
  await page.getByRole('button', { name: 'Crayfish', exact: true }).click();
  await expect(page.locator('.market-hub-product-card').first()).toContainText('QA Legacy Crayfish');
  await expect(page.locator('.market-hub-product-card')).toHaveCount(1);
  await page.getByPlaceholder('Search products, category, location...').fill('does not exist');
  await expect(page.locator('.market-hub-product-card')).toHaveCount(0);
  await page.getByPlaceholder('Search products, category, location...').fill('');
  await page.getByRole('button', { name: /^My Products/ }).click();
  const card = page.locator('.market-hub-product-card.seller').filter({ hasText: 'QA Legacy Crayfish' });
  await card.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
  await open(page, '/admin/marketplace/listing-a');
  await expect(page.getByRole('link', { name: 'Facebook', exact: true })).toHaveAttribute('href', 'https://example.invalid/store');
  expect(await page.locator('a[href^="javascript:"],a[href^="data:"],a[href^="file:"]').count()).toBe(0);
  await open(page, '/admin/marketplace');
  await page.getByRole('button', { name: /^My Products/ }).click();
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(qa.writes.map(write => write.method)).toEqual(['PATCH', 'PATCH', 'PATCH']);
  expect(qa.data.marketplace_listings.find(row => row.id === 'listing-a').status).toBe('deleted');
});

test('add and edit listing submit correct fields to the mocked backend', async ({ page, qa }) => {
  await open(page, '/admin/marketplace/sell');
  await page.getByRole('button', { name: 'Publish Product', exact: true }).click();
  await expect(page.getByText('Please enter a product title.')).toBeVisible();
  expect(qa.writes).toHaveLength(0);
  await page.getByLabel(/^Product Title/).fill('QA New Crayfish');
  await page.getByPlaceholder('0.00').fill('100');
  await page.getByPlaceholder('Example: 1 inch').fill('1 inch');
  await page.getByRole('button', { name: 'Publish Product', exact: true }).click();
  await expect.poll(() => qa.writes.filter(write => write.table === 'marketplace_listings').length).toBe(1);
  const inserted = qa.writes.find(write => write.table === 'marketplace_listings');
  expect(inserted.method).toBe('POST');
  expect(inserted.body).toMatchObject({ title: 'QA New Crayfish', category: 'crayfish', seller_id: qa.data.profiles[0].id, price: 100, status: 'active' });
  await open(page, '/admin/marketplace/listing-a/edit');
  await page.getByLabel(/^Product Title/).fill('QA Edited Crayfish');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect.poll(() => qa.writes.filter(write => write.method === 'PATCH').length).toBe(1);
  expect(qa.data.marketplace_listings.find(row => row.id === 'listing-a').title).toBe('QA Edited Crayfish');
});

test('seller profile rejects unsafe links and saves a valid profile to the mocked backend', async ({ page, qa }) => {
  await open(page, '/admin/marketplace/seller-profile');
  await page.getByLabel(/^Website/).fill('javascript:alert(1)');
  await page.getByRole('button', { name: /Save.*Profile/i }).click();
  await expect(page.locator('.modern-admin-content')).toContainText(/valid.*(url|link)|http|invalid/i);
  expect(qa.writes).toHaveLength(0);
  await page.getByLabel(/^Website/).fill('https://example.invalid/qa-store');
  await page.getByLabel(/^Store Name/).fill('QA Updated Store');
  await page.getByRole('button', { name: /Save.*Profile/i }).click();
  await expect.poll(() => qa.writes.filter(write => write.table === 'seller_profiles').length).toBe(1);
  expect(qa.writes[0].body.website_url).toBe('https://example.invalid/qa-store');
});

test('reports date/condition filters, refresh and empty export/print are handled', async ({ page, qa }) => {
  page.on('dialog', dialog => dialog.accept());
  await open(page, '/admin/reports');
  await choose(page, 'Filter monitoring records by condition', 'Warning');
  await expect(page.locator('.monitoring-ammonia-history')).toContainText('No ammonia scans');
  await choose(page, 'Filter monitoring records by condition', 'All');
  await page.getByLabel('From Date', { exact: true }).fill('2099-01-01');
  await expect(page.locator('.monitoring-ammonia-history')).toContainText('No ammonia scan recorded during this period.');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await page.getByRole('button', { name: 'Print Report', exact: true }).click();
  await page.getByRole('button', { name: 'Clear Dates', exact: true }).click();
  qa.data.ammonia_readings = [];
  await page.getByRole('button', { name: /refresh/i }).first().click();
  await expect(page.locator('.monitoring-ammonia-history')).toContainText('No ammonia scan recorded during this period.');
  expect(qa.writes).toEqual([]);
});

test('orders show reservation status, buyer/seller and support filtering', async ({ page, qa }) => {
  qa.data.marketplace_orders[0].buyer_name = 'QA Buyer';
  qa.data.marketplace_orders[0].seller_name = 'QA Seller';
  await open(page, '/admin/orders');
  const rows = page.locator('.modern-orders-table-row');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Pending');
  await expect(rows).toContainText('QA Buyer'); await expect(rows).toContainText('QA Seller');
  await choose(page, 'Filter marketplace orders by status', 'Completed');
  await expect(rows).toHaveCount(0);
  expect(qa.writes).toEqual([]);
});

test('missing or invalid readings and missing ammonia stay neutral across pages', async ({ page, qa }) => {
  qa.data.tanks = [qa.data.tanks[0]];
  qa.data.sensor_readings = [{ ...qa.data.sensor_readings[0], temperature_c: false, ph_value: null, ph: '', water_depth_cm: 'invalid', turbidity_voltage: '' }];
  qa.data.ammonia_readings = [];
  for (const route of ['/admin', '/admin/tanks', '/admin/tanks/tank-a', '/admin/readings', '/admin/reports']) {
    await open(page, route);
    const badges = page.locator('.safety-status');
    await expect(badges.first()).toBeVisible();
    const parameterBadges = page.locator('.modern-tank-sensor-card .safety-status,.modern-tank-detail-metric .safety-status,.modern-reading-metric .safety-status,.cray-report-metric-grid .safety-status');
    expect(await parameterBadges.filter({ hasText: /^(Normal|Critical)$/ }).count()).toBe(0);
    await expect(page.locator('.modern-admin-content')).toContainText('No Data');
  }
  expect(qa.writes).toEqual([]);
});

test('disallowed dashboard role and invalid tank/listing IDs have sensible handling', async ({ page, qa }) => {
  await open(page, '/admin/tanks/missing-tank');
  await expect(page.locator('.modern-admin-content')).toContainText(/not found/i);
  await open(page, '/admin/marketplace/missing-listing');
  await expect(page.locator('.modern-admin-content')).toContainText(/unavailable|not found/i);
  await open(page, '/admin/marketplace/missing-listing/edit');
  await expect(page.locator('.modern-admin-content')).toContainText(/cannot be edited/i);
  qa.data.profiles[0].role = 'admin';
  await page.goto('/admin'); await expect(page).toHaveURL('/login');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark']) {
    test(`responsive layouts ${viewport.width}px ${theme}`, async ({ page, qa, context }) => {
      await page.setViewportSize(viewport);
      await context.addInitScript(theme => localStorage.setItem('craythrive_dashboard_theme', theme), theme);
      for (const route of routes) {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('h1,h2').first()).toBeVisible();
        if (route.startsWith('/admin')) await expect(page.locator('.modern-admin-content')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), { message: `horizontal overflow on ${route}` }).toBeLessThanOrEqual(1);
        if (viewport.width === 390 && route === '/admin/reports') await page.screenshot({ path: `.security-qa-reports-${theme}.png`, fullPage: true });
      }
      expect(qa.writes).toEqual([]);
    });
  }
}
