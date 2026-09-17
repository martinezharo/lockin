// One reusable dialog for all rule explanations.
const descriptions = new WeakMap();
const titles = {
  domains: 'About forbidden tunnels',
  exceptions: 'About always-allowed pages',
  schedule: 'About scheduled hours',
  limit: 'About daily allowances'
};

const overlay = document.createElement('div');
overlay.id = 'infoModal';
overlay.className = 'modal-overlay info-overlay hidden';
overlay.innerHTML = `
  <div class="modal-card info-modal-card" role="dialog" aria-modal="true"
    aria-labelledby="infoModalTitle" aria-describedby="infoModalBody">
    <div class="info-modal-heading">
      <h3 id="infoModalTitle"></h3>
      <button type="button" class="info-modal-close" aria-label="Close information dialog">×</button>
    </div>
    <div id="infoModalBody" class="info-modal-body"></div>
    <div class="modal-actions"><button type="button" class="primary info-modal-done">Got it</button></div>
  </div>`;
document.body.append(overlay);
const heading = overlay.querySelector('#infoModalTitle');
const body = overlay.querySelector('#infoModalBody');
const close = overlay.querySelector('.info-modal-close');
const done = overlay.querySelector('.info-modal-done');
let previousFocus = null;

export function infoButton(topic, html) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'info-button';
  button.setAttribute('aria-label', titles[topic]);
  button.setAttribute('aria-haspopup', 'dialog');
  button.title = titles[topic];
  button.textContent = 'i';
  descriptions.set(button, { topic, html });
  return button;
}

function dismiss() {
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('hidden');
  const target = previousFocus;
  previousFocus = null;
  if (target?.isConnected) target.focus();
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest?.('.info-button');
  const description = trigger && descriptions.get(trigger);
  if (!description) return;
  previousFocus = trigger;
  heading.textContent = titles[description.topic];
  // This markup comes from the app's existing static help text.
  body.innerHTML = description.html;
  overlay.classList.remove('hidden');
  close.focus();
});
close.addEventListener('click', dismiss);
done.addEventListener('click', dismiss);
overlay.addEventListener('click', (event) => {
  if (event.target === overlay) dismiss();
});
document.addEventListener('keydown', (event) => {
  if (overlay.classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    dismiss();
  } else if (event.key === 'Tab') {
    if (event.shiftKey && document.activeElement === close) {
      event.preventDefault();
      done.focus();
    } else if (!event.shiftKey && document.activeElement === done) {
      event.preventDefault();
      close.focus();
    }
  }
});
