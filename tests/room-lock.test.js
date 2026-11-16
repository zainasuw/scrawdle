// Run with: node --test tests/room-lock.test.js
// Who may come into a party room (frontend/lobby.js): once the game starts the room locks (nobody new; players
// already in it can drop out and come back), Play again opens it, and a phone the host removed stays out today.
const test = require("node:test");
const assert = require("node:assert/strict");
const { playersFromState, cleanLock, lockList, roomLock, lockedOut, joinBlock, rememberKick, BLOCK_MESSAGES, LOCK_MAX,
  roomIsFull, cleanAsk, askDecision, openAsks, askAgainIn, ASK_COOLDOWN_MS, ASK_MAX_AGE_MS, MAX_PLAYERS } = require("../frontend/lobby.js");

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
  assert.equal(BLOCK_MESSAGES.started.text, "Ask the host to let you in, or draw on your own.");
  assert.equal(BLOCK_MESSAGES.waiting.title, "Waiting for the host to let you in\u2026");
  assert.equal(BLOCK_MESSAGES.notnow.title, "The host can't let you in right now.");
  assert.ok(!/start a new room/i.test(JSON.stringify(BLOCK_MESSAGES)), "never asks a child to break up a game");
  for (const m of Object.values(BLOCK_MESSAGES)) assert.ok(m.title.length < 60 && m.text.length < 80);
});

/* ---------- Asking to join a game that has started ---------- */
const lockedRoom = (ids, present = ids) => {
  const state = { tv: entry("tv", 1, ["tv", ...ids]) };
  present.forEach((id, i) => { state[id] = entry(id, 2 + i); });
  return playersFromState(state);
};

test("a full room says so (counting players who dropped out and may come back) instead of asking the host", () => {
  const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
  assert.equal(MAX_PLAYERS, 9, "the TV and 8 players");
  assert.equal(roomIsFull(lockedRoom(eight)), true);
  assert.equal(roomIsFull(lockedRoom(eight, ["a", "b"])), true, "six of them dropped out, but their places are kept");
  assert.equal(roomIsFull(lockedRoom(["a", "b", "c"])), false);
  assert.equal(joinBlock({ kicks: {}, code: "BKQZ", day: "d", players: lockedRoom(eight), me: "zed" }), "full");
  assert.equal(joinBlock({ kicks: {}, code: "BKQZ", day: "d", players: lockedRoom(["a"]), me: "zed" }), "started");
});

test("a request is tidied: an id is needed, the name is cleaned", () => {
  assert.deepEqual(cleanAsk({ id: "zed", name: "  Zed   Z  " }), { id: "zed", name: "Zed Z" });
  assert.deepEqual(cleanAsk({ id: "zed" }), { id: "zed", name: "Player" });
  for (const bad of [null, {}, { id: 5 }, { id: "" }, { id: "x".repeat(81) }]) assert.equal(cleanAsk(bad), null);
});

test("the host queues a new request, and answers or ignores the rest", () => {
  const players = lockedRoom(["ann", "ben"]);
  const base = { players, removed: new Set(), pending: new Map(), deniedAt: new Map(), now: 1000000 };
  assert.equal(askDecision({ ...base, ask: { id: "zed", name: "Zed" } }), "queue");
  assert.equal(askDecision({ ...base, ask: { id: "ann" } }), "in", "already in the game: just let them in");
  assert.equal(askDecision({ ...base, ask: { id: "zed" }, removed: new Set(["zed"]) }), "removed", "a removed player can't ask");
  assert.equal(askDecision({ ...base, ask: { id: "zed" }, pending: new Map([["zed", {}]]) }), "pending", "one request at a time");
  assert.equal(askDecision({ ...base, ask: { id: "zed" }, deniedAt: new Map([["zed", 1000000 - 5000]]) }), "cooldown", "not straight after a Not now");
  assert.equal(askDecision({ ...base, ask: { id: "zed" }, deniedAt: new Map([["zed", 1000000 - ASK_COOLDOWN_MS]]) }), "queue", "after the wait, again");
  assert.equal(askDecision({ ...base, ask: { id: "zed" }, players: lockedRoom(["a", "b", "c", "d", "e", "f", "g", "h"]) }), "full");
  assert.equal(askDecision({ ...base, ask: { id: "zed" }, players: playersFromState({ tv: entry("tv", 1) }) }), "open", "an open room needs no asking");
  assert.equal(askDecision({ ...base, ask: { name: "no id" } }), "bad");
});

test("Let in puts the phone on the lock's list; it's then let through, and a removed player never is", () => {
  const before = lockedRoom(["ann"]);
  const list = lockList([...roomLock(before), "zed"], new Set());
  const after = playersFromState({ tv: entry("tv", 1, list), ann: entry("ann", 2) });
  assert.equal(lockedOut(before, "zed"), true);
  assert.equal(lockedOut(after, "zed"), false);
  assert.deepEqual(lockList([...roomLock(before), "zed"], new Set(["zed"])), ["tv", "ann"], "the list leaves out anyone removed");
});

test("waiting requests come oldest first, and old ones are dropped", () => {
  const now = 10 * ASK_MAX_AGE_MS;
  const asks = [{ id: "b", at: now - 2000 }, { id: "a", at: now - 5000 }, { id: "old", at: now - ASK_MAX_AGE_MS - 1 }];
  assert.deepEqual(openAsks(asks, now).map((a) => a.id), ["a", "b"]);
  assert.deepEqual(openAsks(new Map([["x", { id: "x", at: now }]]).values(), now).map((a) => a.id), ["x"]);
  assert.deepEqual(openAsks(null, now), []);
});

test("after a Not now, Ask again counts down from the cooldown to zero", () => {
  assert.equal(askAgainIn(1000, 1000), ASK_COOLDOWN_MS / 1000);
  assert.equal(askAgainIn(1000, 1000 + ASK_COOLDOWN_MS - 1500), 2);
  assert.equal(askAgainIn(1000, 1000 + ASK_COOLDOWN_MS), 0);
  assert.equal(askAgainIn(0, 1e12), 0, "never told Not now");
});
