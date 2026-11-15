// Run with: node --test tests/daily-word.test.js
// The Daily Word (frontend/daily.js): one word a day, the same for everyone, from words.json.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const D = require("../frontend/daily.js");

const WORDS_FILE = path.join(__dirname, "../frontend/words.json");
const words = fs.existsSync(WORDS_FILE) ? JSON.parse(fs.readFileSync(WORDS_FILE, "utf8")) : D.FALLBACK_WORDS;

test("the same date gives the same word, for everyone", () => {
  assert.deepEqual(D.wordOfTheDay("2026-11-15", words), D.wordOfTheDay("2026-11-15", JSON.parse(JSON.stringify(words))));
});

test("the word comes from the category the die lands on", () => {
  for (let d = 1; d <= 28; d++) {
    const day = `2026-02-${String(d).padStart(2, "0")}`;
    const { category, word } = D.wordOfTheDay(day, words);
    assert.ok(D.CATEGORIES.includes(category), category);
    assert.ok(D.cleanWords(words)[category].includes(word), `${word} is in ${category}`);
  }
});

test("different days land on different categories and words", () => {
  const cats = new Set(), picks = new Set();
  for (let d = 1; d <= 30; d++) {
    const w = D.wordOfTheDay(`2026-09-${String(d).padStart(2, "0")}`, words);
    cats.add(w.category); picks.add(w.word);
  }
  assert.ok(cats.size >= 4, `only ${cats.size} categories in a month`);
  const total = Object.values(D.cleanWords(words)).reduce((n, l) => n + l.length, 0);
  assert.ok(picks.size >= Math.min(20, Math.floor(total / 2)), `only ${picks.size} different words in a month`);
});

test("a missing or broken word list still gives a word (the built-in fallback)", () => {
  for (const bad of [null, undefined, {}, { Animal: [] }, { Nope: ["x"] }, "words", { Animal: [42, "  "] }]) {
    const w = D.wordOfTheDay("2026-11-15", bad);
    assert.ok(D.FALLBACK_WORDS[w.category].includes(w.word));
  }
});

test("the list is cleaned: unknown categories, blanks and repeats are dropped", () => {
  const clean = D.cleanWords({ Animal: [" a cat ", "a cat", "", 7], Snacks: ["chips"] });
  assert.deepEqual(clean, { Animal: ["a cat"] });
  assert.deepEqual(D.wordOfTheDay("2026-11-15", { Animal: ["a cat"] }), { category: "Animal", word: "a cat" });
  assert.deepEqual(D.cleanWords({ note: "hi", categories: { food: ["a pie"], silly: ["a hat"] } }), { Food: ["a pie"], Silly: ["a hat"] }, "wrapped, lower-case names");
});

test("Quick draw picks a real word and avoids repeating the last one", () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 50; i++) {
    const w = D.randomWord(words, { rand });
    assert.ok(D.cleanWords(words)[w.category].includes(w.word));
  }
  const two = { Food: ["a taco", "a pie"] };
  for (let i = 0; i < 20; i++) assert.equal(D.randomWord(two, { rand, avoid: "a taco" }).word, "a pie");
  assert.equal(D.randomWord({ Food: ["a taco"] }, { avoid: "a taco" }).word, "a taco", "with one word there is no choice");
});

test("a word is saved in the old prompts shape, and read back", () => {
  const prompts = D.promptOf({ category: "Silly", word: "a pizza wearing sunglasses" });
  assert.deepEqual(prompts, [{ label: "Silly", value: "a pizza wearing sunglasses", optional: false }]);
  assert.equal(D.wordOf(prompts), "a pizza wearing sunglasses");
  assert.equal(D.isWordPrompt(prompts), true);
  assert.equal(D.isWordPrompt([{ label: "Head", value: "Parrot" }, { label: "Tail", value: "Fox" }]), false, "old animal parts");
  assert.equal(D.wordOf([{ label: "Head", value: "Parrot" }, { label: "Tail", value: "Fox" }]), "Parrot, Fox");
});

test("if words.json exists it has the six categories, each with plenty of words", { skip: !fs.existsSync(WORDS_FILE) }, () => {
  const clean = D.cleanWords(words);
  for (const cat of D.CATEGORIES) assert.ok(clean[cat] && clean[cat].length >= 40, `${cat}: ${clean[cat] && clean[cat].length}`);
});

test("a compound's non-breaking space (kept whole on the tiles) is saved, shown and shared as a normal space", () => {
  const Draw = require("../frontend/drawing.js");
  const prompts = D.promptOf({ category: "Food", word: "a dinosaur eating ice cream" });
  assert.equal(prompts[0].value, "a dinosaur eating ice cream");
  assert.equal(D.wordOf([{ label: "Food", value: "ice cream" }]), "ice cream");
  const line = Draw.shareLine({ mode: "daily", daily: false, prompts: [{ label: "Food", value: "a hot dog" }], day: "2026-11-15" }, "https://example.test");
  assert.ok(!line.includes(" ") && line.includes("a hot dog"), line);
});
