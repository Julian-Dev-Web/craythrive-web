import fs from 'node:fs/promises';
import { test, expect } from './fixtures.mjs';

const sizes = [[390, 844], [360, 800], [412, 915], [768, 1024], [1366, 768], [1440, 900]];
const routes = ['/admin', '/admin/tanks', '/admin/tanks/tank-a', '/admin/readings', '/admin/reports', '/admin/marketplace', '/admin/marketplace/listing-a', '/admin/marketplace/seller-profile', '/admin/orders', '/admin/settings'];
const longTank = 'Julian Breeder Tank With A Long Name For Mobile Reports ' + 'CrayThrive'.repeat(8);

async function open(page, route = '/admin/reports') {
  await page.goto(route);
  await page.waitForLoadState('networkidle');
}
async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function print(page) {
  const pending = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print Report', exact: true }).click();
  const popup = await pending;
  await expect(popup.locator('table').first()).toBeVisible();
  return popup;
}
async function download(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const file = await pending;
  return { filename: file.suggestedFilename(), text: await fs.readFile(await file.path(), 'utf8') };
}

// Parse quoted multiline fields, rather than splitting CSV on newlines.
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(field); field = ''; }
    else if (!quoted && /[\r\n]/.test(char)) {
      row.push(field); rows.push(row); row = []; field = '';
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else field += char;
  }
  row.push(field); rows.push(row);
  const headers = rows.shift();
  return rows.map(values => Object.fromEntries(headers.map((key, i) => [key, values[i]])));
}

for (const [width, height] of sizes) {
  for (const theme of ['light', 'dark']) {
    test(`mobile audit ${width}x${height} ${theme} with long names`, async ({ page, context, qa }) => {
      await page.setViewportSize({ width, height });
      await context.addInitScript(theme => localStorage.setItem('craythrive_dashboard_theme', theme), theme);
      qa.data.tanks[0].name = longTank;
      qa.data.marketplace_listings[0].title = 'Farmer Product With A Long Name ' + 'Crayfish'.repeat(10);
      qa.data.seller_profiles[0].store_name = 'Farmer Store ' + 'CrayThrive'.repeat(10);
      for (const route of routes) {
        await open(page, route);
        await expect(page.locator('.modern-admin-content')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (overflow > 1) console.log(route, await page.evaluate(() => [...document.querySelectorAll('.modern-admin-content *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 15).map(el => ({ class: el.className, width: Math.round(el.getBoundingClientRect().width), text: el.textContent.slice(0, 70) }))));
        expect.soft(overflow, `page overflow: ${route}`).toBeLessThanOrEqual(1);
        if (route === '/admin/reports') {
          expect(await page.getByLabel('From Date', { exact: true }).evaluate(el => getComputedStyle(el).colorScheme)).toBe(theme);
          for (const label of ['Refresh', 'Export CSV', 'Print Report', 'Choose which tank to include in the report']) {
            const button = page.getByRole('button', { name: label, exact: true });
            await expect(button).toBeVisible();
            const box = await button.boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
            expect(box.height, `${label} touch target`).toBeGreaterThanOrEqual(44);
          }
          await choose(page, 'Choose which tank to include in the report', longTank);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'selected long tank overflow').toBeLessThanOrEqual(1);
          await expect(page.locator('.cray-report-metric-grid')).toContainText('0.60 cm');
          await expect(page.locator('.monitoring-ammonia-history')).toContainText('0.10 mg/L');
          if ([390, 768, 1440].includes(width)) {
            await page.screenshot({ path: `.security-mobile-reports-${width}-${theme}.png`, fullPage: true });
            await page.locator('.cray-report-exportbar').screenshot({ path: `.security-mobile-controls-${width}-${theme}.png` });
            await page.locator('.cray-report-metric-grid').screenshot({ path: `.security-mobile-metrics-${width}-${theme}.png`, style: '.modern-admin-topbar { visibility: hidden !important; }' });
          }
        }
      }
      expect(qa.writes).toEqual([]);
    });
  }
}

test.describe('phone exports', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('actual CSV and print include evaluated conditions and separate ammonia dates', async ({ page, qa }) => {
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { window.__qaCsvMime = blob.type; return create(blob); };
    });
    qa.data.tanks[0].name = 'Tank, "A"\nSecond line';
    await open(page);
    const csv = await download(page);
    expect(csv.filename).toBe('craythrive-all-tanks-report.csv');
    expect(await page.evaluate(() => window.__qaCsvMime)).toBe('text/csv;charset=utf-8;');
    expect(csv.text).toContain('"Tank, ""A""\nSecond line"');
    expect(csv.text).toContain('Water Level Condition');
    expect(csv.text).toContain('0.60 cm,Warning');
    expect(csv.text).toContain('Ammonia Reading');
    expect(csv.text).not.toMatch(/Safe Ideal|Needs Checking|Urgent/);
    const records = parseCsv(csv.text);
    expect(records).toHaveLength(4);
    const water = records.find(row => row.Type === 'Water Reading' && row.Tank.startsWith('Tank,'));
    const scan = records.find(row => row.Type === 'Ammonia Reading' && row.Tank.startsWith('Tank,'));
    expect(water.Ammonia).toBe('');
    expect(water['Water Level Condition']).toBe('Warning');
    expect(scan.Temperature).toBe('');
    expect(scan.Ammonia).toBe('0.10 mg/L');
    expect(scan.Date).not.toBe(water.Date);
    await expect(page.locator('.monitoring-ammonia-history')).toContainText(scan.Date);
    await fs.writeFile('.security-mobile-report.csv', csv.text);
    const popup = await print(page);
    await expect.poll(() => popup.evaluate(() => window.__qaPrintCalled)).toBe(true);
    expect(await popup.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(popup.locator('body')).toContainText('0.10 mg/L');
    await expect(popup.locator('body')).toContainText('Critical');
    await popup.pdf({ path: '.security-mobile-report.pdf', preferCSSPageSize: true, printBackground: true });
    await popup.screenshot({ path: '.security-mobile-print-preview.png', fullPage: true });
    await popup.close();
  });

  test('all tanks, selected long tank, marketplace, combined and no-scan print/PDF exports', async ({ page, context, qa }) => {
    await context.addInitScript(() => localStorage.setItem('craythrive_dashboard_theme', 'dark'));
    qa.data.tanks[0].name = longTank;
    const scans = qa.data.ammonia_readings;
    qa.data.alerts = [{ id: 'alert-a', user_id: qa.data.profiles[0].id, tank_id: 'tank-a', title: 'Low water', severity: 'critical', message: 'Water level is below the configured minimum, check "Tank A".\nInspect the water supply.', status: 'open', created_at: qa.data.sensor_readings[0].created_at }];
    await open(page);
    const save = async (name, expected, absent = '') => {
      const popup = await print(page);
      await expect(popup.locator('body')).toContainText(expected);
      if (absent) await expect(popup.locator('body')).not.toContainText(absent);
      await popup.emulateMedia({ media: 'print' });
      expect(await popup.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
      await expect(popup.locator('.print-actions')).toBeHidden();
      const headerCounts = await popup.locator('table').evaluateAll(tables => tables.map(table => table.querySelectorAll('thead th').length));
      expect(headerCounts.every(count => count <= 7)).toBe(true);
      await popup.pdf({ path: `.security-print-${name}.pdf`, preferCSSPageSize: true, printBackground: true });
      await popup.setViewportSize({ width: 794, height: 1123 });
      await popup.screenshot({ path: `.security-print-${name}.png`, fullPage: true });
      await popup.close();
    };
    const allCsv = await download(page);
    expect(parseCsv(allCsv.text).some(row => row.Type === 'Alert' && row.Priority === 'Critical')).toBe(true);
    await save('all-tanks', 'Water level is below the configured minimum');
    await choose(page, 'Choose which tank to include in the report', longTank);
    const selectedCsv = await download(page);
    expect(selectedCsv.filename).toMatch(/^craythrive-julian-breeder-tank.*report\.csv$/);
    expect(parseCsv(selectedCsv.text).every(row => row.Tank === longTank)).toBe(true);
    await save('selected-long-tank', longTank, 'Tank B');
    qa.data.ammonia_readings = [];
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('.monitoring-ammonia-history')).toContainText('No ammonia scan recorded during this period.');
    await save('no-ammonia', 'No Scan');
    await page.getByRole('button', { name: 'Marketplace Report', exact: true }).click();
    const marketCsv = await download(page);
    expect(marketCsv.filename).toBe('craythrive-marketplace-report.csv');
    expect(parseCsv(marketCsv.text).some(row => row.Type === 'Marketplace Order' && row.Status === 'Pending')).toBe(true);
    await save('marketplace', 'QA Legacy Crayfish', 'Water Readings');
    qa.data.ammonia_readings = scans;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await choose(page, 'Choose export scope', 'Export: Tanks + Marketplace');
    const combinedCsv = await download(page);
    expect(combinedCsv.filename).toBe('craythrive-combined-report.csv');
    const combined = parseCsv(combinedCsv.text);
    expect(combined.some(row => row.Type === 'Water Reading')).toBe(true);
    expect(combined.some(row => row.Type === 'Marketplace Listing')).toBe(true);
    expect(combined.some(row => row.Type === 'Ammonia Reading')).toBe(true);
    await save('combined', 'CrayThrive Combined Report');
    expect(qa.writes).toEqual([]);
  });

  test('multi-page history keeps all water and independent ammonia records', async ({ page, qa }) => {
    const base = qa.data.sensor_readings[0];
    qa.data.sensor_readings = Array.from({ length: 80 }, (_, i) => ({ ...base, id: `history-${i}`, created_at: new Date(Date.now() - i * 60000).toISOString() }));
    await open(page);
    const csv = await download(page);
    const rows = parseCsv(csv.text);
    expect(rows.filter(row => row.Type === 'Water Reading')).toHaveLength(80);
    expect(rows.filter(row => row.Type === 'Ammonia Reading')).toHaveLength(2);
    const popup = await print(page);
    expect(await popup.locator('tbody tr').count()).toBe(82);
    await popup.pdf({ path: '.security-print-multipage.pdf', preferCSSPageSize: true, printBackground: true });
    await popup.close();
  });
});
