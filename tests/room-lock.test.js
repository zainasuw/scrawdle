// Run with: node --test tests/room-lock.test.js
// Who may come into a party room (frontend/lobby.js): once the game starts the room locks (nobody new; players
// already in it can drop out and come back), Play again opens it, and a phone the host removed stays out today.
const test = require("node:test");
const assert = require("node:assert/strict");
const { playersFromState, cleanLock, lockList, roomLock, lockedOut, joinBlock, rememberKick, BLOCK_MESSAGES, LOCK_MAX } = require("../frontend/lobby.js");

const entry = (id, joinedAt, lock) => [{ id, name: id.toUpperCase(), joinedAt, ...(lock !== undefined ? { lock } : {}) }];

test("an open room has no lock, and nobody is locked out", () => {
  const players = playersFromState({ tv: entry("tv", 1), ann: entry("ann", 2) });
  assert.equal(roomLock(players), null);
  assert.equal(lockedOut(players, "newcomer"), false);
  assert.equal("lock" in players[0], false, "an open room's entries look as they always did");
});

test("once the host locks the room, only the players in the game get in", () => {
  const players = playersFromState({ tv: entry("tv", 1, ["tv", "ann", "ben"]), ann: entry("ann", 2) });
  assert.deepEqual(roomLock(players), ["tv", "ann", "ben"]);
  assert.equal(lockedOut(players, "ann"), false, "in the game");
  assert.equal(lockedOut(players, "ben"), false, "in the game, coming back after dropping out");
  assert.equal(lockedOut(players, "newcomer"), true, "a new phone");
  assert.equal(lockedOut(players, "tv"), false, "the host is never locked out");
});

test("only the host's lock counts", () => {
  const players = playersFromState({ tv: entry("tv", 1), ann: entry("ann", 2, ["ann"]) });
  assert.equal(roomLock(players), null);
  assert.equal(lockedOut(players, "newcomer"), false);
});

test("the lock list is everyone seen while the room was open, without anyone removed", () => {
  assert.deepEqual(lockList(["tv", "ann", "ben", "ann", "cal"], new Set(["ben"])), ["tv", "ann", "cal"]);
  assert.deepEqual(lockList(["tv", "ann"], []), ["tv", "ann"]);
  assert.deepEqual(lockList([], null), []);
  assert.equal(lockList(Array.from({ length: 100 }, (_, i) => `p${i}`)).length, LOCK_MAX, "kept to a sane size");
});

test("a lock that arrives malformed is cleaned, and anything that isn't a list is an open room", () => {
  assert.deepEqual(cleanLock(["a", 5, "", null, "b", "x".repeat(200)]), ["a", "b"]);
  for (const v of [null, undefined, "a,b", { a: 1 }, 7, true]) assert.equal(cleanLock(v), null, JSON.stringify(v));
  assert.deepEqual(cleanLock([]), [], "an empty list is a lock with nobody on it");
  const players = playersFromState({ tv: entry("tv", 1, "everyone") });
  assert.equal(lockedOut(players, "anyone"), false);
});

test("Play again opens the room: the host's entry without a lock", () => {
  const locked = playersFromState({ tv: entry("tv", 1, ["tv", "ann"]), ann: entry("ann", 2) });
  const open = playersFromState({ tv: entry("tv", 1), ann: entry("ann", 2) });
  assert.equal(lockedOut(locked, "newcomer"), true);
  assert.equal(lockedOut(open, "newcomer"), false);
});

test("why a phone can't get in: removed by the host comes first, then a game already started", () => {
  const day = "2026-11-15";
  const kicks = rememberKick({}, "BKQZ", day);
  const locked = playersFromState({ tv: entry("tv", 1, ["tv", "ann"]) });
  const open = playersFromState({ tv: entry("tv", 1) });
  assert.equal(joinBlock({ kicks, code: "BKQZ", day, players: locked, me: "ann" }), "removed", "removed beats being on the list");
  assert.equal(joinBlock({ kicks, code: "BKQZ", day, players: open, me: "zed" }), "removed");
  assert.equal(joinBlock({ kicks, code: "BKQZ", day: "2026-11-16", players: open, me: "zed" }), null, "a removal lasts the day");
  assert.equal(joinBlock({ kicks, code: "WXYZ", day, players: open, me: "zed" }), null, "other rooms are fine");
  assert.equal(joinBlock({ kicks: {}, code: "BKQZ", day, players: locked, me: "zed" }), "started");
  assert.equal(joinBlock({ kicks: {}, code: "BKQZ", day, players: locked, me: "ann" }), null, "a returning player");
  assert.equal(joinBlock({ kicks: {}, code: "BKQZ", day }), null, "before the room's state is known");
});

test("the messages are the friendly ones the phones show", () => {
  assert.equal(BLOCK_MESSAGES.removed.title, "The host removed you from this room.");
  assert.equal(BLOCK_MESSAGES.started.title, "This game has already started.");
  assert.equal(BLOCK_MESSAGES.started.text, "Ask the host to start a new room.");
  for (const m of Object.values(BLOCK_MESSAGES)) assert.ok(m.title.length < 60 && m.text.length < 80);
});
