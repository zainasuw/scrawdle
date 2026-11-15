// Run with: node --test tests/party-rules.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../frontend/party-rules.js");

const words = JSON.parse(fs.readFileSync(path.join(__dirname, "../frontend/words.json"), "utf8"));
const counter = (seed = 7) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test("words.json has the six dice categories, at least 40 different words each, none repeated anywhere", () => {
  assert.deepEqual(Object.keys(words.categories).sort(), R.CATEGORIES.slice().sort());
  const all = [];
  for (const c of R.CATEGORIES) {
    const list = words.categories[c];
    assert.ok(list.length >= 40, `${c} has ${list.length}`);
    for (const w of list) {
      assert.equal(typeof w, "string");
      assert.ok(w.trim() === w && w.length >= 3 && w.length <= 40, `${JSON.stringify(w)} is a short phrase`);
    }
    all.push(...list);
  }
  assert.equal(new Set(all).size, all.length, "no word is in two places");
});

test("settings the host didn't pick, or that aren't offered, fall back to the defaults", () => {
  assert.deepEqual(R.cleanSettings({ rounds: 5, seconds: 30, hostPlays: true }), { rounds: 5, seconds: 30 }); // the TV never plays
  assert.deepEqual(R.cleanSettings({ rounds: 99, seconds: "60" }), R.DEFAULTS);
  assert.deepEqual(R.cleanSettings(null), R.DEFAULTS);
  assert.deepEqual(R.DEFAULTS, { rounds: 3, seconds: 60 });
});

test("a roll picks a category and a word from that category", () => {
  for (let i = 0; i < 50; i++) {
    const { category, word } = R.rollWord(words, counter(i + 1));
    assert.ok(R.CATEGORIES.includes(category));
    assert.ok(words.categories[category].includes(word));
  }
  assert.equal(R.rollWord(words, () => 0).category, R.CATEGORIES[0]);
  assert.equal(R.rollWord(words, () => 0.99999).category, R.CATEGORIES.at(-1), "never past the end");
});

test("a game doesn't repeat a word until a category runs out", () => {
  const used = [];
  const rand = counter(3);
  for (let i = 0; i < 42; i++) used.push(R.wordFor(words, "silly", rand, used));
  assert.equal(new Set(used).size, 42);
  assert.ok(words.categories.silly.includes(R.wordFor(words, "silly", rand, used)), "after all are used, any word again");
  assert.equal(R.wordFor(words, "nope", rand), null);
});

test("the daily word is the same all day for everyone, and changes between days", () => {
  const a = R.dailyWord(words, "2026-11-15");
  assert.deepEqual(R.dailyWord(words, "2026-11-15"), a);
  assert.ok(words.categories[a.category].includes(a.word));
  const week = new Set(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"].map((d) => R.dailyWord(words, d).word));
  assert.ok(week.size >= 4, "different days give different words");
});

test("you can't vote for your own drawing, or for one that isn't in the round", () => {
  const owners = ["ana", "ben", "cal"];
  assert.equal(R.canVote("ana", "ben", owners), true);
  assert.equal(R.canVote("ana", "ana", owners), false);
  assert.equal(R.canVote("ana", "zed", owners), false);
  assert.equal(R.canVote("host", "cal", owners), true, "someone who didn't draw may vote by this rule (party.js decides who the voters are)");
  assert.equal(R.canVote("ana", null, owners), false);
});

test("each vote is 100 points and the top drawing gets a 50 point bonus", () => {
  const owners = ["ana", "ben", "cal"];
  const r = R.scoreRound(owners, { ana: "ben", ben: "cal", cal: "ben", dan: "ben", eve: "eve" });
  assert.deepEqual(r.votes, { ana: 0, ben: 3, cal: 1 });
  assert.deepEqual(r.top, ["ben"]);
  assert.deepEqual(r.points, { ana: 0, ben: 350, cal: 100 });
});

test("a tie for the top shares the bonus; no votes means no bonus", () => {
  const owners = ["ana", "ben", "cal"];
  const tie = R.scoreRound(owners, { ana: "ben", ben: "ana", cal: "ana", x: "ben" });
  assert.deepEqual(tie.top, ["ana", "ben"]);
  assert.deepEqual(tie.points, { ana: 250, ben: 250, cal: 0 });
  const none = R.scoreRound(owners, {});
  assert.deepEqual(none.top, []);
  assert.deepEqual(none.points, { ana: 0, ben: 0, cal: 0 });
});

test("self-votes don't count, so a player can't score by voting for themselves", () => {
  assert.deepEqual(R.scoreRound(["ana", "ben"], { ana: "ana", ben: "ben" }).points, { ana: 0, ben: 0 });
});

test("scores add up over rounds", () => {
  let scores = {};
  scores = R.addScores(scores, { ana: 350, ben: 0 });
  scores = R.addScores(scores, { ana: 100, ben: 250, cal: 100 });
  assert.deepEqual(scores, { ana: 450, ben: 250, cal: 100 });
});

test("standings put the most points first and share places on a tie", () => {
  const names = { a: "Ana", b: "Ben", c: "Cal", d: "Dee" };
  const rows = R.standings({ a: 300, b: 500, c: 300, d: 0 }, names);
  assert.deepEqual(rows.map((r) => [r.name, r.place]), [["Ben", 1], ["Ana", 2], ["Cal", 2], ["Dee", 4]]);
});

test("ordinals read naturally", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(R.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
});

test("the host is the TV and never draws (a host who plays joins on a phone)", () => {
  assert.deepEqual(R.drawers(["h", "a", "b"], "h"), ["a", "b"]);
  assert.deepEqual(R.drawers(["h", "a", "b"], "h", true), ["a", "b"]); // an old "host plays" flag is ignored: the TV never draws
  assert.equal(R.drawers(["h", ...Array.from({ length: 12 }, (_, i) => `p${i}`)], "h").length, R.MAX_PLAYERS);
});

test("drawing letters and shuffles", () => {
  assert.deepEqual([0, 1, 7].map(R.label), ["A", "B", "H"]);
  const ids = ["a", "b", "c", "d", "e"];
  const out = R.shuffled(ids, counter(3));
  assert.deepEqual(out.slice().sort(), ids);
  assert.deepEqual(ids, ["a", "b", "c", "d", "e"], "the original is left alone");
});

test("a round ends when everyone still here is done, and players who left aren't waited for", () => {
  assert.equal(R.everyoneDone(["a", "b", "c"], ["a", "b", "c"], ["a", "b"]), false);
  assert.equal(R.everyoneDone(["a", "b", "c"], ["a", "b"], ["a", "b"]), true);
  assert.equal(R.everyoneDone(["a"], [], []), false, "nobody left means nothing to finish");
});

test("every player gets a different avatar, the same on every screen", () => {
  const ids = ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"];
  const picks = R.seats(ids, 8);
  assert.equal(new Set(picks).size, 8);
  assert.deepEqual(R.seats(ids, 8), picks);
});

test("the word board: balanced rows, articles stay with their word, no lone short word or narrow middle word", () => {
  const show = (rows) => rows.map((r) => r.join(" ")).join(" / ");
  assert.equal(show(R.balancedRows("a sneeze that blew the roof off", 3)), "a sneeze / that blew / the roof off");
  assert.equal(show(R.balancedRows("a snail in a hurry", 2)), "a snail / in a hurry");
  assert.equal(R.balancedRows("a snail in a hurry", 3), null); // only "a snail / in / a hurry" would do, and "in" can't stand alone
  assert.equal(show(R.balancedRows("an elephant taking a shower", 3)), "an elephant / taking / a shower"); // a long word may stand alone
  assert.equal(show(R.balancedRows("pizza", 1)), "pizza");
  const phone = (w) => Math.min(46, Math.floor(300 / (w * 0.92)));
  const phrases = Object.values(words.categories).flat();
  let smallest = Infinity;
  for (const w of phrases) {
    const rows = R.wordRows(w, { size: phone, enough: 32 });
    assert.ok(rows.length >= 1 && rows.length <= 3, w);
    assert.equal(R.plainWord(rows.flat().join(" ")), R.plainWord(w).split(/ +/).join(" "), w); // every word, in order
    for (const r of rows) assert.ok(!["a", "an", "the"].includes(r[r.length - 1].toLowerCase()), `${w}: an article ends a row`);
    if (rows.length > 1) for (const r of rows) assert.ok(!(r.length === 1 && r[0].length <= 3), `${w}: a lone short word`);
    smallest = Math.min(smallest, phone(Math.max(...rows.map((r) => R.rowWidth(r)))));
  }
  assert.ok(smallest >= 23, `tiles down to ${smallest}px`);
});

test("compounds in words.json (joined by a non-breaking space) are never split inside a longer phrase", () => {
  const phone = (w) => Math.min(46, Math.floor(300 / (w * 0.92)));
  const NBSP = "\u00a0";
  const phrases = Object.values(words.categories).flat();
  assert.ok(phrases.filter((w) => w.includes(NBSP)).length >= 40, "the compounds are marked");
  for (const pair of ["ice cream", "polar bear", "ice cube", "hot air", "hot dog"]) assert.ok(phrases.some((w) => w.includes(pair.replace(" ", NBSP))), pair);
  for (const w of phrases.filter((x) => x.includes(NBSP) && R.wordUnits(x).length > 1)) {
    const rows = R.wordRows(w, { size: phone, enough: 32 });
    for (const compound of w.split(" ").filter((x) => x.includes(NBSP))) assert.ok(rows.some((r) => r.includes(compound)), `${w}: "${R.plainWord(compound)}" was split`);
  }
  assert.equal(R.plainWord(`a dinosaur eating ice${NBSP}cream`), "a dinosaur eating ice cream");
  assert.equal(R.rowWidth([`ice${NBSP}cream`]), R.rowWidth(["ice", "cream"])); // a compound is as wide as its two words
});
