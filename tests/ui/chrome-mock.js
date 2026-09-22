(() => {
  const now = new Date();
  // The dashboard shows different things for a repository build and a Chrome
  // Web Store one, and for each stage of the watchdog handshake. Both are
  // selectable so screenshots and assertions can reach every state:
  //   ?build=store            pretend this copy came from the Web Store
  //   ?watchdog=off|warming   stop short of armed enforcement
  const params = new URLSearchParams(location.search);
  const watchdog = params.get('watchdog') || 'armed';
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const state = {
    privacyConsent: true,
    lockMode: true,
    groups: [
      {
        id: 'social',
        name: 'Scroll pit',
        domains: ['x.com', 'instagram.com', 'reddit.com'],
        exceptions: ['x.com/i/account_analytics'],
        enabled: true,
        schedule: null,
        limit: { minutes: 45 },
        mode: 'schedule',
        createdAt: Date.now()
      },
      {
        id: 'video',
        name: 'Video tunnels',
        domains: ['youtube.com', 'twitch.tv'],
        enabled: true,
        schedule: { days: [now.getDay()], start: 0, end: 0 },
        limit: null,
        mode: 'schedule',
        createdAt: Date.now() - 1000
      },
      // A zone in the middle of a timed release, so the board, the strip and the
      // popup are all photographed with a countdown to containment returning.
      {
        id: 'news',
        name: 'News hole',
        domains: ['news.ycombinator.com'],
        enabled: false,
        disarmedUntil: Date.now() + 22 * 60 * 1000,
        schedule: { days: [1, 2, 3, 4, 5], windows: [{ start: 9 * 60, end: 18 * 60 }] },
        limit: null,
        mode: 'schedule',
        createdAt: Date.now() - 2000
      }
    ],
    usage: { social: { date: today, ms: 17 * 60 * 1000 } },
    usageSession: { groupIds: ['social'], startedAt: Date.now() },
    nativeStatus: {
      connected: watchdog !== 'off',
      supportsUrlRules: true,
      supportsExceptions: true,
      supportsTimedDisarm: true,
      configured: true,
      enforcementArmed: watchdog === 'armed',
      failClosed: true,
      failClosedActive: false,
      blockedDomains: watchdog === 'armed' ? ['youtube.com', 'twitch.tv'] : [],
      enforcementReason: watchdog === 'armed' ? 'schedule' : 'not armed',
      lastHeartbeatMs: Date.now(),
      updatedAt: Date.now()
    }
  };

  function selected(keys) {
    if (keys == null) return { ...state };
    if (typeof keys === 'string') return { [keys]: state[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, state[key]]));
    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, state[key] ?? fallback]));
  }

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) { return selected(keys); },
        async set(values) { Object.assign(state, values); },
        async clear() { for (const key of Object.keys(state)) delete state[key]; }
      }
    },
    runtime: {
      getManifest() {
        // Chrome adds update_url to the manifest of anything installed from
        // the Web Store, and to nothing that was loaded unpacked.
        return params.get('build') === 'store'
          ? { version: '1.4.1', update_url: 'https://clients2.google.com/service/update2/crx' }
          : { version: '1.4.1' };
      },
      async sendMessage() { return { ok: true }; },
      openOptionsPage() {},
      getURL(path) { return path; }
    }
  };
})();
