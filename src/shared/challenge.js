// Lock In — tiny-mammal re-education material for the "prove you mean it"
// challenge shown when Edit Lock is on. A random paragraph is picked each
// time; the source text can't be copied and the input refuses paste, so the
// only way through is to type it by hand and contemplate your choices.

const PRODUCTIVITY_PARAGRAPHS = [
  "attention is tiny mammal currency 🧠🪙 and the internet is extremely good at stealing it one innocent little tab at a time. you blocked this place because something outside the scroll pit matters more right now. finish the useful thing, close the loop, then come back on purpose instead of being vacuumed into twenty minutes of absolutely nothing. future tiny mammal deserves the remaining brain cells 👹🔒",
  "the scroll has no bottom. there is no final post, no ceremonial last video, no sacred point where the feed says congratulations tiny mammal, you have consumed enough internet for today 📱🕳️ the only ending is the one you choose. this block is that ending. return to the task, make one visible piece of progress, and let the algorithm scream alone in its little cave 👹⛏️",
  "a wiser tiny mammal built this fence earlier because current tiny mammal was always going to arrive with a compelling legal argument for why five minutes of distraction is actually mission critical 🧑‍⚖️🐭 the court has reviewed the evidence and denied the appeal. protect the plan you made while your brain was calm. do the work first, renegotiate later 🔒📚",
  "tiny mammal containment is not punishment 🚧🐭 it is just an agreement between two versions of you: one who remembers the goal and one who has suddenly become very interested in opening a forbidden website. the first one installed a lock for a reason. honor the treaty, finish the next concrete step, and earn your intentional break without turning it into an accidental expedition 👹📜",
  "motivation is an unreliable little creature. sometimes it arrives wearing a cape, sometimes it vanishes behind the sofa for six hours 🦸🐭 boundaries are less glamorous and much more useful. this blocked site does not need you to feel inspired; it only needs to stay closed while you do the thing you already decided matters. tiny mammal can complain and continue anyway 🔒⚙️",
  "one tab says come look for a second and suddenly the tiny mammal has crossed three websites, learned a fact nobody requested, watched a stranger organize a refrigerator, and forgotten why the browser was open 👁️👄👁️ this is exactly the ecological niche Lock In was built for. close the side quest. return to the main quest. the refrigerator will survive without you 👹🎮",
  "future tiny mammal is not a mythical employee who wakes up tomorrow with infinite discipline and joyfully finishes everything you postpone today 🌅🐭 future tiny mammal is just you with a different timestamp and potentially less patience. send them something useful: one completed task, one solved bug, one answered message, one small pile of progress instead of another archaeological layer of tabs 🔒📦",
  "rest is good. deliberate recreation is good. staring into an infinite feed while your brain quietly dissolves into soup is a different product entirely 🥣📱 if you need rest, choose rest on purpose. if you need focus, choose focus on purpose. right now you are standing at a gate that past tiny mammal intentionally locked, which is a pretty strong clue about which mode this moment was supposed to be 👹🔐",
  "the tiny mammal brain loves novelty because every new click might contain treasure ✨🐭 unfortunately most treasure chests on the modern internet contain another treasure chest, an advertisement, and twelve comments arguing about something irrelevant. your actual project has finite edges. every minute you give it moves something toward done. choose the world where progress can actually reach one hundred percent 🔒📈",
  "this paragraph is the toll booth between focused tiny mammal and unrestricted tiny mammal 🛂🐭 if the blocked site is genuinely worth reopening, type the toll and make that decision consciously. if the urge starts looking silly halfway through, excellent: the system is working. friction gives your deliberate brain enough time to catch the impulsive one by the tiny shoulders 👹🤏🏻",
  "you do not need a heroic twelve hour grind. the mines are not requesting your soul 👹⛏️ they are requesting one honest chunk of attention. pick the smallest useful next action, do that, then reassess. progress built from ordinary focused minutes is less dramatic than a motivational montage and substantially better at producing finished software, finished study, and finished admin 🐭✅",
  "there is almost never an internet emergency hiding behind this block 🚨🐭 the memes will remain memetic, the discourse will continue without supervision, and somebody else will refresh the timeline on your behalf. meanwhile the thing you wanted to build, learn, fix, or finish can only receive the attention you actually give it. tiny mammal is hereby reassigned to the useful timeline 👹📋",
  "every blocked domain is a little fence around a patch of attention you decided was worth protecting 🌱🔒 fences are not glamorous, but neither is spending an afternoon wondering where the afternoon went. keep the gate shut until the scheduled opening, make something tangible happen on your side of it, and enjoy the deeply suspicious sensation of having used the internet without the internet using you 🐭🧠",
  "current tiny mammal has filed a request to weaken the containment perimeter. previous tiny mammal left extensive documentation stating that current tiny mammal would absolutely do this 👹📑 the conflict of interest is extraordinary. before approving the request, prove you still want it after several sentences of manual typing. bureaucracy has finally achieved something beautiful 🔒🐭",
  "focus does not mean becoming a joyless productivity appliance 🤖❌ it means deciding what gets your attention instead of renting your nervous system to whichever notification arrives wearing the brightest hat. do the meaningful thing while the block is active. when the work window ends, go be a free-range tiny mammal again and enjoy it without the unfinished task chewing on the back of your brain 🐭🌿",
  "a task can feel enormous when it exists as one cloudy object in your head ☁️🐭 so do not defeat the whole beast. open the file. write the function. answer the first email. rename the variable. make the invoice. tiny mammal only needs one foothold to stop sliding. the forbidden website can wait while you manufacture a tiny piece of certainty 👹🧱",
  "the browser is a forest full of shiny objects and the tiny mammal has approximately zero natural resistance to shiny objects 🌲✨🐭 that is not a character flaw; it is why tools like this exist. good systems do not demand perfect self control every minute. they quietly make the useful choice easier and the distracting choice annoying enough to reconsider. congratulations, you are currently experiencing the annoying part 🔒",
  "protecting attention is weird because nothing visibly breaks when you lose five minutes. then five becomes fifteen, fifteen becomes forty, and suddenly the day has been eaten by a sequence of individually harmless snacks 🐭🍪 this block exists to stop the feast before the crumbs become archaeology. keep the site closed, take one bite out of the actual task, and give the day a chance to remain recognizable 👹⏳",
  "tiny mammal has detected boredom and immediately proposed opening the entertainment portal 🐭📡 counterproposal: stay bored for sixty seconds. boredom is often just the doorway between starting and becoming absorbed. if you flee every quiet moment, focus never gets enough runway to take off. keep the gate closed long enough for the useful thing to become interesting again 🔒🛫",
  "there is a special kind of peace in finishing the thing you have been orbiting all day 🛰️🐭 no background guilt, no tiny process consuming memory, no mental notification badge blinking from the corner. this block is not stealing a pleasure from you; it is buying a cleaner future hour. pay with a little focus now and collect the RAM later 👹🧠",
  "you opened settings, found the exact control that would release the distraction, and now a paragraph has appeared between you and freedom. incredible engineering 👁️👄👁️ the tiny mammal who built this system clearly knew the tiny mammal who would use it. respect the craftsmanship. if you still want out after typing this, at least the escape will be an intentional decision rather than a reflex 👹🔓",
  "discipline is frequently just making a useful decision once and then refusing to reopen negotiations every seven minutes 📜🐭 you already made the decision when you created this block. the meeting is adjourned. return to whatever you were doing before the tiny internal lawyer requested another emergency session about checking one completely nonessential website 🔒⚖️",
  "a focused hour is not impressive because it looks intense. it is impressive because almost nothing happens except the thing you meant to do ⏱️🐭 no dramatic montage, no twenty tabs, no productivity cosplay. just a tiny mammal and one task slowly becoming less unfinished. keep the gate closed and let boring consistency perform its suspicious little miracle 👹✨",
  "Lock In cannot write the code, study the chapter, send the invoice, clean the folder, or make the difficult decision for you 🔒🐭 it can only stand at the edge of the distraction swamp holding a tiny stop sign. the remaining move is yours. turn around, choose the next useful action, and make the stop sign feel ridiculously overqualified for its job 👹🛑"
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
