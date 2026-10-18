import fs from 'node:fs/promises';
import { test, expect, user } from './fixtures.mjs';

async function openPrint(page) {
  const pending = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print Report', exact: true }).click();
  const popup = await pending;
  await expect(popup.locator('html')).toHaveAttribute('data-pagination-ready', 'true');
  return popup;
}
async function assertPages(popup) {
  await popup.emulateMedia({ media: 'print' });
  const pages = popup.locator('.report-page'), count = await pages.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) await expect(pages.nth(i).locator('.page-number')).toHaveText(`Page ${i + 1} of ${count}`);
  const overflow = await pages.evaluateAll(nodes => nodes.map(page => ({
    content: page.querySelector('.report-page-content').scrollHeight - page.querySelector('.report-page-content').clientHeight,
    width: page.scrollWidth - page.clientWidth,
    height: page.scrollHeight - page.clientHeight,
  })));
  expect(overflow.every(value => value.content <= 1 && value.width <= 1 && value.height <= 1), JSON.stringify(overflow)).toBe(true);
  return count;
}

test('report UI, CSV and PDF exclude alerts without deleting Alert page records', async ({ page, qa }) => {
  qa.data.alerts = [{ id: 'alert-only', user_id: user.id, tank_id: 'tank-a', title: 'PRIVATE ALERT REPORT SENTINEL',
    type: 'sensor_reading', message: 'This alert belongs on Alerts.', severity: 'critical', created_at: new Date().toISOString() }];
  const raw = structuredClone(qa.data.alerts);
  await page.goto('/admin/reports');
  await expect(page.getByText('Critical Readings', { exact: true })).toBeVisible();
  await expect(page.getByText('Critical Alerts', { exact: true })).toHaveCount(0);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await fs.readFile(await (await pending).path(), 'utf8');
  expect(csv).not.toContain('PRIVATE ALERT REPORT SENTINEL'); expect(csv).not.toContain('Alert,');
  const popup = await openPrint(page); await assertPages(popup);
  await expect(popup.locator('body')).not.toContainText('PRIVATE ALERT REPORT SENTINEL');
  await popup.close();
  await page.goto('/admin/alerts'); await expect(page.getByText('PRIVATE ALERT REPORT SENTINEL', { exact: true }).first()).toBeVisible();
  expect(qa.data.alerts).toEqual(raw); expect(qa.writes).toEqual([]);
});

test('A4 pagination repeats headers, retains all records and separates water, ammonia and marketplace', async ({ page, qa }) => {
  const base = qa.data.sensor_readings[0];
  qa.data.sensor_readings = Array.from({ length: 80 }, (_, i) => ({ ...base, id: `row-${i}`, created_at: new Date(Date.now() - i * 60000).toISOString() }));
  await page.goto('/admin/reports');
  await page.getByRole('button', { name: 'Choose export scope', exact: true }).click();
  await page.getByRole('option', { name: 'Export: Tanks + Marketplace', exact: true }).click();
  const popup = await openPrint(page); const count = await assertPages(popup);
  expect(count).toBeGreaterThan(4);
  expect(await popup.locator('tbody tr').filter({ hasText: 'cm' }).count()).toBe(80);
  const pages = await popup.locator('.report-page').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent,
    heads: [...node.querySelectorAll('h3')].map(heading => heading.textContent), thead: node.querySelectorAll('thead').length })));
  expect(pages.filter(page => page.heads.includes('Water Readings')).every(page => page.thead === 1 && !page.heads.includes('Ammonia Scans'))).toBe(true);
  expect(pages.some(page => page.heads.includes('Ammonia Scans'))).toBe(true);
  expect(pages.some(page => page.heads.includes('Marketplace Listing'))).toBe(true);
  expect(pages.some(page => page.heads.includes('Marketplace Order'))).toBe(true);
  await popup.pdf({ path: '.security-report-pagination.pdf', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  await fs.writeFile('.security-report-pagination-expected.json', JSON.stringify({ pages: count }));
  await popup.locator('.report-page').first().screenshot({ path: '.security-report-pagination-page1.png' });
  await popup.close(); expect(qa.writes).toEqual([]);
});

test('phone preview stays responsive and page numbers remain visible without browser headers', async ({ page, qa }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  qa.data.tanks[0].name = 'Tank ' + 'long name '.repeat(30);
  await page.goto('/admin/reports');
  const popup = await openPrint(page);
  expect(await popup.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await expect(popup.locator('.page-number').first()).toBeVisible();
  const count = await assertPages(popup);
  await popup.pdf({ path: '.security-report-phone.pdf', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  await fs.writeFile('.security-report-phone-expected.json', JSON.stringify({ pages: count }));
  await popup.close(); expect(qa.writes).toEqual([]);
});

test('an oversized text field continues onto more sheets without truncating its value', async ({ page, qa }) => {
  const name = 'OVERSIZE START ' + 'retained field text '.repeat(300) + 'OVERSIZE END';
  qa.data.marketplace_listings = [{ ...qa.data.marketplace_listings[0], title: name }];
  qa.data.marketplace_orders = [];
  await page.goto('/admin/reports');
  await page.getByRole('button', { name: 'Marketplace Report', exact: true }).click();
  const popup = await openPrint(page);
  expect(await assertPages(popup)).toBeGreaterThan(1);
  const reconstructed = (await popup.locator('tbody td[data-label="Name"]').allTextContents()).join('');
  expect(reconstructed).toBe(name);
  await popup.close(); expect(qa.writes).toEqual([]);
});
