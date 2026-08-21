// Lock In — the "prove you mean it" typing challenge shown when Edit Lock is on.
// A random paragraph is picked each time; the source text can't be copied,
// and the input box refuses paste, so the only way through is to type it.

const PRODUCTIVITY_PARAGRAPHS = [
  "okay bestie, real talk 💅 productivity isn't about hustling 24/7 until you burn out, it's about protecting your energy for the stuff that actually matters ✨ when you lock in on ONE task instead of doom-scrolling seven tabs, you literally get more done and feel less crunchy about it fr fr 🧠🔥 future you is gonna send flowers 💐 for the focus you're choosing right now, no cap 🙏",
  "not to be dramatic but every time you close a distracting tab your brain does a little happy dance 🕺✨ productivity hits different when it's intentional instead of forced, bestie 💫 you don't need to grind till 3am to prove anything to anyone, you just need focused time, touch grass after, and let today's small win stack into tomorrow's big glow up 🌱📈 it's giving discipline, and discipline is giving self respect 💖",
  "lowkey the secret sauce to getting stuff done is boundaries, not motivation 🚧✨ motivation is gonna ghost you by 10am but a solid boundary, like not opening a distracting site, stays loyal all day fr 🔒💕 so let's protect the bag, aka your attention span, one blocked tab at a time bestie, you got this 💪🌟 slay the to do list, then and only then, touch grass 🌿",
  "plot twist, rest is actually part of productivity, not the opposite of it 😌✨ but doomscrolling isn't rest, it's just vibes draining chaos tbh 📱💀 real focus means doing the thing on purpose, then logging off on purpose too 🔑🌙 so lock in for this sprint bestie, you're built different when you protect your time like it's precious, because it literally is 💎⏳",
  "no thoughts just productivity core today 🧠✨ the girlies and the boys who lock in without distractions are quite literally living their villain origin story of getting their whole life together 😤🖤 one focused hour beats five scattered ones, that's just math bestie 📊🔥 so let's stay so serious rn, lock the tab, do the thing, then celebrate with your favorite snack 🍫🎉",
  "sending you love but also tough love, closing that tab is an act of self care, not punishment 💖🚪 your future self is literally cheering from the sidelines rn like go off, protect your focus, we don't do distractions here anymore 📣✨ productivity isn't perfection, it's just showing up for your goals a little more than yesterday bestie, one locked in session at a time 🌸📚",
  "achievement unlocked, main character energy via actually finishing your tasks 🎮✨ every distraction you skip is basically xp towards the best version of you, no cap 🕹️💫 focus mode isn't boring, it's literally a power up, so let's grind smart today not scroll dumb, level up bestie 🚀🏆",
  "to the moon and back bestie, that's how far real focus can take you 🚀🌙 one small locked in session today is basically a rocket launch for tomorrow's you ✨🪐 so let's ditch the distractions, protect that precious attention span, and watch your goals go from someday to done bestie, you're stellar 🌟💫"
];

export function pickChallengeParagraph() {
  return PRODUCTIVITY_PARAGRAPHS[Math.floor(Math.random() * PRODUCTIVITY_PARAGRAPHS.length)];
}

// Strips emoji/punctuation and collapses whitespace so the match focuses on
// the words the person actually typed, not the decorative emoji.
function normalizeForMatch(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// Allows a small typo margin (a few characters) so the challenge is
// friction, not a frustrating exact-match trap.
export function isChallengeMatch(input, target) {
  const a = normalizeForMatch(input);
  const b = normalizeForMatch(target);
  if (!a) return false;
  const dist = levenshtein(a, b);
  const tolerance = Math.max(4, Math.floor(b.length * 0.03));
  return dist <= tolerance;
}
