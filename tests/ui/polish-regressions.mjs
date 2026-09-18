// Browser assertions for things that screenshots alone cannot certify.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://127.0.0.1:4178/src/pages/options/options.html', { waitUntil: 'networkidle' });
  await page.locator('#groupsList .zone-toggle').first().waitFor();

  // The timeline key is meaningful text, not a purely decorative graphic.
  assert.equal(await page.locator('.strip-key').getAttribute('aria-hidden'), null);
  assert.match(await page.locator('#dayPanel').getAttribute('aria-describedby'), /stripDescription/);
  assert.match(await page.locator('#stripDescription').textContent(), /Hours to the right of now/);
  assert.match(await page.locator('#newZoneToggle').innerText(), /🐭/u);
  assert.match(await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily), /Noto Color Emoji/);

  await page.locator('#groupsList .zone-toggle').first().click();
  const zone = page.locator('.zone.is-open');
  assert.match(await zone.locator('.exception-heading').innerText(), /free pass 🐭/iu);
  assert.match(await zone.locator('.paperwork-flag').innerText(), /🔒/u);
  assert.match(await zone.locator('[data-action="save-rules"]').innerText(), /🔒/u);
  assert.match(await zone.locator('.rule-head').allTextContents().then((texts) => texts.join(' ')), /⏰.*⏳/u);
  assert.match(await zone.locator('.preset-permanent').innerText(), /👹/u);

  // A status badge must stay inside the panel even when multiple reasons are
  // reported at half width, rather than forcing the headline out of view.
  await page.setViewportSize({ width: 480, height: 900 });
  await page.locator('#serviceReason').evaluate((el) => {
    el.textContent = 'scheduled hours + allowance spent + sensor lost';
  });
  const geometry = await page.locator('#servicePanel').evaluate((panel) => {
    const panelBox = panel.getBoundingClientRect();
    const reasonBox = panel.querySelector('#serviceReason').getBoundingClientRect();
    const copyBox = panel.querySelector('.service-copy').getBoundingClientRect();
    return { panelRight: panelBox.right, reasonRight: reasonBox.right, copyRight: copyBox.right };
  });
  assert.ok(geometry.reasonRight <= geometry.panelRight + 1, 'Watchdog reason stays within its panel');
  assert.ok(geometry.copyRight <= geometry.panelRight + 1, 'Watchdog headline stays within its panel');

  const popup = await browser.newPage({ viewport: { width: 268, height: 420 } });
  await popup.goto('http://127.0.0.1:4178/src/pages/popup/popup.html', { waitUntil: 'networkidle' });
  await popup.locator('.zone-row').first().waitFor();
  assert.match(await popup.locator('#openDash').innerText(), /👹/u);
  assert.match(await popup.locator('#lockRow').innerText(), /🔒|🔓/u);
  assert.match(await popup.locator('#serviceRow').innerText(), /⚠|●/u);
  console.log('Polish regression checks passed: emoji, timeline accessibility, watchdog layout, and popup indicators.');
} finally {
  await browser.close();
}
