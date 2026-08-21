// Lock In — shared helpers

const Storage = {
  async getGroups() {
    const { groups = [] } = await chrome.storage.local.get('groups');
    return groups;
  },
  async saveGroups(groups) {
    await chrome.storage.local.set({ groups });
  },
  async getLockMode() {
    const { lockMode = false } = await chrome.storage.local.get('lockMode');
    return lockMode;
  },
  async setLockMode(value) {
    await chrome.storage.local.set({ lockMode: value });
  }
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalizeDomainInput(raw) {
  if (!raw) return '';
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.split('/')[0];
  d = d.split('?')[0];
  d = d.split('#')[0];
  return d;
}

function isGroupActive(g, now = Date.now()) {
  if (!g.enabled) return false;
  if (g.mode === 'schedule') return isWithinSchedule(g.schedule, new Date(now));
  return true;
}

// ---------- Schedule (block-by-hours) helpers ----------
// A schedule looks like: { days: [1,2,3,4,5], start: 540, end: 1020 }
// `days` uses JS getDay() numbering (0 = Sunday .. 6 = Saturday).
// `start`/`end` are minutes since local midnight. `start > end` means the
// window crosses midnight (e.g. 22:00 -> 06:00), anchored to the start day.

function isWithinSchedule(schedule, now = new Date()) {
  if (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0) return false;
  const { days, start = 0, end = 0 } = schedule;
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  if (start === end) {
    // Same start/end = block all day on the selected days.
    return days.includes(day);
  }
  if (start < end) {
    return days.includes(day) && minutes >= start && minutes < end;
  }
  // Overnight window (e.g. 22:00 -> 06:00), anchored to the day it starts on.
  const prevDay = (day + 6) % 7;
  return (days.includes(day) && minutes >= start) || (days.includes(prevDay) && minutes < end);
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatScheduleDays(days) {
  if (!days || days.length === 0) return 'no days';
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 7) return 'every day';
  if (sorted.join(',') === '1,2,3,4,5') return 'weekdays';
  if (sorted.join(',') === '0,6') return 'weekends';
  return sorted.map((d) => DAY_LABELS[d]).join(', ');
}

function formatSchedule(schedule) {
  if (!schedule) return '';
  const range =
    schedule.start === schedule.end
      ? 'all day'
      : `${formatMinutes(schedule.start)}\u2013${formatMinutes(schedule.end)}`;
  return `${formatScheduleDays(schedule.days)} \u00b7 ${range}`;
}
