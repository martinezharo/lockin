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
  const ruleHeadings = await zone.locator('.rule-head').allTextContents();
  assert.ok(ruleHeadings.some((text) => text.includes('⏰')), 'Scheduled hours keeps its emoji');
  assert.ok(ruleHeadings.some((text) => text.includes('⏳')), 'Daily allowance keeps its emoji');
  assert.match(await zone.locator('[data-limit-preset="0"]').innerText(), /👹/u);

  /* Disarming asks how long before it does anything, and it still cannot be
     done without the paperwork — the two halves of this feature that a
     screenshot cannot certify. */
  const panel = zone.locator('[data-disarm-panel]');
  assert.equal(await panel.isVisible(), false);
  await zone.locator('[data-action="disarm"]').click();
  await panel.waitFor();
  assert.equal(await zone.locator('[data-action="disarm"]').getAttribute('aria-expanded'), 'true');
  assert.match(await panel.locator('.disarm-title').innerText(), /🔓/u);
  assert.equal(await panel.locator('[data-disarm-preset]').count(), 6);
  assert.match(await panel.locator('[data-disarm-confirm]').innerText(), /Disarm for 15m/);

  await panel.getByRole('button', { name: /until I arm it/ }).click();
  assert.match(await panel.locator('[data-disarm-confirm]').innerText(), /until I say so/);
  assert.match(await panel.locator('[data-disarm-outcome]').innerText(), /until you arm this zone again/);

  await panel.locator('[data-disarm-minutes]').fill('30');
  assert.match(await panel.locator('[data-disarm-confirm]').innerText(), /Disarm for 30m/);
  assert.equal(await panel.locator('.preset.checked').count(), 1);

  await panel.locator('[data-disarm-confirm]').click();
  await page.locator('#challengeModal:not(.hidden)').waitFor();
  await page.locator('#challengeCancel').click();
  // Backing out of the paperwork leaves containment exactly as it was.
  assert.doesNotMatch(await zone.locator('.zone-status').innerText(), /released/);

  /* A watchdog that cannot end a release must not be offered one: the lengths
     go inert as the panel opens, not after the answer is given. */
  await page.evaluate(async () => {
    const { nativeStatus } = await chrome.storage.local.get('nativeStatus');
    delete nativeStatus.supportsTimedDisarm;
    await chrome.storage.local.set({ nativeStatus });
  });
  await zone.locator('[data-action="disarm"]').click();
  await zone.locator('[data-action="disarm"]').click();
  assert.equal(await panel.getAttribute('data-disarm-mode'), 'forever');
  assert.match(await panel.locator('[data-disarm-note]').innerText(), /too old to end a release/);
  assert.equal(await panel.locator('[data-disarm-minutes]').isDisabled(), true);
  assert.equal(await panel.locator('[data-disarm-preset="15"]').isDisabled(), true);
  assert.equal(await panel.locator('[data-disarm-preset="0"]').isDisabled(), false);

  const releasedRow = page.locator('.zone[data-zone="news"]');
  assert.match(await releasedRow.locator('.zone-status').innerText(), /released · containment returns in \d+m/);
  assert.match(await releasedRow.locator('.arm-shortcut').innerText(), /Arm now 🔒/u);
  assert.match(await page.locator('#nowCountdownLabel').innerText(), /containment returns/i);

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

  // Super-strict mode: the guide only exists for a build loaded from this
  // repository, it reports how far the watchdog has actually got, and it can
  // be left the same way every other dialog can.
  const strict = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await strict.goto('http://127.0.0.1:4178/src/pages/options/options.html?watchdog=off', { waitUntil: 'networkidle' });
  const banner = strict.locator('#strictBanner');
  await banner.waitFor();
  assert.match(await banner.innerText(), /Super-strict mode is off/);

  await strict.locator('#strictBannerOpen').click();
  const guide = strict.getByRole('dialog', { name: 'super-strict mode, start to finish' });
  const guideScroll = guide.locator('.strict-card-scroll');
  await guide.waitFor();
  assert.equal(await guide.evaluate((element) => getComputedStyle(element).overflowY), 'hidden');
  assert.equal(await guideScroll.evaluate((element) => getComputedStyle(element).overflowY), 'auto');
  assert.ok(await guideScroll.evaluate((element) => element.scrollHeight > element.clientHeight));
  assert.match(await guide.innerText(), /install-windows-watchdog\.ps1/);
  assert.match(await guide.innerText(), /disarm-windows-watchdog\.ps1/);
  assert.match(await strict.locator('#strictLive').innerText(), /no watchdog is answering/);
  assert.equal(await strict.locator('.strict-step.is-done').count(), 0);
  await strict.keyboard.press('Escape');
  assert.equal(await guide.isVisible(), false);
  assert.equal(await strict.locator('#strictBannerOpen').evaluate((el) => el === document.activeElement), true);
  await strict.locator('#strictBannerOpen').click();
  await guideScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await strict.keyboard.press('Escape');
  await strict.locator('#strictBannerOpen').click();
  assert.equal(await guideScroll.evaluate((element) => element.scrollTop), 0);

  // Armed, both observable steps carry their tick and the row stops shouting.
  await strict.goto('http://127.0.0.1:4178/src/pages/options/options.html', { waitUntil: 'networkidle' });
  await strict.locator('#strictBanner[data-strict-state="armed"]').waitFor();
  await strict.locator('#strictBannerOpen').click();
  assert.equal(await strict.locator('.strict-step.is-done').count(), 2);

  // And the Chrome Web Store copy is never invited to install a watchdog.
  await strict.goto('http://127.0.0.1:4178/src/pages/options/options.html?build=store', { waitUntil: 'networkidle' });
  await strict.locator('#groupsList .zone-toggle').first().waitFor();
  assert.equal(await strict.locator('#strictBanner').isVisible(), false);

  const popup = await browser.newPage({ viewport: { width: 268, height: 420 } });
  await popup.goto('http://127.0.0.1:4178/src/pages/popup/popup.html', { waitUntil: 'networkidle' });
  await popup.locator('.zone-row').first().waitFor();
  assert.match(await popup.locator('#openDash').innerText(), /👹/u);
  assert.match(await popup.locator('#lockRow').innerText(), /🔒|🔓/u);
  assert.match(await popup.locator('#serviceRow').innerText(), /⚠|●/u);
  assert.match(await popup.locator('.zone-row').last().innerText(), /\d+m off/);
  assert.match(await popup.locator('#nextLabel').innerText(), /re-arms/);
  console.log('Polish regression checks passed: emoji, timeline accessibility, watchdog layout, super-strict guide, timed releases, and popup indicators.');
} finally {
  await browser.close();
}
