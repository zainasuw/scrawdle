/* The Daily Word: one word (or short phrase) a day, the same for everyone, with no server.
 * The pick depends only on the date and the word list (words.json: { "Animal": [...], "Food": [...], ... }), so
 * editing a category's list can change that day's word for anyone who loads it afterward.
 * dailyIndex is also what the older animal-parts days used, so old saved drawings keep making sense. */
(function (root) {
  "use strict";

  // The die's six faces, in a fixed order (the order matters: the day's category is an index into it).
  const CATEGORIES = ["Animal", "Food", "Silly", "Place", "Thing", "Wild"];

  // A few words of each kind, used only if words.json can't load or has nothing usable, so the game still plays.
  const FALLBACK_WORDS = {
    Animal: ["a penguin on a skateboard", "a sleepy cat", "an octopus juggling", "a frog with a crown"],
    Food: ["a dancing taco", "a birthday cake", "a banana in a hammock", "a giant sandwich"],
    Silly: ["a pizza wearing sunglasses", "a cloud with legs", "a sock that can fly", "a teapot with a mustache"],
    Place: ["a treehouse", "a lighthouse at night", "a castle made of cheese", "the moon"],
    Thing: ["a robot", "a hot air balloon", "a magic wand", "a bicycle"],
    Wild: ["a volcano sneezing", "a dragon at the dentist", "a snowman on holiday", "a rainbow waterfall"],
  };

  function dailyIndex(day, partKey, count) {
    let h = 0x811c9dc5;
    for (const ch of `${day}|${partKey}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) % count;
  }

  // Keeps only the six known categories with at least one real word, trimmed, without repeats.
  // Takes { "Animal": [...] } or { "categories": { "animal": [...] } } (category names in any case).
  // Returns the fallback list when nothing usable is left.
  function cleanWords(data) {
    const out = {};
    if (data && typeof data === "object" && data.categories && typeof data.categories === "object") data = data.categories;
    if (data && typeof data === "object") {
      const byName = new Map(Object.keys(data).map((k) => [k.toLowerCase(), data[k]]));
      for (const cat of CATEGORIES) {
        const raw = byName.get(cat.toLowerCase());
        const list = Array.isArray(raw) ? raw : [];
        const words = [...new Set(list.filter((w) => typeof w === "string").map((w) => w.trim()).filter(Boolean))];
        if (words.length) out[cat] = words;
      }
    }
    return Object.keys(out).length ? out : FALLBACK_WORDS;
  }

  const categoriesOf = (words) => CATEGORIES.filter((c) => Array.isArray(words[c]) && words[c].length);

  // Today's { category, word }: first the die's face for the day, then a word from that face.
  function wordOfTheDay(day, data) {
    const words = cleanWords(data);
    const cats = categoriesOf(words);
    const category = cats[dailyIndex(day, "category", cats.length)];
    const list = words[category];
    return { category, word: list[dailyIndex(day, `word|${category}`, list.length)] };
  }

  // A random { category, word } for Quick draw. `avoid` (a word) is not picked again straight away when there's a choice.
  function randomWord(data, { rand = Math.random, avoid = null } = {}) {
    const words = cleanWords(data);
    const cats = categoriesOf(words);
    for (let tries = 0; tries < 8; tries++) {
      const category = cats[Math.floor(rand() * cats.length) % cats.length];
      const list = words[category];
      const word = list[Math.floor(rand() * list.length) % list.length];
      if (word !== avoid || tries === 7) return { category, word };
    }
    return null; // not reached
  }

  // The prompt a drawing is saved and published with: one entry, so it fits the old [{ label, value, optional }] shape.
  // A compound's non-breaking space (words.json: "ice\u00a0cream", kept whole on the tiles) is saved, shown and shared
  // as a normal space.
  const plain = (w) => String(w).replace(/\u00a0/g, " ");
  const promptOf = ({ category, word }) => [{ label: category, value: plain(word), optional: false }];
  // The word of a saved drawing (one word now; older drawings had a list of animal parts).
  const wordOf = (prompts) => (Array.isArray(prompts) ? prompts.map((p) => p && p.value).filter(Boolean).map(plain).join(", ") : "");
  const isWordPrompt = (prompts) => Array.isArray(prompts) && prompts.length === 1 && CATEGORIES.includes(prompts[0] && prompts[0].label);

  // Browser only: loads words.json once (relative to the page). Never throws: a bad or missing file gives the fallback.
  let loaded = null;
  function loadWords(url = "words.json") {
    if (!loaded) {
      loaded = fetch(url, { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((data) => cleanWords(data));
    }
    return loaded;
  }

  const api = { dailyIndex, CATEGORIES, FALLBACK_WORDS, cleanWords, wordOfTheDay, randomWord, promptOf, wordOf, isWordPrompt, loadWords };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScrawdleDaily = api;
})(typeof window !== "undefined" ? window : globalThis);
