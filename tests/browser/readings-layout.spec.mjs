import { test, expect } from './fixtures.mjs';

for (const [width, columns] of [[1600, 4], [1024, 2], [390, 1]]) {
  for (const theme of ['light', 'dark']) test(`Readings ${width}px ${theme}: distinct values, limits, status and manual scan`, async ({ page, context, qa }) => {
    await context.addInitScript(theme => localStorage.setItem('craythrive_dashboard_theme', theme), theme);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/admin/readings');
    const grid = page.locator('.modern-reading-metric-grid');
    await expect(grid.locator('.modern-reading-metric')).toHaveCount(4);
    await expect(page.locator('.modern-reading-metric')).toHaveCount(5);
    const layout = await page.evaluate(() => Object.fromEntries(['.modern-admin-shell', '.modern-admin-main', '.readings-water-panel', '.modern-reading-metric-grid'].map(selector => {
      const element = document.querySelector(selector), style = getComputedStyle(element);
      return [selector, { display: style.display, width: style.width, columns: style.gridTemplateColumns, container: style.containerName }];
    })));
    await expect.poll(() => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), JSON.stringify(layout)).toBe(columns);
    if (width > 920) {
      const sidebar = await page.locator('.modern-admin-sidebar').boundingBox();
      const main = await page.locator('.modern-admin-main').boundingBox();
      expect(main.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 1);
      expect(main.y).toBeLessThan(100);
    }
    for (const card of await page.locator('.modern-reading-metric').all()) {
      await expect(card.locator('.sensor-safe-range')).toBeVisible();
      await expect(card.locator('.safety-status')).toBeVisible();
      await expect(card.locator('.reading-metric-updated')).toContainText('Asia/Manila');
      const geometry = await card.evaluate(element => {
        const value = element.querySelector('.reading-metric-content > strong');
        const title = element.querySelector('header > small');
        return { overflow: element.scrollWidth > element.clientWidth + 1,
          valueSize: parseFloat(getComputedStyle(value).fontSize), titleSize: parseFloat(getComputedStyle(title).fontSize),
          limitBottom: element.querySelector('.sensor-safe-range').getBoundingClientRect().bottom,
          statusTop: element.querySelector('.reading-metric-state').getBoundingClientRect().top };
      });
      expect(geometry.overflow).toBe(false);
      expect(geometry.valueSize).toBeGreaterThan(geometry.titleSize);
      expect(geometry.limitBottom).toBeLessThanOrEqual(geometry.statusTop);
    }
    await expect(page.getByRole('region', { name: 'Manual ammonia result' })).toContainText('not a continuous IoT reading');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1600 && theme === 'dark' || width === 390 && theme === 'light') {
      await page.screenshot({ path: `.security-fix89-readings-${width}-${theme}.png`, fullPage: true });
    }
    expect(qa.writes).toEqual([]);
  });
}

test('stale readings retain values and dates with neutral badges; missing scans are explicit', async ({ page, qa }) => {
  qa.serverTime = '2026-10-13T02:00:00Z';
  qa.data.sensor_readings.forEach(row => { row.created_at = '2026-10-12T02:00:00Z'; });
  qa.data.ammonia_readings = [];
  await page.goto('/admin/readings');
  const temperature = page.getByRole('article', { name: 'Latest Temperature', exact: true });
  await expect(temperature.locator('.safety-status')).toHaveText('Stale');
  await expect(temperature).toContainText('Last known reading · stale');
  await expect(temperature.locator('time')).toContainText('Oct 12');
  await expect(page.getByRole('region', { name: 'Manual ammonia result' })).toContainText('No recent ammonia reading');
  await temperature.getByText('Reading details', { exact: true }).click();
  await expect(temperature.locator('details p')).toBeVisible();
  expect(qa.writes).toEqual([]);
});
