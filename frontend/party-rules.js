/* Scrawdle Party's rules and the word picking, kept apart from the screens so they can be tested in Node
 * (tests/party-rules.test.js). party.js is the game itself; words.json holds the words; dice.js rolls the die.
 *
 * THE GAME: a die with six category faces picks a category, then one word or short phrase from that category
 * (words.json) is what everyone draws. Then everyone votes for ONE favourite drawing (never their own; drawings
 * are shown without names). Each vote received is VOTE_POINTS; the round's top drawing (the most votes, ties
 * share it, and it needs at least one vote) also gets TOP_BONUS.
 *
 * WORDS (also for the solo screens): words.json is { categories: { animal: [...], food: [...], ... } }.
 *   rollWord(words, random, used)  -> { category, word }   a random category, then a random word in it not in `used`
 *   wordFor(words, category, random, used) -> word         a random word from one category
 *   dailyWord(words, "YYYY-MM-DD") -> { category, word }   the same for everyone on that day */
(function (root) {
  "use strict";

  const CATEGORIES = ["animal", "food", "silly", "place", "thing", "wild"];
  const OPTIONS = { rounds: [3, 5], seconds: [30, 60, 90] };
  const DEFAULTS = { rounds: 3, seconds: 60 };
  const MAX_PLAYERS = 8;
  const MIN_DRAWERS = 2;     // voting needs someone else's drawing to vote for
  const VOTE_SECONDS = 30;
  const GRACE_SECONDS = 5;   // how long the host waits past a timer for late drawings or votes
  const VOTE_POINTS = 100;
  const TOP_BONUS = 50;
  const NEXT_SECONDS = 8;    // after the scores, the next round (or the podium) starts on its own after this long

  // A drawing travels as one message (Supabase's free plan allows 256 KB per message). party.js tries these
  // in order and sends the first that fits. The party canvas is square.
  const MAX_IMAGE_CHARS = 230000;
  const ENCODE_STEPS = [
    { type: "image/webp", quality: 0.8, width: 800 },
    { type: "image/jpeg", quality: 0.8, width: 800 },
    { type: "image/jpeg", quality: 0.6, width: 800 },
    { type: "image/jpeg", quality: 0.45, width: 700 },
    { type: "image/jpeg", quality: 0.4, width: 560 },
  ];

  // Anything the host didn't choose, or a value that isn't offered, falls back to the default.
  function cleanSettings(s) {
    const pick = (key) => (s && OPTIONS[key].includes(s[key]) ? s[key] : DEFAULTS[key]);
    return { rounds: pick("rounds"), seconds: pick("seconds") };
  }

  const at = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const listOf = (words, category) => (words && words.categories && Array.isArray(words.categories[category]) ? words.categories[category] : []);

  function wordFor(words, category, random = Math.random, used = []) {
    const all = listOf(words, category);
    const fresh = all.filter((w) => !used.includes(w));
    return all.length ? at(fresh.length ? fresh : all, random) : null;
  }

  function rollWord(words, random = Math.random, used = []) {
    const category = at(CATEGORIES.filter((c) => listOf(words, c).length), random) || CATEGORIES[0];
    return { category, word: wordFor(words, category, random, used) };
  }

  // A small seeded generator, so a day always gives the same category and word.
  function seeded(text) {
    let h = 2166136261;
    for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    let seed = h;
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dailyWord(words, day) {
    return rollWord(words, seeded(`scrawdle-daily-word|${day}`));
  }

  // A shuffled copy, so drawings show in a different order from the player list while voting (the host
  // shuffles once and sends the order, so every screen shows the same one).
  function shuffled(items, random = Math.random) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // The letter on each anonymous drawing: A, B, C...
  const label = (i) => String.fromCharCode(65 + i);

  // A vote counts when it is for a drawing in this round and not the voter's own.
  function canVote(voter, owner, owners) {
    return typeof owner === "string" && owner !== voter && Array.isArray(owners) && owners.includes(owner);
  }

  // picks: { voterId: ownerId }. One vote per voter; votes that don't count are dropped.
  function countVotes(owners, picks) {
    const votes = {};
    for (const id of owners) votes[id] = 0;
    for (const [voter, owner] of Object.entries(picks || {})) if (canVote(voter, owner, owners)) votes[owner]++;
    return votes;
  }

  function scoreRound(owners, picks) {
    const votes = countVotes(owners, picks);
    const most = Math.max(0, ...owners.map((id) => votes[id]));
    const top = most > 0 ? owners.filter((id) => votes[id] === most) : [];
    const points = {};
    for (const id of owners) points[id] = votes[id] * VOTE_POINTS + (top.includes(id) ? TOP_BONUS : 0);
    return { votes, points, top };
  }

  function addScores(scores, points) {
    const out = { ...scores };
    for (const [id, p] of Object.entries(points || {})) out[id] = (out[id] || 0) + (Number(p) || 0);
    return out;
  }

  // Highest points first. Players with the same points share a place (1, 2, 2, 4).
  function standings(scores, names) {
    const list = Object.entries(scores || {})
      .map(([id, points]) => ({ id, name: (names && names[id]) || "Player", points }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    list.forEach((row, i) => { row.place = i > 0 && row.points === list[i - 1].points ? list[i - 1].place : i + 1; });
    return list;
  }

  // "1st", "2nd", "3rd", "4th"...
  function ordinal(n) {
    const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th";
    return `${n}${s}`;
  }

  // True once every player still here who is in this round is done. Players who left aren't waited for.
  function everyoneDone(roundPlayers, presentIds, doneIds) {
    const waiting = roundPlayers.filter((id) => presentIds.includes(id));
    return waiting.length > 0 && waiting.every((id) => doneIds.includes(id));
  }

  /* ---------- After the scores: the show moves on by itself ----------
   * The TV shows the scores, then counts down NEXT_SECONDS and rolls the next round (after the last round: the
   * podium) without anyone touching it. Its gold key still goes early. The host tells the phones how many seconds
   * are left (not a clock time: phones' clocks differ), and each phone counts down from when the message lands. */
  // What comes after round `round` of `total`: another round, or the podium.
  const afterScores = (round, total) => (Number(round) >= Number(total) ? "final" : "round");
  // Whole seconds left until endsAt (ms), never below zero. A countdown shows 8, 7 ... 1 and acts at 0.
  const secondsLeft = (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000));
  // The seconds a "next" message carries, kept sane: a whole number from 1 to 30, else the default.
  function cleanNextSeconds(s) {
    const n = Math.round(Number(s));
    return Number.isFinite(n) && n >= 1 && n <= 30 ? n : NEXT_SECONDS;
  }
  // The phones' line while the TV counts down. Never a promise the game can't keep: it names what comes next.
  const nextCall = (next) => (next === "final" ? "Winner revealed in" : "Next round in");

  // Who draws: everyone in the room except the host's TV, which only shows the game (a host who wants to play
  // joins on their phone like anyone else). Never more than MAX_PLAYERS.
  function drawers(playerIds, hostId) {
    return playerIds.filter((id) => id !== hostId).slice(0, MAX_PLAYERS);
  }

  // Which avatar (0..count-1) each player gets: a hash of their id, stepped past any taken by someone who joined
  // earlier, so no two share one and every screen agrees.
  function seats(ids, count) {
    const taken = new Set();
    return ids.map((id) => {
      let h = 0;
      for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      let i = h % count;
      while (taken.has(i) && taken.size < count) i = (i + 1) % count;
      taken.add(i);
      return i;
    });
  }

  /* ---------- The word on flip tiles: balanced rows ----------
   * A phrase is set in 1 to 3 rows of tiles, never wrapped by chance. An article (a, an, the) always stays with the
   * word after it. Of the ways to cut the phrase into a given number of rows, the one whose widest row is narrowest
   * wins (then the most even one). No row may be one short word on its own (in, on, of, cat…) and no middle row may
   * be one word much narrower than the rest, so you never get
   * "A SNEEZE THAT / BLEW / THE ROOF OFF": you get "A SNEEZE / THAT BLEW / THE ROOF OFF". A long word (5 letters or
   * more) may have a row to itself ("AN ELEPHANT / TAKING / A SHOWER"). A compound joined by a non-breaking space
   * in words.json ("ice cream", "polar bear") is one word here and never split. Widths are in tiles; a space between
   * words counts as `gap` of a tile. */
  const NBSP = "\u00a0";
  // The word as people read and share it: a compound's non-breaking space becomes a normal one.
  const plainWord = (word) => String(word).split(NBSP).join(" ");
  const letters = (word) => word.split(NBSP).join("").length;
  const ARTICLES = new Set(["a", "an", "the"]);
  function wordUnits(phrase) {
    const words = String(phrase).split(/ +/).filter(Boolean), units = []; // ordinary spaces only: a compound stays whole
    for (let k = 0; k < words.length; k++) {
      if (ARTICLES.has(words[k].toLowerCase()) && k + 1 < words.length) { units.push([words[k], words[k + 1]]); k++; } else units.push([words[k]]);
    }
    return units;
  }
  const rowWidth = (row, gap = 0.4) => row.reduce((n, w) => n + letters(w), 0) + (row.length - 1 + row.reduce((n, w) => n + w.split(NBSP).length - 1, 0)) * gap;
  // Exactly `count` rows (each an array of words), or null when the phrase can't be cut that way.
  function balancedRows(phrase, count, gap = 0.4) {
    const units = wordUnits(phrase), n = units.length;
    if (count < 1 || count > n) return null;
    let best = null;
    const cut = (start, left, rows) => {
      if (left === 1) {
        const all = [...rows, units.slice(start).flat()];
        // never a short word (3 letters or fewer) alone on a row, nor a 4-letter word alone on a middle row much
        // narrower than the widest row ("A SNEEZE THAT / BLEW / THE ROOF OFF"); a word of 5 letters or more may
        // stand alone anywhere ("A CHICKEN / CROSSING / THE ROAD", "AN ELEPHANT / TAKING / A SHOWER")
        const widths = all.map((r) => rowWidth(r, gap)), widest = Math.max(...widths);
        const lone = (r, i) => r.length === 1 && (letters(r[0]) <= 3 || (letters(r[0]) < 5 && i > 0 && i < count - 1 && widths[i] < widest * 0.7));
        if (count > 1 && all.some(lone)) return;
        const score = [widest, widths.reduce((a, w) => a + w * w, 0)];
        if (!best || score[0] < best.score[0] - 1e-9 || (Math.abs(score[0] - best.score[0]) < 1e-9 && score[1] < best.score[1])) best = { rows: all, score };
        return;
      }
      for (let end = start + 1; end <= n - (left - 1); end++) cut(end, left - 1, [...rows, units.slice(start, end).flat()]);
    };
    cut(0, count, []);
    return best && best.rows;
  }
  // The rows to use: the row count (up to maxRows) whose tiles come out biggest by `size(widestRow, rowCount)`.
  // Another row has to buy at least `gain` (8%) more tile size, and once the tiles reach `enough` no row is added,
  // so a phrase that already sets well stays on fewer rows. A compound only gives way as a last resort: when the
  // whole phrase is the compound ("a watermelon slice"), its one row comes out under three quarters of `enough`,
  // and breaking it buys a quarter more tile size, it may break like any two words ("A WATERMELON / SLICE"). Inside a longer phrase it never
  // breaks ("A POLAR BEAR / ON AN ICE CUBE").
  function wordRows(phrase, { maxRows = 3, gap = 0.4, size = (w) => 1 / w, gain = 1.08, enough = Infinity } = {}) {
    const choose = (text) => {
      let pick = null;
      for (let k = 1; k <= maxRows; k++) {
        if (pick && pick.size >= enough) break;
        const rows = balancedRows(text, k, gap);
        if (!rows) continue;
        const s = size(Math.max(...rows.map((r) => rowWidth(r, gap))), k);
        if (!pick || s > pick.size * gain) pick = { rows, size: s };
      }
      return pick;
    };
    let pick = choose(phrase);
    if (String(phrase).includes(NBSP) && wordUnits(phrase).length === 1 && (!pick || pick.size < enough * 0.75)) {
      const loose = choose(plainWord(phrase));
      if (loose && (!pick || loose.size >= pick.size * 1.25)) pick = loose;
    }
    return pick ? pick.rows : [String(phrase).split(/ +/).filter(Boolean)];
  }

  const api = { CATEGORIES, OPTIONS, DEFAULTS, MAX_PLAYERS, MIN_DRAWERS, VOTE_SECONDS, GRACE_SECONDS, VOTE_POINTS, TOP_BONUS, NEXT_SECONDS, MAX_IMAGE_CHARS, ENCODE_STEPS,
    afterScores, secondsLeft, cleanNextSeconds, nextCall, cleanSettings, wordFor, rollWord, dailyWord, shuffled, label, canVote, countVotes, scoreRound, addScores, standings, ordinal, everyoneDone, drawers, seats, wordUnits, rowWidth, balancedRows, wordRows, plainWord, NBSP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScrawdlePartyRules = api;
})(typeof window !== "undefined" ? window : globalThis);
