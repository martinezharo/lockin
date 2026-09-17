// Browser smoke test and screenshots using Lock In's built-in mock.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
});
try {
  let loaded = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      // Use its actual URL, not /: relative module and stylesheet URLs need
      // the options directory even though the test server maps / to this HTML.
      await page.goto('http://127.0.0.1:4178/src/pages/options/options.html', { waitUntil: 'networkidle' });
      loaded = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  assert.ok(loaded, 'UI test server must be available');
  try {
    await page.locator('#groupsList .zone-toggle').first().waitFor({ timeout: 8000 });
  } catch (error) {
    console.error('Browser errors:', errors);
    console.error('Document:', (await page.locator('body').innerText()).slice(0, 1500));
    console.error('Mock loaded:', await page.evaluate(() => typeof chrome !== 'undefined' && Boolean(chrome.storage?.local)));
    throw error;
  }
  await page.locator('#groupsList .zone-toggle').first().click();
  const zone = page.locator('.zone.is-open');
  await zone.locator('.info-button').first().waitFor();
  assert.equal(await zone.locator('.site-help, .rule-hint').count(), 0);
  assert.equal(await zone.locator('.info-button').count(), 4);
  await mkdir('screenshots', { recursive: true });
  await zone.screenshot({ path: 'screenshots/compact-zone.png' });

  const forbidden = zone.getByRole('button', { name: 'About forbidden tunnels' });
  await forbidden.click();
  const dialog = page.getByRole('dialog', { name: 'About forbidden tunnels' });
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Domains cover subdomains/);
  await page.screenshot({ path: 'screenshots/forbidden-info-dialog.png' });
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false);
  assert.equal(await forbidden.evaluate(el => el === document.activeElement), true);

  await zone.getByRole('button', { name: 'About daily allowances' }).click();
  assert.match(await page.getByRole('dialog', { name: 'About daily allowances' }).innerText(), /Permanent/);
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.locator('#newZoneToggle').click();
  await page.locator('#groupDomains').fill('example.com');
  assert.equal(await page.locator('#groupDomains').inputValue(), 'example.com');
  assert.equal(await page.locator('#newGroupForm .info-button').count(), 3);
  await page.locator('#newZone').screenshot({ path: 'screenshots/new-zone-compact.png' });
  assert.deepEqual(errors, [], 'No uncaught page errors');
  console.log('Help UI checks passed; 3 actual browser screenshots captured.');
} finally {
  await browser.close();
}
