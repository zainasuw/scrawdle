// Run with: node --test tests/leaderboard.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../frontend/leaderboard.js");

const d = (id, up, down = 0, extra = {}) => ({ id, mode: "daily", imageUrl: `x/${id}.png`, votes: { up, down, mine: 0 }, mine: false, ...extra });

test("drawings are ranked by thumbs up, most first", () => {
  const ranked = L.rank([d("a", 1), d("b", 5), d("c", 3)]);
  assert.deepEqual(ranked.map((r) => [r.id, r.place]), [["b", 1], ["c", 2], ["a", 3]]);
});

test("with equal thumbs up, fewer thumbs down ranks higher", () => {
  assert.deepEqual(L.rank([d("a", 3, 2), d("b", 3, 0)]).map((r) => [r.id, r.place]), [["b", 1], ["a", 2]]);
});

test("the same thumbs up and down share a place, and the next place skips (1, 2, 2, 4)", () => {
  const ranked = L.rank([d("a", 5), d("b", 3, 1), d("c", 3, 1), d("e", 1)]);
  assert.deepEqual(ranked.map((r) => r.place), [1, 2, 2, 4]);
});

test("drawings with no thumbs up, or no votes at all, aren't ranked", () => {
  const ranked = L.rank([d("a", 0, 4), d("b", 2), { id: "c", votes: null }, { id: "e" }, null]);
  assert.deepEqual(ranked.map((r) => r.id), ["b"]);
  assert.deepEqual(L.rank([]), []);
  assert.deepEqual(L.rank(null), []);
});

test("ranking leaves the original list alone", () => {
  const items = [d("a", 1), d("b", 2)];
  L.rank(items);
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
  assert.equal("place" in items[0], false);
});

test("your own drawing's standing: its place, unranked, or none", () => {
  const items = [d("a", 5), d("b", 3, 0, { mine: true }), d("c", 1)];
  const ranked = L.rank(items);
  assert.deepEqual(L.myStanding(items, ranked), { place: 2, of: 3 });
  assert.equal(L.standingText(L.myStanding(items, ranked)), "Yours is #2 of 3 today.");
  const unranked = [d("a", 5), d("b", 0, 2, { mine: true })];
  assert.deepEqual(L.myStanding(unranked, L.rank(unranked)), { unranked: true });
  assert.match(L.standingText({ unranked: true }), /no likes yet/);
  assert.equal(L.myStanding([d("a", 5)], L.rank([d("a", 5)])), null);
  assert.equal(L.standingText(null), "");
});

test("Daily Word is the one list, the older Basic and Detailed count as Daily Word, and the retired Daily Doodle has none", () => {
  assert.equal(L.groupOf("daily").label, "Daily Word");
  assert.equal(L.groupOf("basic").label, "Daily Word");
  assert.equal(L.groupOf("detailed").label, "Daily Word");
  assert.equal(L.groupOf("scrawl"), null, "old Daily Doodle rows are left out, not shown under a dead label");
  assert.deepEqual(L.GROUPS.map((g) => g.label), ["Daily Word"]);
  assert.equal(L.groupOf("nope"), null);
  assert.equal(L.TOP, 10);
});

test("the top ten shows every drawing tied for tenth, not just the first of them", () => {
  const ups = [12, 11, 10, 9, 8, 7, 6, 5, 4, 1, 1, 1, 0];
  const ranked = L.rank(ups.map((u, i) => d("x" + i, u)));
  const top = L.topOf(ranked);
  assert.equal(top.length, 12, "three drawings share 10th");
  assert.deepEqual(top.slice(-3).map((r) => r.place), [10, 10, 10]);
  assert.equal(L.topOf(L.rank(ups.slice(0, 5).map((u, i) => d("y" + i, u)))).length, 5, "fewer than ten is fine");
  assert.deepEqual(L.topOf(null), []);
});

/* ---------- Yesterday's winners ---------- */
test("a winner's caption is yesterday's word (older drawings: their parts)", () => {
  assert.equal(L.winnerCaption({ mode: "daily", prompts: [{ value: "Cat" }, { value: "Crab claws" }] }), "Daily Word · Cat, Crab claws");
  assert.equal(L.winnerCaption({ mode: "basic", prompts: [{ value: "Owl" }] }), "Daily Word · Owl", "the older modes count as Daily Scrawl");
  assert.equal(L.winnerCaption({ mode: "daily", prompts: null }), "Daily Word");
  assert.equal(L.winnerCaption(null), "");
});

test("the headline says when your own drawing won, and nothing shows with no winners", () => {
  const w = (daily, free) => ({ day: "2026-11-06", daily, free });
  assert.equal(L.yesterdayHeadline(w([d("a", 3)], [])), "Yesterday's winners");
  assert.equal(L.yesterdayHeadline(w([d("a", 3, 0, { mine: true })], [])), "Your drawing won yesterday!");
  assert.equal(L.yesterdayHeadline(w([d("a", 3)], [d("b", 1, 0, { mine: true })])), "Yesterday's winners", "a leftover Daily Doodle win doesn't count");
  assert.equal(L.yesterdayHeadline(w([], [])), "");
  assert.equal(L.hasWinners(w([], [d("b", 1)])), false, "only a Daily Doodle winner: nothing to show");
  assert.equal(L.hasWinners(w([], [])), false);
  assert.equal(L.hasWinners(null), false, "update 005 not run yet");
});

test("drawings that tie stand on the same podium step, chosen by place, not by position (1, 2, 2)", () => {
  const ranked = L.rank([d("a", 5), d("b", 3), d("c", 3), d("e", 1)]);
  assert.deepEqual(ranked.slice(0, 3).map((r) => L.podiumStep(r.place)), [1, 2, 2]);
  assert.deepEqual(ranked.map((r) => L.isTied(r, ranked)), [false, true, true, false]);
  const allFirst = L.rank([d("a", 2), d("b", 2), d("c", 2)]);
  assert.deepEqual(allFirst.map((r) => L.podiumStep(r.place)), [1, 1, 1], "three-way tie for first: three gold steps");
  assert.equal(L.podiumStep(7), 3);
  assert.equal(L.podiumStep(undefined), 1);
});
