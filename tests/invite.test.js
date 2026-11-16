// Run with: node --test tests/invite.test.js
// The TV lobby's invite options (frontend/invite.js): the room link, the text message, and the QR code made in the
// browser by the vendored encoder (frontend/vendor/qrcode.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const qrcode = require("../frontend/vendor/qrcode.js");
const { inviteLink, inviteText, smsBody, smsHref, qrModules, qrPath, qrSvg } = require("../frontend/invite.js");
const { codeFromSearch } = require("../frontend/lobby.js");

test("the invite link is the site's address with ?CODE, which the join flow reads back", () => {
  assert.equal(inviteLink("https://scrawdle.vercel.app", "/", "BKQZ"), "https://scrawdle.vercel.app/?BKQZ");
  assert.equal(inviteLink("https://scrawdle.vercel.app", "/index.html", "BKQZ"), "https://scrawdle.vercel.app/?BKQZ", "index.html is the same page");
  assert.equal(inviteLink("http://127.0.0.1:8624", "", "BKQZ"), "http://127.0.0.1:8624/?BKQZ");
  assert.equal(inviteLink("https://example.com", "/games/", "BKQZ"), "https://example.com/games/?BKQZ", "a site in a folder keeps its folder");
  assert.equal(codeFromSearch(new URL(inviteLink("https://scrawdle.vercel.app", "/", "BKQZ")).search), "BKQZ");
});

test("the text message is short, friendly, and carries the link whole", () => {
  const link = "https://scrawdle.vercel.app/?BKQZ";
  const body = smsBody(link, "BKQZ");
  assert.ok(body.includes(link));
  assert.ok(body.includes("BKQZ"));
  assert.ok(body.length < 120, "fits one text message");
  const href = smsHref(body);
  assert.ok(href.startsWith("sms:?&body="), "the form iPhone and Android both open");
  assert.equal(decodeURIComponent(href.slice("sms:?&body=".length)), body);
  assert.ok(!/[ :/?&]/.test(href.slice("sms:?&body=".length)), "the body is fully escaped, so the link's ? and & can't break it");
  assert.ok(inviteText("BKQZ").includes("BKQZ"));
});

test("the QR code is a real QR grid: square, a known size, finder patterns in three corners", () => {
  const m = qrModules(qrcode, "https://scrawdle.vercel.app/?BKQZ");
  assert.equal(m.length, 29, "version 3 at error correction M: big modules, easy to scan from across a room");
  for (const row of m) assert.equal(row.length, 29);
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6, core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      assert.equal(m[r0 + r][c0 + c], ring || core, `finder at ${r0},${c0} cell ${r},${c}`);
    }
  };
  finder(0, 0); finder(0, 22); finder(22, 0);
  assert.equal(m[22][22] && m[28][28] && m[22][28] && m[28][22], false, "no finder in the bottom-right corner");
  assert.deepEqual(qrModules(qrcode, "https://scrawdle.vercel.app/?BKQZ"), m, "the same link always gives the same code");
  assert.ok(qrModules(qrcode, "https://a-much-longer-custom-domain.example.com/?BKQZ").length > 29, "a longer link gets a bigger version, not a failure");
});

test("the SVG draws exactly the dark squares, offset by a light quiet zone four squares wide", () => {
  const m = qrModules(qrcode, "http://127.0.0.1:8624/?HTKK");
  const quiet = 4;
  const d = qrPath(m, quiet);
  const drawn = new Set();
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) for (let i = 0; i < +w; i++) drawn.add(`${+y - quiet},${+x - quiet + i}`);
  const dark = new Set();
  m.forEach((row, r) => row.forEach((on, c) => { if (on) dark.add(`${r},${c}`); }));
  assert.deepEqual([...drawn].sort(), [...dark].sort());
  const svg = qrSvg(m, { label: 'Room "HTKK" <link>' });
  const size = m.length + quiet * 2;
  assert.ok(svg.includes(`viewBox="0 0 ${size} ${size}"`));
  assert.ok(svg.includes(`<rect width="${size}" height="${size}" fill="#FFF8E8"/>`), "the quiet zone is light");
  assert.ok(svg.includes('fill="#1B1240"'), "the squares are dark ink");
  assert.ok(svg.includes('aria-label="Room &quot;HTKK&quot; &lt;link&gt;"'), "a label is escaped");
  assert.ok(qrSvg(m).includes('aria-hidden="true"'));
});
