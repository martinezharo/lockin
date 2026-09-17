// Decorate both the new-zone form and dynamically rendered zone editors.
import { infoButton } from './help-dialog.js';

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('./help.css', import.meta.url).href;
document.head.append(stylesheet);

function beside(label, button) {
  const row = document.createElement('div');
  row.className = 'help-title-row';
  label.before(row);
  row.append(label, button);
}

function siteHelp(hint) {
  const topic = hint.closest('.exception-box') ? 'exceptions' : 'domains';
  const button = infoButton(topic, hint.innerHTML);
  const fieldLabel = hint.closest('label.field');
  if (fieldLabel) {
    // Do not nest an interactive button in a label. Keep explicit textarea
    // labeling while preserving its value and native form validation.
    const textarea = fieldLabel.querySelector('textarea');
    const oldTitle = fieldLabel.querySelector('.field-label');
    if (!textarea || !oldTitle) return;
    const field = document.createElement('div');
    field.className = fieldLabel.className;
    const title = document.createElement('label');
    title.className = oldTitle.className;
    title.htmlFor = textarea.id;
    title.textContent = oldTitle.textContent;
    fieldLabel.replaceWith(field);
    field.append(title, textarea);
    beside(title, button);
    return;
  }
  const label = topic === 'exceptions'
    ? hint.closest('.exception-box')?.querySelector('.exception-heading .col-label')
    : hint.previousElementSibling;
  if (!label) return;
  beside(label, button);
  hint.remove();
}

function ruleHelp(hint) {
  const block = hint.closest('[data-rule-block]');
  const label = block?.querySelector('.rule-head');
  const topic = block?.dataset.ruleBlock;
  if (!label || !['schedule', 'limit'].includes(topic)) return;
  const row = document.createElement('div');
  row.className = 'help-rule-heading';
  label.before(row);
  // Outside the disabled fieldset, this remains available with the rule off.
  row.append(label, infoButton(topic, hint.innerHTML));
  hint.remove();
}

export function enhanceHelp(root = document) {
  root.querySelectorAll('.site-help').forEach(siteHelp);
  root.querySelectorAll('.rule-hint').forEach(ruleHelp);
}

enhanceHelp();
// options.js re-renders these sections. Watch only relevant insertions, never
// recreate the controls or alter their saved values.
for (const id of ['groupsList', 'rulesControls']) {
  const root = document.getElementById(id);
  if (!root) continue;
  new MutationObserver(() => enhanceHelp(root)).observe(root, {
    childList: true,
    subtree: true
  });
}
