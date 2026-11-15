/* Scrawdle's die: a cream CSS-3D game-show die with a category mark on each of its six faces, landing on a lit stage
 * table (the table is drawn in dice.css). It really rolls (thrown
 * in, tumbling, two bounces, settling on the chosen face) and respects prefers-reduced-motion (it then simply
 * appears on its face). Styles: dice.css. No dependencies; works on any screen.
 *
 * API (window.ScrawdleDice):
 *   ScrawdleDice.roll(container, category, { ms }) -> Promise<category>
 *       Puts a die in `container` (or reuses the one already there) and rolls it onto `category`'s face.
 *       Resolves when it has landed. `ms` is the roll length (default 2200).
 *   ScrawdleDice.show(container, category) -> HTMLElement
 *       The same die resting on that face, no motion (for a screen that comes back after the roll).
 *   ScrawdleDice.CATEGORIES -> [{ id, label, color }]   "animal", "food", "silly", "place", "thing", "wild"
 *   ScrawdleDice.icon(category) -> SVG markup string     the category's mark (for tags, chips, word cards);
 *                                                        give the <svg> a size in CSS.
 *   ScrawdleDice.phrase(category) -> "It's an animal!"   the call when it lands (sentence case, one per category)
 * Size: set --dice-size on the container (default 160px). The die is decorative (aria-hidden); say the
 * category in text next to it. Words to go with a category: ScrawdlePartyRules.rollWord / dailyWord (party-rules.js)
 * and words.json. */
(function (root) {
  "use strict";

  const INK = "#1B1240";
  const CATEGORIES = [
    { id: "animal", label: "Animal", color: "#1ED3C2" },
    { id: "food", label: "Food", color: "#FF8A3D" },
    { id: "silly", label: "Silly", color: "#FFC23D" },
    { id: "place", label: "Place", color: "#8E7BFF" },
    { id: "thing", label: "Thing", color: "#4FB4FF" },
    { id: "wild", label: "Wild", color: "#F2358A" },
  ];
  const byId = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

  // One icon style, printed like the marks on a game-show die: a flat colour disc with a 6px ink outline and the
  // motif in flat fills with ink outlines. No rim and no gloss (the die face carries the shine).
  const disc = (fill) => `<circle cx="50" cy="50" r="43" fill="${fill}" stroke="${INK}" stroke-width="6"/>`;
  const MOTIF = {
    animal: `<path d="M50 53c11 0 19 9 17.5 15.5C66 75 58 73 50 73s-16 2-17.5-4.5C31 62 39 53 50 53z" fill="${INK}"/><ellipse cx="33.5" cy="44" rx="5.6" ry="7.4" fill="${INK}"/><ellipse cx="44.5" cy="35" rx="5.6" ry="7.4" fill="${INK}"/><ellipse cx="56" cy="35" rx="5.6" ry="7.4" fill="${INK}"/><ellipse cx="66.5" cy="44" rx="5.6" ry="7.4" fill="${INK}"/>`,
    food: `<circle cx="50" cy="52" r="22" fill="#FFF4DE" stroke="${INK}" stroke-width="5"/><path d="M30 50c2-10 10-17 20-17s18 7 20 17c-3 4-6 1-9 4s-5-2-8 1-6 0-9 2-6-3-8-1-5-2-6-6z" fill="#F2358A" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/><circle cx="50" cy="52" r="6.5" fill="#FF8A3D" stroke="${INK}" stroke-width="4.5"/><path d="M38 40l3 2M58 38l-2 3M46 36l3-1M62 46l3 1" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
    silly: `<circle cx="36" cy="41" r="9.5" fill="#fff" stroke="${INK}" stroke-width="5"/><circle cx="38.5" cy="43" r="4.2" fill="${INK}"/><path d="M57 39q8-8 16 0" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M30 59q20 15 40-2" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><path d="M51 63q2 15 12.5 11.5q6-3 2-13.5" fill="#F2358A" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>`,
    place: `<path d="M27 50L50 30l23 20" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M33 47v24h34V47L50 32z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><path d="M45 71V58h10v13" fill="#F2358A" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/><rect x="58" y="31" width="7" height="11" fill="${INK}"/>`,
    thing: `<rect x="29" y="43" width="42" height="30" rx="4" fill="#F2358A" stroke="${INK}" stroke-width="5"/><rect x="26" y="35" width="48" height="11" rx="3.5" fill="#F2358A" stroke="${INK}" stroke-width="5"/><path d="M50 35v38" stroke="#fff" stroke-width="7"/><path d="M50 35c-4-9-15-11-15-4s9 5 15 4c6 1 15 3 15-4s-11-5-15 4z" fill="#fff" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>`,
    wild: `<path d="M50 20l8.6 18.6 20.4 2.3-15.2 13.8 4.2 20.1L50 64.6 32 74.8l4.2-20.1L21 40.9l20.4-2.3z" fill="#FFC23D" stroke="${INK}" stroke-width="5.5" stroke-linejoin="round"/><circle cx="44" cy="50" r="2.8" fill="${INK}"/><circle cx="56" cy="50" r="2.8" fill="${INK}"/><path d="M45 57q5 4 10 0" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`,
  };
  // The call when the die lands: one sentence-case phrase per category, the same on the TV, the phones and solo.
  const PHRASE = { animal: "It's an animal!", food: "It's food!", silly: "It's silly!", place: "It's a place!", thing: "It's a thing!", wild: "It's wild!" };
  const phrase = (category) => PHRASE[String(category).toLowerCase()] || PHRASE.wild;
  function icon(category) {
    const c = byId[category] || byId.wild;
    return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">${disc(c.color)}${MOTIF[c.id]}</svg>`;
  }

  // Which face each category is printed on, and the turn that brings that face to the front.
  const FACES = { animal: "front", food: "right", silly: "top", place: "back", thing: "left", wild: "bottom" };
  const TURN = { front: [0, 0], right: [0, -90], back: [0, -180], left: [0, 90], top: [-90, 0], bottom: [90, 0] };
  const TILT = "rotateX(-20deg) rotateY(-28deg)"; // the resting angle: the chosen face front, two neighbours showing
  const pose = (category, spinX = 0, spinY = 0, spinZ = 0) => {
    const [x, y] = TURN[FACES[category] || "front"];
    return `${TILT} rotateZ(${spinZ}deg) rotateX(${x + spinX}deg) rotateY(${y + spinY}deg)`;
  };

  function build() {
    const die = document.createElement("div");
    die.className = "dice";
    die.setAttribute("aria-hidden", "true");
    const faces = CATEGORIES.map((c) => `<div class="dice-face dice-${FACES[c.id]}" data-category="${c.id}">${icon(c.id)}</div>`).join("");
    die.innerHTML = `<div class="dice-shadow"></div><div class="dice-air"><div class="dice-hop"><div class="dice-cube">
      <div class="dice-core">${"<i></i>".repeat(6)}</div><div class="dice-shell">${"<b></b>".repeat(32)}</div>${faces}</div></div></div>
      <svg class="dice-burst" viewBox="0 0 200 60" aria-hidden="true"><g fill="none" stroke-width="7" stroke-linecap="round"><path d="M34 50q-16-5-26-16"/><path d="M50 32q-11-12-14-28"/><path d="M166 50q16-5 26-16"/><path d="M150 32q11-12 14-28"/></g></svg>`;
    return die;
  }
  function dieIn(container) {
    let die = container.querySelector(":scope > .dice");
    if (!die) { die = build(); container.append(die); }
    return die;
  }
  const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function show(container, category) {
    const die = dieIn(container);
    die.querySelector(".dice-cube").style.transform = pose(category);
    die.dataset.category = category;
    die.classList.add("landed");
    for (const f of die.querySelectorAll(".dice-face")) f.classList.toggle("up", f.dataset.category === category);
    return die;
  }

  function roll(container, category, { ms = 2200 } = {}) {
    if (!byId[category]) category = "wild";
    const die = dieIn(container);
    const cube = die.querySelector(".dice-cube"), hop = die.querySelector(".dice-hop"), shadow = die.querySelector(".dice-shadow");
    const air = die.querySelector(".dice-air");
    die.classList.remove("landed");
    die.dataset.category = "";
    for (const f of die.querySelectorAll(".dice-face")) f.classList.remove("up");
    for (const a of die.getAnimations ? die.getAnimations({ subtree: true }) : []) a.cancel();
    if (reduced() || typeof cube.animate !== "function") {
      show(container, category);
      return new Promise((resolve) => setTimeout(() => resolve(category), 250));
    }
    // A different tumble every time: whole turns (so it ends exactly on the face) plus a twist that unwinds.
    const turns = (min) => 360 * (min + Math.floor(Math.random() * 2));
    const sx = turns(2) * (Math.random() < 0.5 ? -1 : 1), sy = turns(1) * (Math.random() < 0.5 ? -1 : 1), sz = (Math.random() * 60 - 30);
    cube.style.transform = pose(category);
    const spin = cube.animate([
      { transform: pose(category, sx, sy, sz) },
      { transform: pose(category, sx * 0.25, sy * 0.3, sz * 0.5), offset: 0.55 },
      { transform: pose(category, sx * 0.04, sy * 0.05, 4), offset: 0.8 },
      { transform: pose(category, 0, 0, 0) },
    ], { duration: ms, easing: "cubic-bezier(.2,.7,.3,1)" });
    // The fade-in runs on the flat wrapper (.dice-air), never on the hop: opacity (even a running opacity
    // animation) on a preserve-3d element flattens it, and mid-tumble the faces then come apart into slabs.
    if (air) air.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1 }], { duration: ms, easing: "linear" });
    hop.animate([
      { transform: "translate(-60%, -150%) scale(.7)", easing: "cubic-bezier(.5,0,.9,.5)" },
      { transform: "translate(-20%, -60%) scale(.9)", offset: 0.2, easing: "cubic-bezier(.4,0,1,1)" },
      // Uniform scale on contact: a squash (unequal x/y) on a turned cube reads as a skew, not a bounce.
      { transform: "translate(0, 0) scale(1.04)", offset: 0.42, easing: "cubic-bezier(0,.5,.5,1)" },
      { transform: "translate(0, -34%) scale(1)", offset: 0.6, easing: "cubic-bezier(.5,0,1,.5)" },
      { transform: "translate(0, 0) scale(1.02)", offset: 0.76, easing: "cubic-bezier(0,.5,.5,1)" },
      { transform: "translate(0, -8%) scale(1)", offset: 0.87, easing: "cubic-bezier(.5,0,1,.5)" },
      { transform: "translate(0, 0) scale(1)" },
    ], { duration: ms });
    shadow.animate([
      { transform: "scale(.35)", opacity: 0 },
      { transform: "scale(.6)", opacity: 0.5, offset: 0.2 },
      { transform: "scale(1.08)", opacity: 1, offset: 0.42 },
      { transform: "scale(.7)", opacity: 0.6, offset: 0.6 },
      { transform: "scale(1.04)", opacity: 1, offset: 0.76 },
      { transform: "scale(1)", opacity: 1 },
    ], { duration: ms });
    return spin.finished.catch(() => {}).then(() => {
      show(container, category);
      return category;
    });
  }

  root.ScrawdleDice = { roll, show, icon, phrase, CATEGORIES };
})(typeof window !== "undefined" ? window : globalThis);
