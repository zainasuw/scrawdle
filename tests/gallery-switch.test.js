// Run with: node --test tests/gallery-switch.test.js
// The public gallery (Publish, Public drawings, the leaderboard, likes, reports) is behind one switch,
// publicGallery in frontend/supabase-config.js. Off, publish.js sets none of its hooks, so every screen leaves the
// gallery out; on, they're all back.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const HOOKS = ["scrawdlePublish", "scrawdleGallery", "scrawdleVote", "scrawdleReport", "scrawdleHasPosted", "scrawdlePublicGallery", "scrawdleYesterdayWinners"];

function load(config) {
  const file = path.join(__dirname, "../frontend/publish.js");
  delete require.cache[require.resolve(file)];
  for (const h of HOOKS) delete globalThis[h];
  globalThis.SCRAWDLE_SUPABASE = config;
  globalThis.supabase = { createClient: () => ({}) };
  require(file);
  return Object.fromEntries(HOOKS.map((h) => [h, typeof globalThis[h]]));
}

test("the committed config keeps the project empty and the public gallery off", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../frontend/supabase-config.js"), "utf8"), sandbox);
  const cfg = sandbox.window.SCRAWDLE_SUPABASE;
  assert.equal(cfg.url, "");
  assert.equal(cfg.anonKey, "");
  assert.equal(cfg.publicGallery, false);
});

test("with the switch off (or left out), none of the gallery's hooks exist", () => {
  for (const config of [{ url: "https://example.test", anonKey: "k", publicGallery: false }, { url: "https://example.test", anonKey: "k" }, { url: "https://example.test", anonKey: "k", publicGallery: "yes" }]) {
    const hooks = load(config);
    for (const h of HOOKS) assert.equal(hooks[h], "undefined", `${h} with ${JSON.stringify(config.publicGallery)}`);
  }
  assert.equal(typeof globalThis.scrawdleIsPublished, "function", "what this browser already published is still remembered");
});

test("with the switch on, every gallery hook is back", () => {
  const hooks = load({ url: "https://example.test", anonKey: "k", publicGallery: true });
  for (const h of HOOKS) assert.equal(hooks[h], "function", h);
});

test("with no project at all, the switch changes nothing", () => {
  const hooks = load({ url: "", anonKey: "", publicGallery: true });
  for (const h of HOOKS) assert.equal(hooks[h], "undefined", h);
});
