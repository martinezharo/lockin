(() => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const state = {
    privacyConsent: true,
    lockMode: true,
    groups: [
      {
        id: 'social',
        name: 'Scroll pit',
        domains: ['x.com', 'instagram.com', 'reddit.com'],
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
      }
    ],
    usage: { social: { date: today, ms: 17 * 60 * 1000 } },
    usageSession: { groupIds: ['social'], startedAt: Date.now() },
    nativeStatus: {
      connected: true,
      configured: true,
      enforcementArmed: true,
      failClosed: true,
      failClosedActive: false,
      blockedDomains: ['youtube.com', 'twitch.tv'],
      enforcementReason: 'schedule',
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
      async sendMessage() { return { ok: true }; },
      openOptionsPage() {},
      getURL(path) { return path; }
    }
  };
})();
