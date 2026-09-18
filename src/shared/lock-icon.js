// Lock In — the padlock, drawn.
// Edit lock is the one piece of state both the dashboard and the popup show as
// a picture rather than a word, so it is a stroked path in the current text
// colour: it inherits the theme, matches the stroke weight of every other
// outline in the UI, and looks the same on a machine with no emoji font.

export function lockIconHtml(sealed, size = 16) {
  const shackle = sealed ? 'M8 10V7.5a4 4 0 0 1 8 0V10' : 'M8 10V7.5a4 4 0 0 1 7.6-1.7';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="${shackle}" />
    <rect x="4.5" y="10" width="15" height="10" rx="2.6" />
  </svg>`;
}
