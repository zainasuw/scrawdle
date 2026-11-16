/* Scrawdle Party: the same-room drawing game. A TV or laptop is the HOST screen (the device that tapped "Host a
 * game"); everyone else plays on their phone. Each round a die picks a category and one word to draw (words.json),
 * everyone draws it against the clock, the TV shows the drawings without names, everyone votes for a favourite on
 * their phone, then the TV reveals who drew what and the points. A few rounds, then a winner's podium.
 * Rules (words, votes, points) are in party-rules.js; the die is dice.js; the lobby contract is at the top of
 * lobby.js; styles are social.css. Nothing is stored: drawings and votes only travel as lobby messages.
 *
 * The host's page runs the game: it picks the word, ends each phase, counts the votes and sends the results, so
 * every screen shows the same outcome. Every page (the host's too) draws its screens from the messages it gets.
 * The TV only shows the game: it never draws or votes. A host who wants to play joins on their phone with the
 * code, like everyone else, and is just another player there.
 *
 * Messages (ctx.send / ctx.on):
 *   setup   host -> all   { settings }                                     lobby settings changed
 *   round   host -> all   { round, total, category, word, seconds, players } roll the die, then draw
 *   drawing any  -> all   { round, image }                                 a finished drawing (null if blank)
 *   vote    host -> all   { round, order, seconds }                        vote; order hides who drew what
 *   pick    any  -> host  { round, owner }                                 my favourite (never my own)
 *   voted   host -> all   { round, ids }                                   who has voted so far (not for whom)
 *   results host -> all   { round, total, order, votes, points, top, scores, names }
 *   next    host -> all   { round, next, seconds }                         the scores are up: "round" or "final" in
 *                                                                          `seconds` (it happens on its own)
 *   final   host -> all   { scores, names }
 *   again   host -> all   {}                                               back to the lobby for another game
 *   sync    host -> all   { round, total, scores, names, settings }        for someone who joins mid-game
 */
(function (root) {
  "use strict";
  const R = root.ScrawdlePartyRules;
  let D = root.ScrawdleDice; // dice.js loads after this file; it's picked up again when a game starts
  if (!root.ScrawdleLobby || !R || !root.ScrawdleDrawing) return;

  const ROLL_MS = 2400;      // the die tumbles
  const WORD_MS = 3600;      // the word flips onto the board, then "3, 2, 1"
  const SEND_SPREAD_MS = 900; // when the clock runs out, drawings go out over this long, not all at once
  const REVEAL_STEP_MS = 700; // the TV turns over one drawing at a time
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  let wordData = null;
  async function loadWords() {
    if (wordData) return wordData;
    const res = await fetch("words.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    wordData = await res.json();
    return wordData;
  }

  /* ---------- small DOM helpers ---------- */
  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k.includes("-") || k === "role") n.setAttribute(k, v); else n[k] = v;
    }
    n.append(...kids.flat().filter((k) => k != null && k !== false));
    return n;
  };
  const svg = (markup, className) => { const s = el("span", { className: `pp-ico ${className || ""}`.trim() }); s.innerHTML = markup; return s; };
  const catOf = (id) => D.CATEGORIES.find((c) => c.id === id) || D.CATEGORIES[0];

  // One icon style (the game-show set): 32 x 32, 2.8 round strokes in currentColor, so a key's text colour is its
  // icon's colour (cream on the violet keys, ink on a gold one). Two exceptions carry their own colours because they
  // are trophies, not controls: the crown (gold with an ink outline) and the star (gold).
  const INK = "#1B1240";
  // (The paint attributes sit on an inner <g>: the screen roots' `all: revert` reset clears them on the <svg> itself.)
  const line = (d) => `<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>`;
  const I = {
    pencil: line('<path d="M6 26l2-7L21 6l5 5-13 13z"/><path d="M18 9l5 5"/>'),
    check: line('<path d="M7 16.5l6 6L25 9" stroke-width="3.4"/>'),
    ready: line('<path d="M5 14.5h5v12H5z"/><path d="M10 14.5l4.5-7.4c1.3-2.2 4.6-1.2 4.2 1.4l-.6 3.8h6.1a2.5 2.5 0 0 1 2.4 3.1l-2 9a3 3 0 0 1-2.9 2.3H10"/>'),
    vote: line('<path d="M16 27s-11-6.6-11-14.2C5 8.6 8.2 6 11.6 6c2 0 3.6 1 4.4 2.5C16.8 7 18.4 6 20.4 6 23.8 6 27 8.6 27 12.8 27 20.4 16 27 16 27z" fill="currentColor"/>'),
    crown: `<svg viewBox="0 0 56 42" aria-hidden="true"><path d="M5 36L8 9l12 13 8-17 8 17 12-13 3 27z" fill="#FFC23D" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><circle cx="28" cy="27" r="3.6" fill="#F2358A" stroke="${INK}" stroke-width="2.6"/></svg>`,
    close: line('<path d="M9 9l14 14M23 9L9 23" stroke-width="3.2"/>'),
    leave: line('<path d="M13 6H7v20h6"/><path d="M14 16h13M22 10l6 6-6 6"/>'),
    phone: line('<rect x="9" y="3.5" width="14" height="25" rx="3"/><path d="M14 24.5h4"/>'),
    copy: line('<rect x="11" y="11" width="15" height="15" rx="3"/><path d="M6 20V9a3 3 0 0 1 3-3h11"/>'),
    message: line('<path d="M5 8a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H13l-6 5v-5H8a3 3 0 0 1-3-3z"/>'),
    share: line('<path d="M16 4v15"/><path d="M10 10l6-6 6 6"/><path d="M9 15H7v12h18V15h-2"/>'),
    eye: line('<path d="M3 16s5-9 13-9 13 9 13 9-5 9-13 9S3 16 3 16z"/><circle cx="16" cy="16" r="4"/>'),
    play: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 6.5v19l16-9.5z" fill="currentColor" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/></svg>`,
    sparkle: `<svg viewBox="0 0 60 60" aria-hidden="true"><path d="M30 4c2.6 15 9 21.4 26 26-17 4.6-23.4 11-26 26-2.6-15-9-21.4-26-26 17-4.6 23.4-11 26-26z" fill="#FFC23D"/></svg>`,
    // drawing tools (the party board)
    pen: line('<path d="M6 26l2-7L21 6l5 5-13 13z"/><path d="M18 9l5 5"/>'),
    brush: line('<path d="M26 5L15 17"/><path d="M14 17c-5-1-8 3-7 6 0 3-2 4-3 4 5 2 11 1 12-5 0-2-1-4-2-5z"/>'),
    eraser: line('<path d="M11 26l-7-7L17 6l9 9-11 11z"/><path d="M10 13l9 9"/><path d="M15 26h13"/>'),
    bucket: line('<path d="M6 15l9-9 9 9-9 9z"/><path d="M11 3l4 3"/><path d="M26 19c2 3 2 6 0 6s-2-3 0-6z"/>'),
    size: `<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="16" r="2.5"/><circle cx="14" cy="16" r="4"/><circle cx="25" cy="16" r="6"/></g></svg>`,
    undo: line('<path d="M10 7L4 13l6 6"/><path d="M4 13h15c5 0 8 3 8 7s-3 7-8 7h-6"/>'),
    clear: line('<path d="M6 9h20"/><path d="M12 9V5h8v4"/><path d="M8 9l2 18h12l2-18"/><path d="M14 14v8M18 14v8"/>'),
    done: line('<path d="M6 17l7 7L26 8" stroke-width="4.5"/>'),
  };

  // Player avatars: a contestant colour (join order on every screen, see R.seats) behind a cream face, each with its
  // own hair or hat, all drawn in the same ink line.
  const AV_COLORS = ["#F2358A", "#1ED3C2", "#FFC23D", "#8E7BFF", "#FF8A3D", "#6FE36F", "#4FB4FF", "#FF9ECF"];
  const FACE = `<circle cx="50" cy="58" r="29" fill="#FFF4DE" stroke="${INK}" stroke-width="4.5"/>`;
  const smile = `<path d="M41 69q9 7 18 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
  const dots = (y = 58) => `<circle cx="40" cy="${y}" r="4" fill="${INK}"/><circle cx="60" cy="${y}" r="4" fill="${INK}"/>`;
  const FACES = [
    `${FACE}<path d="M22 52Q24 22 50 25q28-2 29 27-11-15-29-14-17-1-28 14z" fill="${INK}"/>${dots()}${smile}`,
    `${FACE}<path d="M24 46l6-17 7 11 7-15 7 13 7-13 6 12 6-8 1 18q-25-14-47-1z" fill="${INK}"/>${dots()}<path d="M43 71h14" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`,
    `<circle cx="27" cy="31" r="11" fill="${INK}"/><circle cx="73" cy="31" r="11" fill="${INK}"/>${FACE}<path d="M22 53q5-25 28-24 23-1 28 24-13-11-28-8-15-3-28 8z" fill="${INK}"/><path d="M35 59q5-5 10 0M55 59q5-5 10 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/><path d="M41 68q9 9 18 0z" fill="#F2358A" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`,
    `${FACE}<path d="M20 48q0-22 30-22t30 22z" fill="#FF8A3D" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/><path d="M77 46h16" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>${dots(60)}${smile}`,
    `<path d="M17 96q-2-64 33-68 35 4 33 68z" fill="${INK}"/><circle cx="50" cy="60" r="26" fill="#FFF4DE" stroke="${INK}" stroke-width="4.5"/>${dots(61)}<circle cx="35" cy="69" r="4.5" fill="#F2358A" opacity=".55"/><circle cx="65" cy="69" r="4.5" fill="#F2358A" opacity=".55"/><path d="M43 71q7 5 14 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`,
    `${FACE}<path d="M50 29c-3-8 4-14 10-10" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/><path d="M36 54l9 3M64 54l-9 3" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>${dots(61)}<path d="M41 69q9 9 18 0z" fill="${INK}"/>`,
    `${FACE}<path d="M22 50q2-26 28-26 26 0 28 26-6-9-14-11-6 8-14 0-8 8-14 0-8 2-14 11z" fill="${INK}"/><circle cx="40" cy="59" r="7" fill="none" stroke="${INK}" stroke-width="3.5"/><circle cx="60" cy="59" r="7" fill="none" stroke="${INK}" stroke-width="3.5"/><path d="M47 59h6" stroke="${INK}" stroke-width="3.5"/>${smile}`,
    `${FACE}<path d="M33 34l17-14 17 14z" fill="#FFC23D" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/><circle cx="50" cy="19" r="4" fill="#F2358A" stroke="${INK}" stroke-width="3"/><path d="M35 57q5 5 10 0M55 57q5 5 10 0" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/><path d="M41 68q9 10 18 0" fill="${INK}"/>`,
  ];
  const colourOf = (i) => AV_COLORS[i % AV_COLORS.length];
  function avatar(i, className = "") {
    const a = el("span", { className: `pp-av ${className}`.trim() });
    a.style.setProperty("--c", colourOf(i));
    a.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="${colourOf(i)}"/>${FACES[i % FACES.length]}</svg>`;
    return a;
  }

  /* ---------- the party drawing board (one per page, moved into each round's screen) ---------- */
  // It's never given a round, so it never saves over the player's own drawings. Its toolbar from drawing.js is
  // rearranged into the party's own layout: colours, then Pen / Brush / Eraser / Fill / Size, then Undo, Clear, Done!
  let drawView = null;
  function getDrawView() {
    if (drawView) return drawView;
    const canvas = el("canvas", { className: "pp-board", width: 1200, height: 1200 });
    canvas.setAttribute("aria-label", "Your drawing");
    const toolbar = el("div", { className: "pp-board-tools" });
    const sizePanel = el("aside", { className: "pp-size-panel", hidden: true, id: "party-size-panel" });
    sizePanel.setAttribute("aria-label", "Brush size");
    const board = root.ScrawdleDrawing.createBoard({ canvas, toolbar, settings: sizePanel, idPrefix: "party-" });
    // The board puts its toast on the page body when its canvas isn't in a dialog yet; the game is a modal dialog,
    // which would cover it, so it moves in with the board.
    const toastEl = [...document.querySelectorAll("body > .toast")].pop();

    const toolBtns = [...toolbar.querySelectorAll(".tray-tools .tool")];
    const KEEP = { pen: "Pen", brush: "Brush", eraser: "Eraser", bucket: "Fill" }; // Pencil and Line stay hidden on the party board
    const ORDER = ["pen", "pencil", "brush", "line", "eraser", "bucket"];
    toolBtns.forEach((b, i) => {
      const id = b.dataset.tool || ORDER[i];
      if (!KEEP[id]) { b.hidden = true; return; }
      const icon = id, label = KEEP[id];
      b.replaceChildren(svg(I[icon], "pp-tool-ico"), el("span", { className: "tool-label", textContent: label }));
    });
    const sizeBtn = el("button", { type: "button", className: "tool pp-size-btn" }, svg(I.size, "pp-tool-ico"), el("span", { className: "tool-label", textContent: "Size" }));
    sizeBtn.setAttribute("aria-expanded", "false");
    sizeBtn.setAttribute("aria-controls", "party-size-panel");
    const toggleSize = (open) => { sizePanel.hidden = !open; sizeBtn.setAttribute("aria-expanded", String(open)); };
    sizeBtn.addEventListener("click", () => toggleSize(sizePanel.hidden));
    document.addEventListener("pointerdown", (e) => { if (!sizePanel.hidden && !e.target.closest(".pp-size-panel, .pp-size-btn")) toggleSize(false); });
    const toolsRow = el("div", { className: "pp-tools-row" }, ...toolBtns, sizeBtn);
    const colours = toolbar.querySelector(".tray-colors");
    for (const s of colours.querySelectorAll(".swatch")) if (["#99938a", "#ffffff"].includes(s.dataset.color)) s.hidden = true;
    const history = toolbar.querySelector(".history-actions");
    const [undoBtn, redoBtn, clearBtn] = history.querySelectorAll(".tool");
    redoBtn.hidden = true;
    undoBtn.replaceChildren(svg(I.undo, "pp-tool-ico"), el("span", { className: "tool-label", textContent: "Undo" }));
    clearBtn.replaceChildren(svg(I.clear, "pp-tool-ico"), el("span", { className: "tool-label", textContent: "Clear" }));
    const doneBtn = el("button", { type: "button", className: "pp-done" }, svg(I.done, "pp-done-ico"), el("span", { textContent: "Done!" }));
    const bottomRow = el("div", { className: "pp-bottom-row" }, undoBtn, clearBtn, doneBtn);
    toolbar.querySelector(".studio-footer").hidden = true; // its status line and Done drawing aren't used here
    toolbar.querySelector(".tray").hidden = true;
    const brushControls = sizePanel.querySelector(".brush-controls");
    if (brushControls) brushControls.classList.add("pp-brush-controls");

    // The little scoreboard at the top of the buzzer pad: the category and the word, then the clock beside it.
    const wordCard = el("div", { className: "pp-wordcard" });
    const wordHold = el("div", { className: "pp-wordhold" }, wordCard);
    const clock = el("div", { className: "pp-clock", role: "timer" });
    const root_ = el("section", { className: "pp-draw" },
      el("header", { className: "pp-draw-top" }, wordHold, clock),
      el("div", { className: "pp-canvas-wrap" }, canvas),
      el("div", { className: "pp-controls" }, colours, toolsRow, sizePanel, bottomRow, toolbar));
    if (toastEl) root_.append(toastEl);
    drawView = { root: root_, board, canvas, wordCard, clock, doneBtn, closeSize: () => toggleSize(false) };
    return drawView;
  }

  // The drawing, square, as a data: URL small enough for one message, or null if even the smallest step is too big.
  function encodeDrawing(canvas) {
    for (const step of R.ENCODE_STEPS) {
      const small = el("canvas", { width: step.width, height: step.width });
      const c = small.getContext("2d");
      c.fillStyle = "#fff";
      c.fillRect(0, 0, small.width, small.height);
      c.drawImage(canvas, 0, 0, small.width, small.height);
      const url = small.toDataURL(step.type, step.quality);
      if (!url.startsWith(`data:${step.type}`)) continue;
      if (url.length <= R.MAX_IMAGE_CHARS) return url;
    }
    return null;
  }
  const isImage = (x) => typeof x === "string" && /^data:image\/(webp|jpeg|png);base64,/.test(x) && x.length <= R.MAX_IMAGE_CHARS;

  /* ======================================================================================================== */
  function start(ctx) {
    D = root.ScrawdleDice;
    if (!D) throw new Error("party.js needs dice.js");
    const timers = new Set();
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const every = (ms, fn) => { const t = setInterval(fn, ms); timers.add(t); return t; };
    const stop = (t) => { if (t) { clearTimeout(t); clearInterval(t); timers.delete(t); } };

    const me = ctx.me.id;
    const hostId = ctx.players()[0] ? ctx.players()[0].id : me;
    const amHost = hostId === me;
    const names = {};
    const rememberNames = (players) => { for (const p of players) names[p.id] = p.name; };
    rememberNames(ctx.players());
    const present = () => ctx.players().map((p) => p.id);
    // Avatars: by join order, everyone except the TV (which never plays).
    const seatOf = (id) => {
      const ids = present().filter((x) => x !== hostId);
      for (const x of game.players) if (!ids.includes(x)) ids.push(x);
      const i = ids.indexOf(id);
      return i < 0 ? 0 : R.seats(ids, AV_COLORS.length)[i];
    };

    const game = { phase: "lobby", round: 0, total: 0, settings: { ...R.DEFAULTS }, category: null, word: "", seconds: 60, players: [], drawings: {}, done: new Set(), order: [], voted: new Set(), myPick: null, scores: {}, lastPoints: {}, ended: false };
    const host = { used: [], picks: {}, voters: [], phaseTimer: null, seen: new Set(present()), finished: 0, voteStarted: 0 };
    const inRound = () => game.players.includes(me);

    const view = el("div", { className: `pp ${amHost ? "pp-tv" : "pp-phone"}` });
    ctx.container.replaceChildren(view);
    const askBox = (q) => (typeof window.scrawdleAsk === "function" ? window.scrawdleAsk(q) : Promise.resolve(confirm(q.title + (q.body ? "\n" + q.body : ""))));
    const say = el("p", { className: "pp-sr", role: "status" }); // spoken updates for screen readers
    const announce = (text) => { say.textContent = ""; later(30, () => { say.textContent = text; }); };

    /* ---------- chrome ---------- */
    const joinHost = location.host || "scrawdle.vercel.app";
    function codeBoard(small) {
      return el("div", { className: `pp-code ${small ? "small" : ""}`.trim() },
        el("span", { className: "pp-code-lbl" }, "Room code", el("b", { textContent: joinHost })),
        el("span", { className: "pp-code-val", "aria-label": `Code ${ctx.code.split("").join(" ")}` }, ...ctx.code.split("").map((ch) => el("em", { textContent: ch, "aria-hidden": "true" }))));
    }
    function roundPill() {
      if (!game.total) return null;
      const pips = el("span", { className: "pp-pips" }, ...Array.from({ length: game.total }, (_, i) => el("i", { className: i + 1 < game.round ? "on" : i + 1 === game.round ? "now" : "" })));
      return el("div", { className: "pp-round" }, el("span", {}, `Round ${game.round} `, el("small", { textContent: `of ${game.total}` })), pips);
    }
    async function closeRoom() {
      if (await askBox({ title: "Close the room?", body: "The game ends for everyone.", yes: "Close room", no: "Keep playing" })) ctx.end("The host closed the room. Thanks for playing!");
    }
    async function leaveGame() {
      if (!await askBox({ title: "Leave the game?", body: "You can join again with the code.", yes: "Leave", no: "Stay" })) return;
      const leave = document.querySelector('#lobby [data-act="leave"]');
      if (leave) leave.click();
    }
    function tvTop(extra) {
      return el("header", { className: "pp-top" },
        el("div", { className: "pp-logo" }, "Scrawdle", el("span", { textContent: "!", "aria-hidden": "true" })),
        roundPill(), extra || null, el("span", { className: "pp-top-gap" }),
        game.phase === "lobby" ? null : codeBoard(true),
        el("button", { type: "button", className: "pp-quiet pp-close", onclick: closeRoom }, svg(I.close), el("span", { textContent: "Close room" })));
    }
    function phoneTop() {
      return el("header", { className: "pp-ptop" },
        el("span", { className: "pp-plogo", textContent: "Scrawdle" }),
        game.total && game.phase !== "lobby" && game.phase !== "final" ? el("span", { className: "pp-pround", textContent: `Round ${game.round} of ${game.total}` }) : el("span", { className: "pp-pround", textContent: `Room ${ctx.code}` }),
        el("button", { type: "button", className: "pp-quiet pp-pleave", onclick: leaveGame, "aria-label": "Leave the game" }, svg(I.leave), el("span", { textContent: "Leave" })));
    }
    function screen(name, ...body) {
      view.dataset.screen = name;
      view.classList.remove("pp-landed", "pp-drawing");
      const main = el("main", { className: `pp-screen pp-${name}` }, ...body);
      view.replaceChildren(amHost ? tvTop() : phoneTop(), main, say);
      return main;
    }
    const button = (text, onclick, kind = "go", icon) => el("button", { type: "button", className: `pp-btn pp-btn-${kind}`, onclick }, icon ? svg(icon) : null, el("span", { textContent: text }));
    const tag = (text, kind) => el("span", { className: `pp-tag pp-tag-${kind}`, textContent: text });
    // The category chip: its die-face mark and its name. The big call after the roll says the category's phrase.
    const catTag = (category, extra = "", text = catOf(category).label) => el("span", { className: `pp-cat ${extra}`.trim() }, svg(D.icon(category), "pp-cat-ico"), el("span", { textContent: text }));
    const catCall = (category) => catTag(category, "pp-cat-big", D.phrase(category));

    // A countdown from now: shows whole seconds, "hurry" in the last ten, calls onEnd at zero.
    function countdown(target, endsAt, onEnd, format = (s) => String(s)) {
      let t = null;
      const tick = () => {
        const left = R.secondsLeft(endsAt, Date.now());
        const text = format(left);
        if (target.dataset.text !== text) { target.dataset.text = text; target.querySelector(".pp-clock-n").textContent = text; }
        target.classList.toggle("hurry", left <= 10 && left > 0);
        if (left === 0) { stop(t); if (onEnd) onEnd(); }
      };
      t = every(200, tick);
      tick();
      return t;
    }
    const clockFace = (cls = "") => {
      const c = el("div", { className: `pp-clock ${cls}`.trim(), role: "timer" }, el("span", { className: "pp-clock-n" }));
      c.insertAdjacentHTML("afterbegin", '<svg class="pp-clock-ticks" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="3" stroke-dasharray="1.2 5.7" stroke-linecap="round"/></svg>');
      return c;
    };
    const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

    // The word, letter by letter, so it can cascade in (each letter drops a moment after the one before).
    // How big the word can be: long phrases get smaller type (TV in --u units, phone in px).
    // Each letter is a flip tile, and a word never breaks across rows, so the longest word sets the ceiling.
    // The word is set in balanced rows of tiles (R.wordRows: 1 to 3 rows, the widest row as narrow as it can be, an
    // article always with its word, never a lone short word or a lone narrow middle word).
    // Phone: the tile size in px for a row that many tiles wide (a phone has height to spare, so up to 3 rows).
    const phoneTile = (w) => Math.min(46, Math.floor(300 / (w * 0.92)));
    const phoneRows = (word) => R.wordRows(word, { size: phoneTile, enough: 32 });
    // W and M are wider than the tile allows at full size, so they are drawn narrower (same height) inside their tile.
    const WIDE = { W: "w", M: "m" };
    function wordLetters(word, startDelay = 0, rows = [word.split(" ").filter(Boolean)]) {
      const box = el("span", { className: "pp-word-text" });
      box.setAttribute("aria-label", R.plainWord(word));
      const total = rows.flat().length;
      let i = 0, n = 0;
      for (const row of rows) {
        const r = el("span", { className: "pp-word-row" });
        r.setAttribute("aria-hidden", "true");
        for (const token of row) {
          n++;
          // a compound ("ice cream") is one token: its words sit side by side with an ordinary gap
          for (const part of token.split(R.NBSP)) {
            const w = el("span", { className: "pp-word-w" + (total > 1 && n === total ? " last" : "") }); // the last word of a phrase is magenta
            for (const ch of part) {
              const wide = WIDE[ch.toUpperCase()];
              const l = el("span", { className: "pp-l" }, wide ? el("span", { className: `pp-l-${wide}`, textContent: ch }) : ch);
              l.style.setProperty("--d", `${startDelay + i * 45}ms`);
              w.append(l);
              i++;
            }
            r.append(w);
            i++;
          }
        }
        box.append(r);
      }
      return box;
    }
    // The TV's word fills its marquee: for each row count (1 to 3, balanced), the biggest tile size (in --u) that fits
    // the board's screen, found by measuring; the row count with the biggest tiles wins (another row has to buy 8%).
    // The rows are chosen and the tiles made once; a later resize only fits their size again, so the tiles that
    // already flipped stay put (when drawing starts the clock grows and the board gives it room: the tiles shrink
    // smoothly with it instead of being made again and flipping a second time).
    function fitTvWord(banner, word, startDelay) {
      const inner = banner.querySelector(".pp-banner-in"), holder = banner.querySelector(".pp-word");
      if (!inner || !holder || typeof ResizeObserver !== "function") return;
      let chosen = null;
      const build = (rows) => { holder.replaceChildren(wordLetters(word, startDelay, rows)); return holder.firstChild; };
      const fit = () => {
        const cs = getComputedStyle(inner);
        const w = inner.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const h = inner.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        if (w <= 0 || h <= 0) return;
        // the biggest tile size (in --u) at which these tiles fit the board's screen
        const biggest = (text) => {
          const fits = (fs) => { banner.style.setProperty("--fs", String(fs)); return text.scrollWidth <= w + 1 && text.offsetHeight <= h * 0.94; };
          let lo = 2.5, hi = 9.5;
          if (fits(hi)) return hi;
          for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
          return lo;
        };
        if (!chosen) {
          for (let k = 1; k <= 3; k++) {
            const rows = R.balancedRows(word, k);
            if (!rows) continue;
            const fs = biggest(build(rows));
            if (!chosen || fs > chosen.fs * 1.08) chosen = { rows, fs };
          }
          if (!chosen) return;
          build(chosen.rows);
        }
        banner.style.setProperty("--fs", biggest(holder.firstChild).toFixed(2));
      };
      new ResizeObserver(fit).observe(inner);
      // the board's font can land after the first fit; the screen's size doesn't change then, so fit again
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    }

    // The bulbs round the word board: nx along the top and bottom, ny down each side, placed in percentages so they
    // follow the board's size. Each knows its place in the loop (--k), so a slow chase can run round them.
    function marqueeBulbs(nx, ny) {
      const box = el("span", { className: "pp-bulbs", "aria-hidden": "true" });
      const at = [];
      for (let i = 0; i < nx; i++) at.push([(i + 0.5) / nx * 100, 0]);
      for (let i = 0; i < ny; i++) at.push([100, (i + 0.5) / ny * 100]);
      for (let i = nx - 1; i >= 0; i--) at.push([(i + 0.5) / nx * 100, 100]);
      for (let i = ny - 1; i >= 0; i--) at.push([0, (i + 0.5) / ny * 100]);
      at.forEach(([x, y], k) => { const b = el("i"); b.style.left = `${x}%`; b.style.top = `${y}%`; b.style.setProperty("--k", String(k % 3)); box.append(b); });
      return box;
    }

    /* ---------- the players strip (TV) ---------- */
    function statusOf(id) {
      if (game.phase === "draw" || game.phase === "roll") return game.done.has(id) ? ["done", "done!"] : game.phase === "roll" ? ["wait", "ready"] : ["drawing", "drawing"];
      if (game.phase === "vote") return game.voted.has(id) ? ["done", "voted!"] : ["vote", "voting"];
      if (game.phase === "results") return (game.lastPoints[id] || 0) > 0 ? ["done", `+${game.lastPoints[id]} this round`] : ["rest", "next time!"];
      return ["wait", "ready"];
    }
    function leaderIds() {
      const rows = R.standings(game.scores, names);
      return rows.length && rows[0].points > 0 ? rows.filter((r) => r.place === 1).map((r) => r.id) : [];
    }
    function strip() {
      const ids = game.players.length ? game.players : R.drawers(present(), hostId);
      const leaders = leaderIds();
      const box = el("ol", { className: "pp-strip", "aria-label": "Players" });
      if (ids.length > 6) box.classList.add("many");
      for (const id of ids) {
        const [kind, text] = statusOf(id);
        const gone = !present().includes(id);
        const lead = leaders.includes(id);
        const li = el("li", { className: `pp-pl ${lead ? "lead" : ""} ${gone ? "gone" : ""}`.trim(), "data-id": id },
          lead ? svg(I.crown, "pp-crown") : null,
          avatar(seatOf(id)),
          el("span", { className: "pp-pinfo" },
            el("span", { className: "pp-pname", textContent: names[id] || "Player" }),
            el("span", { className: `pp-status pp-status-${kind}` }, svg(kind === "done" ? I.check : kind === "drawing" ? I.pencil : kind === "vote" ? I.vote : kind === "rest" ? I.sparkle : I.ready), el("span", { textContent: gone ? "left" : text }), kind === "drawing" || kind === "vote" ? el("span", { className: "pp-dots" }, el("i"), el("i"), el("i")) : null)),
          game.scores[id] ? el("span", { className: "pp-score", textContent: String(game.scores[id]) }) : null); // no "0" before the first points
        li.style.setProperty("--c", colourOf(seatOf(id)));
        box.append(li);
      }
      return box;
    }
    function refreshStrip() {
      const old = view.querySelector(".pp-strip");
      if (old) old.replaceWith(strip());
    }

    /* =================================== LOBBY =================================== */
    function showLobby() {
      game.phase = "lobby";
      if (amHost && typeof ctx.lock === "function") ctx.lock(false); // back in the lobby: new players can join again
      if (amHost) tvLobby(); else phoneWait();
    }

    /* ---------- inviting (TV lobby): the QR code, Copy link, Text a link ---------- */
    // The room's link (/?CODE): a phone that opens it goes straight to the name step for this room. The QR code is made
    // here in the browser (invite.js, vendor/qrcode.js); the link never goes to an outside service.
    const Invite = root.ScrawdleInvite;
    const roomLink = Invite ? Invite.inviteLink(location.origin, location.pathname, ctx.code) : `${location.origin}/?${ctx.code}`;
    let qrMarkup = null;
    function qrBoard() {
      if (qrMarkup === null) {
        try { qrMarkup = Invite && typeof root.qrcode === "function" ? Invite.qrSvg(Invite.qrModules(root.qrcode, roomLink)) : ""; } catch (err) { qrMarkup = ""; }
      }
      if (!qrMarkup) return null; // no encoder: the typed code and the two keys still work
      const plate = el("span", { className: "pp-qr-plate", role: "img", "aria-label": `QR code for the room link, ${roomLink}` });
      plate.innerHTML = qrMarkup;
      return el("figure", { className: "pp-qr" }, plate, el("figcaption", {}, "or ", el("b", { textContent: "scan to join" })));
    }
    // Copy link: the clipboard where the page may use it, else the older copy command (a page on a home network
    // address, http://192.168..., has no clipboard access). The key says "Copied!" for a moment either way.
    async function copyText(text) {
      try { if (navigator.clipboard && root.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (err) { /* try the older way */ }
      const was = document.activeElement;
      const box = el("textarea", { value: text, readOnly: true, className: "pp-copybox", tabIndex: -1, "aria-hidden": "true" });
      view.append(box);
      box.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      box.remove();
      if (was && was.focus) was.focus();
      return ok;
    }
    const COPIED_MS = 2200;
    function copyKey() {
      const copied = host.copiedAt && Date.now() - host.copiedAt < COPIED_MS;
      const b = el("button", { type: "button", className: `pp-key ${copied ? "copied" : ""}`.trim(), "data-focus": "copy", onclick: copyLink },
        svg(copied ? I.check : I.copy), el("span", { textContent: copied ? "Copied!" : "Copy link" }));
      return b;
    }
    async function copyLink() {
      const ok = await copyText(roomLink);
      const note = view.querySelector(".pp-invite-link");
      if (!ok) { // nothing could copy: show the link to copy by hand
        if (note) { note.hidden = false; note.textContent = roomLink; }
        announce(`Copy this link: ${roomLink}`);
        return;
      }
      host.copiedAt = Date.now();
      const old = view.querySelector('[data-focus="copy"]');
      if (old) { const fresh = copyKey(); const focused = document.activeElement === old; old.replaceWith(fresh); if (focused) fresh.focus(); }
      announce("Link copied.");
      later(COPIED_MS + 50, () => {
        const b = view.querySelector('[data-focus="copy"].copied');
        if (!b) return;
        const fresh = copyKey(); const focused = document.activeElement === b; b.replaceWith(fresh); if (focused) fresh.focus();
      });
    }
    // The third key: the device's share sheet where it has one (phones, Safari, Chrome on a laptop), which offers
    // Messages and the other apps. A touch screen with no share sheet gets a text message, already written, with the
    // link in it. A computer with a mouse and no share sheet can't send a text (sms: does nothing there), so its key
    // is Show link: the link in big letters under the keys, to read out or type into a chat.
    const hasShare = () => typeof navigator.share === "function";
    const finePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;
    function shareKey() {
      const body = Invite ? Invite.smsBody(roomLink, ctx.code) : roomLink;
      if (hasShare()) {
        return el("button", { type: "button", className: "pp-key", "data-focus": "share", onclick: async () => {
          try { await navigator.share({ title: "Scrawdle", text: Invite ? Invite.inviteText(ctx.code) : "", url: roomLink }); }
          catch (err) { if (!err || err.name !== "AbortError") showLink(true); }
        } }, svg(I.share), el("span", { textContent: "Share link" }));
      }
      if (finePointer()) {
        const b = el("button", { type: "button", className: "pp-key", "data-focus": "share", "aria-expanded": String(Boolean(host.showLink)), "aria-controls": "pp-invite-link", onclick: () => showLink(!host.showLink) },
          svg(I.eye), el("span", { textContent: host.showLink ? "Hide link" : "Show link" }));
        return b;
      }
      return el("a", { className: "pp-key", "data-focus": "share", href: Invite ? Invite.smsHref(body) : roomLink }, svg(I.message), el("span", { textContent: "Text a link" }));
    }
    // The link as it's read out: no https://, and a line break allowed before /?CODE so the code stays whole.
    const linkText = () => { const bare = roomLink.replace(/^https?:\/\//, ""); const at = bare.indexOf("/?"); return at < 0 ? [bare] : [bare.slice(0, at), el("wbr"), el("span", { className: "pp-invite-code", textContent: bare.slice(at) })]; };
    function showLink(on) {
      host.showLink = on;
      const note = view.querySelector(".pp-invite-link");
      if (note) { note.hidden = !on; note.replaceChildren(...(on ? linkText() : [])); }
      const old = view.querySelector('[data-focus="share"]');
      if (old) { const fresh = shareKey(); const focused = document.activeElement === old; old.replaceWith(fresh); if (focused) fresh.focus(); }
      if (on) announce(`The room link is ${roomLink}`);
    }
    function invitePanel() {
      return el("div", { className: "pp-scan" },
        qrBoard(),
        el("div", { className: "pp-invite", role: "group", "aria-label": "Send the link" }, copyKey(), shareKey()),
        el("p", { className: "pp-invite-link", id: "pp-invite-link", hidden: !host.showLink }, ...(host.showLink ? linkText() : [])));
    }

    function tvLobby() {
      const s = game.settings;
      const chips = (label, key, options, show) => {
        const row = el("div", { className: "pp-chips", role: "radiogroup", "aria-label": label });
        for (const v of options) {
          const b = el("button", { type: "button", className: "pp-chip", role: "radio", "data-focus": `${key}-${v}`, textContent: show(v), onclick: () => { s[key] = v; sendSetup(); tvLobby(); } });
          b.setAttribute("aria-checked", String(s[key] === v));
          row.append(b);
        }
        return el("div", { className: "pp-setting" }, el("span", { className: "pp-setting-lbl", textContent: label }), row);
      };
      // This screen is redrawn on every setting and every join, so whatever had focus (a chip, Start, a remove
      // button) gets it back afterwards: keyboard and remote users keep their place.
      const was = view.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = was && was.dataset.focus;
      // The TV only shows the game. The host plays the way everyone does: on a phone, with the code.
      const playTooNote = el("p", { className: "pp-playtoo" }, svg(I.phone, "pp-playtoo-ico"),
        el("span", {}, el("b", { textContent: "Playing too?" }), " Join on your phone with the code."));
      const drawers = R.drawers(present(), hostId);
      const short = drawers.length < R.MIN_DRAWERS;
      const startBtn = button(short ? `Need ${R.MIN_DRAWERS} players` : "Start the game!", () => startGame(), "go", short ? null : I.play);
      startBtn.disabled = short;
      startBtn.classList.add("pp-start");
      startBtn.dataset.focus = "start";

      const seats = el("ol", { className: "pp-seats", "aria-label": "Players" });
      // Every seat in the room: the filled ones lit in their player's colour, the free ones dim (hidden from screen
      // readers; the "N of 8" count beside the title says how many are free).
      for (const id of drawers) {
        // Remove: on a seat, it shows when the pointer is over the seat or a key lands on it (always, on a touch
        // screen). It asks first (lobby.js); the phone is told why and can't come back into this room today.
        // Lobby only: once the game starts, the players are fixed and nobody is removed from the TV.
        const remove = id !== me && typeof ctx.kick === "function"
          ? el("button", { type: "button", className: "pp-seat-kick", "aria-label": `Remove ${names[id] || "this player"}`, "data-focus": `kick-${id}`, onclick: () => ctx.kick(id) }, svg(I.close), el("span", { textContent: "Remove", "aria-hidden": "true" }))
          : null;
        const li = el("li", { className: "pp-seat" + (host.popped && host.popped.has(id) ? "" : " pop") }, avatar(seatOf(id)), el("span", { className: "pp-seat-name", textContent: names[id] || "Player" }), id === me ? tag("you", "ink") : null, remove);
        li.style.setProperty("--c", colourOf(seatOf(id)));
        seats.append(li);
      }
      for (let i = drawers.length; i < R.MAX_PLAYERS; i++) {
        seats.append(el("li", { className: "pp-seat open", "aria-hidden": "true" }, el("span", { className: "pp-av" }), el("span", { className: "pp-seat-name" })));
      }
      host.popped = new Set(drawers);
      host.tilesShown = ctx.code;
      // The code tiles flip over when the lobby first appears (or the code changes), not on every redraw.
      const tiles = el("div", { className: `pp-code-tiles ${host.tilesShown === ctx.code ? "settled" : ""}`.trim(), "aria-label": `Room code ${ctx.code.split("").join(" ")}` },
        ...ctx.code.split("").map((ch, i) => { const t = el("span", { className: "pp-tile", textContent: ch }); t.style.setProperty("--i", i); t.setAttribute("aria-hidden", "true"); return t; }));
      screen("lobby",
        el("section", { className: "pp-join" },
          el("h1", { className: "pp-join-title", textContent: "Grab your phones!" }),
          el("div", { className: "pp-type" },
            el("ol", { className: "pp-steps" },
              el("li", {}, el("b", { textContent: "1" }), el("span", {}, "Go to ", el("strong", { textContent: joinHost }))),
              el("li", {}, el("b", { textContent: "2" }), el("span", {}, "Tap ", el("strong", { textContent: "Join a game" }))),
              el("li", {}, el("b", { textContent: "3" }), el("span", { textContent: "Type this code and your name" }))),
            tiles),
          invitePanel()),
        el("section", { className: "pp-room" },
          el("h2", { className: "pp-room-title" }, "Players ", el("span", { className: "pp-count", textContent: `${drawers.length} of ${R.MAX_PLAYERS}` })),
          seats,
          drawers.length ? null : el("p", { className: "pp-room-empty", textContent: "Names pop in here as phones join." }),
          drawers.length === 1 ? el("p", { className: "pp-room-hint", textContent: "One more player and you can start." }) : null),
        el("section", { className: "pp-settings", "aria-label": "Game settings" },
          chips("Rounds", "rounds", R.OPTIONS.rounds, String),
          chips("Time to draw", "seconds", R.OPTIONS.seconds, (v) => `${v} sec`),
          playTooNote, startBtn));
      const target = focusKey ? [...view.querySelectorAll("[data-focus]")].find((n) => n.dataset.focus === focusKey) : null;
      if (target) target.focus();
    }
    function sendSetup() { ctx.send("setup", { settings: game.settings }); }

    function phoneWait(text) {
      game.phase = game.phase === "lobby" ? "lobby" : "wait";
      const others = present().filter((id) => id !== me && id !== hostId);
      const s = game.settings;
      const meCard = el("div", { className: "pp-me-card" },
        avatar(seatOf(me), "big"),
        tag("You're in!", "go"),
        el("h1", { className: "pp-me-name", textContent: names[me] || ctx.me.name }));
      meCard.style.setProperty("--c", colourOf(seatOf(me))); // my podium is lit in my colour
      screen("wait",
        meCard,
        el("p", { className: "pp-lead", textContent: text || "Look at the big screen. The game starts when the host taps Start." }),
        el("p", { className: "pp-small", textContent: `${s.rounds} rounds · ${s.seconds} seconds to draw` }),
        // Who else is in: their faces under my podium (no label above them; the list says it).
        others.length ? el("ul", { className: "pp-others", "aria-label": `Also here: ${others.map((id) => names[id] || "Player").join(", ")}` },
          ...others.map((id, i) => { const li = el("li", {}, avatar(seatOf(id), "tiny"), el("span", { textContent: names[id] || "Player" })); li.style.setProperty("--i", String(i)); return li; })) : null);
    }

    function onSetup(d, from) {
      if (from !== hostId || !d || amHost) return; // the host's own settings are already current
      game.settings = R.cleanSettings(d.settings);
      if (!amHost && (game.phase === "lobby" || game.phase === "wait")) phoneWait();
    }

    /* =================================== ROUNDS =================================== */
    function startGame() {
      if (!amHost) return;
      game.settings = R.cleanSettings(game.settings);
      game.total = game.settings.rounds;
      game.round = 0;
      game.scores = {};
      host.used = [];
      // the per-round guards start over too, or a new game's round 1 would look already done after a game that
      // stopped early (everyone left after round 1, say)
      Object.assign(host, { voteStarted: 0, finished: 0, scoresShown: 0, advanced: 0 });
      // From now on nobody new can join this room (players already in it can drop out and come back); Play again
      // opens it again.
      if (typeof ctx.lock === "function") ctx.lock(true);
      nextRound();
    }

    async function nextRound() {
      if (!amHost) return;
      let words;
      try { words = await loadWords(); } catch (err) {
        screen("message", el("h1", { className: "pp-big-title", textContent: "Couldn't load the words" }), el("p", { className: "pp-lead", textContent: "Check the connection, then try again." }), button("Try again", nextRound));
        return;
      }
      const players = R.drawers(present(), hostId);
      if (players.length < R.MIN_DRAWERS) { showLobby(); return; }
      const { category, word } = R.rollWord(words, Math.random, host.used);
      host.used.push(word);
      host.picks = {};
      host.submitted = new Set();
      const seconds = game.settings.seconds;
      ctx.send("round", { round: game.round + 1, total: game.total, category, word, seconds, players });
      stop(host.phaseTimer);
      host.phaseTimer = later(ROLL_MS + WORD_MS + (seconds + R.GRACE_SECONDS) * 1000 + SEND_SPREAD_MS, startVote);
    }

    function onRound(d, from) {
      if (from !== hostId || !d || !Number.isInteger(d.round) || typeof d.word !== "string" || !Array.isArray(d.players)) return;
      stop(game.nextTimer);
      Object.assign(game, { phase: "roll", round: d.round, total: d.total, category: d.category, word: d.word, seconds: d.seconds, players: d.players, drawings: {}, done: new Set(), order: [], voted: new Set(), myPick: null });
      for (const id of d.players) if (!(id in game.scores)) game.scores[id] = 0;
      game.startedAt = Date.now();
      if (amHost) tvRound(); else if (inRound()) phoneRoll(); else phoneWait("This round started while you were away. You'll draw in the next one!");
      announce(`Round ${d.round}. Rolling the die.`);
      later(ROLL_MS + WORD_MS, beginDrawing);
    }

    // The die rolls, it lands, the category pops out and the word flips onto the board. Then "3, 2, 1".
    function rollAndReveal(dieBox, after) {
      D.roll(dieBox, game.category, { ms: reduced() ? 0 : ROLL_MS - 200 }).then(() => {
        if (game.phase !== "roll") return;
        view.classList.add("pp-landed");
        announce(`${catOf(game.category).label}! Draw ${game.word}.`);
        after();
      });
    }
    // "Pencils up in 3…, 2…, 1…" in the last moments before the drawing starts: the count is part of the
    // sentence on the Get ready line, at the same display size, not a small digit under it.
    function readyCount(box) {
      const drawAt = game.startedAt + ROLL_MS + WORD_MS;
      ["3", "2", "1"].forEach((n, i) => later(Math.max(0, drawAt - (3 - i) * 750 - Date.now()), () => {
        if (game.phase !== "roll") return;
        let target = box.querySelector(".pp-ready-n");
        if (!target) {
          target = el("span", { className: "pp-ready-n" });
          box.replaceChildren(el("b", {}, "Pencils up in ", target, "…"));
        }
        target.textContent = n;
        target.classList.remove("tick");
        void target.offsetWidth;
        target.classList.add("tick");
      }));
    }

    // The TV during a round: the die rolls onto its table and the word flips onto the marquee; the clock runs.
    function tvRound() {
      const dieBox = el("div", { className: "pp-diebox" });
      const cat = catCall(game.category);
      const banner = el("div", { className: "pp-banner" },
        marqueeBulbs(26, 10),
        el("div", { className: "pp-banner-in" }, el("p", { className: "pp-word" }, wordLetters(game.word, 380))));
      const clock = clockFace("pp-clock-tv");
      clock.querySelector(".pp-clock-n").textContent = String(game.seconds);
      const ready = el("div", { className: "pp-ready" }, el("b", { textContent: "Get ready!" }), el("small", { textContent: "pencils up…" }));
      screen("turn",
        el("div", { className: "pp-diezone" }, dieBox, cat, svg(I.sparkle, "pp-spark a"), svg(I.sparkle, "pp-spark b")),
        el("div", { className: "pp-wordzone" }, banner, clock, ready),
        strip());
      game.tvClock = clock;
      fitTvWord(banner, game.word, 380);
      rollAndReveal(dieBox, () => readyCount(ready));
    }

    function phoneRoll() {
      const dieBox = el("div", { className: "pp-diebox" });
      const ready = el("div", { className: "pp-ready" }, el("b", { textContent: "Get ready!" }), el("small", { textContent: "pencils up…" }));
      screen("roll",
        dieBox,
        catCall(game.category),
        el("div", { className: "pp-banner small" },
          el("div", { className: "pp-banner-in" }, el("p", { className: "pp-word" }, wordLetters(game.word, 320, phoneRows(game.word))))),
        ready);
      view.querySelector(".pp-banner").style.setProperty("--pfs", `${phoneTile(Math.max(...phoneRows(game.word).map((r) => R.rowWidth(r))))}px`);
      rollAndReveal(dieBox, () => readyCount(ready));
    }

    function beginDrawing() {
      if (game.phase !== "roll") return;
      game.phase = "draw";
      game.drawEndsAt = Date.now() + game.seconds * 1000;
      announce("Draw!");
      if (inRound()) {
        const v = getDrawView();
        v.board.discard();
        v.closeSize();
        // The word, then its category as the same magenta chip the TV's vote and reveal rows use (the round is
        // already in the pad's top bar).
        v.wordCard.replaceChildren(el("span", { className: "pp-wc-word", textContent: game.word }), catTag(game.category, "pp-wc-cat"));
        v.doneBtn.onclick = () => {
          if (v.board.isEmpty) { v.board.toast("Draw something first!", { ms: 2200 }); return; }
          submit(false);
        };
        const clock = clockFace("pp-clock-phone");
        clock.append(el("small", { textContent: "left" }));
        v.clock.replaceWith(clock);
        v.clock = clock;
        view.dataset.screen = "draw";
        view.classList.remove("pp-landed");
        view.replaceChildren(phoneTop(), el("main", { className: "pp-screen pp-draw-screen" }, v.root), say);
        game.drawTimer = countdown(clock, game.drawEndsAt, () => submit(true), mmss);
      }
      if (amHost) {
        view.classList.add("pp-drawing");
        const ready = view.querySelector(".pp-ready");
        if (ready) ready.replaceChildren(el("b", { textContent: "Draw!" }), el("small", { textContent: "on your phones" }));
        if (game.tvClock) game.drawTimer = countdown(game.tvClock, game.drawEndsAt, null);
        refreshStrip();
      }
    }

    function submit(timeUp) {
      if (game.phase !== "draw" || me in game.drawings) return;
      const v = getDrawView();
      v.closeSize();
      const image = v.board.isEmpty ? null : encodeDrawing(v.canvas);
      game.drawings[me] = image;
      game.done.add(me);
      const round = game.round;
      later(timeUp ? Math.random() * SEND_SPREAD_MS : 0, () => ctx.send("drawing", { round, image }));
      stop(game.drawTimer);
      showSent();
    }
    function showSent() {
      const mine = game.drawings[me];
      const done = game.players.filter((id) => game.done.has(id)).length;
      screen("sent",
        tag(mine ? "Sent!" : "Time's up!", "go"),
        mine ? el("figure", { className: "pp-mine" }, el("img", { src: mine, alt: "Your drawing" })) : el("p", { className: "pp-lead", textContent: "Your page was empty this time, so there's nothing to vote on. Next round!" }),
        el("p", { className: "pp-lead", textContent: done >= game.players.length ? "Everyone's done!" : `Waiting for the others… ${done} of ${game.players.length} done` }),
        el("ul", { className: "pp-ticks", "aria-hidden": "true" }, ...game.players.map((id) => el("li", { className: game.done.has(id) ? "on" : "" }, avatar(seatOf(id), "tiny")))));
    }

    function onDrawing(d, from) {
      if (!d || d.round !== game.round || !game.players.includes(from)) return;
      if (from !== me) game.drawings[from] = isImage(d.image) ? d.image : null;
      game.done.add(from);
      if (!amHost && view.dataset.screen === "sent") showSent();
      if (amHost) {
        refreshStrip();
        if (R.everyoneDone(game.players, present(), [...game.done])) { stop(host.phaseTimer); host.phaseTimer = later(900, startVote); }
      }
    }

    /* =================================== VOTING =================================== */
    function startVote() {
      if (!amHost || host.voteStarted === game.round) return;
      host.voteStarted = game.round;
      stop(host.phaseTimer);
      stop(game.drawTimer);
      const owners = game.players.filter((id) => game.drawings[id]);
      host.picks = {};
      if (owners.length < 2) { game.order = owners; finishRound(); return; }
      host.voters = game.players.filter((id) => owners.some((o) => o !== id));
      ctx.send("vote", { round: game.round, order: R.shuffled(owners), seconds: R.VOTE_SECONDS });
      host.phaseTimer = later((R.VOTE_SECONDS + R.GRACE_SECONDS) * 1000, finishRound);
    }

    // A phone, which is private, says "Yours" on its own drawing and can't vote for it. The TV never draws, so
    // it has no drawing of its own.
    function drawingCard(id, i, { pick, reveal } = {}) {
      const image = game.drawings[id];
      const mine = id === me;
      const card = el(pick && !mine ? "button" : "div", { className: `pp-card ${mine ? "mine" : ""}`.trim(), "data-id": id },
        el("span", { className: "pp-card-letter", textContent: R.label(i) }),
        image ? el("img", { src: image, alt: reveal ? `Drawing ${R.label(i)}, by ${names[id] || "a player"}` : `Drawing ${R.label(i)}` }) : el("span", { className: "pp-missing", textContent: "This drawing didn't arrive." }));
      card.style.setProperty("--tilt", `${[-2, 1.5, -1, 2, -1.5, 1, -2.5, 1.2][i % 8]}deg`);
      card.style.setProperty("--n", String(i)); // the cards light up one after another
      if (pick && !mine) {
        card.type = "button";
        card.setAttribute("aria-pressed", String(game.myPick === id));
        card.setAttribute("aria-label", `Vote for drawing ${R.label(i)}`);
        card.append(el("span", { className: "pp-card-pick" }, svg(I.vote), el("span", { textContent: "My vote" })));
        card.addEventListener("click", () => {
          game.myPick = id;
          for (const c of view.querySelectorAll(".pp-card[aria-pressed]")) c.setAttribute("aria-pressed", String(c.dataset.id === id));
          ctx.send("pick", { round: game.round, owner: id });
          const hint = view.querySelector(".pp-vote-hint");
          if (hint) hint.textContent = `You voted for ${R.label(i)}. You can change your mind until the time runs out.`;
        });
      }
      if (mine && !reveal) card.append(el("span", { className: "pp-card-yours", textContent: "Yours" }));
      return card;
    }

    function onVote(d, from) {
      if (from !== hostId || !d || d.round !== game.round || !Array.isArray(d.order)) return;
      stop(game.drawTimer);
      game.phase = "vote";
      game.order = d.order;
      game.voted = new Set();
      game.myPick = null;
      announce("Time to vote!");
      const canPick = inRound() && d.order.some((id) => id !== me);
      if (amHost) {
        const clock = clockFace("pp-clock-mid");
        const grid = el("div", { className: `pp-gallery n${d.order.length}` }, ...d.order.map((id, i) => drawingCard(id, i, { pick: canPick })));
        screen("vote",
          el("div", { className: "pp-vote-head" },
            el("div", { className: "pp-vote-word" }, catTag(game.category), el("span", { textContent: game.word })),
            el("h1", { className: "pp-big-title", textContent: canPick ? "Vote for your favourite!" : "Vote on your phones!" }),
            clock),
          grid, strip());
        game.voteTimer = countdown(clock, Date.now() + (d.seconds || R.VOTE_SECONDS) * 1000, null);
        return;
      }
      if (!canPick) { phoneWait(inRound() ? "Only your drawing came in this round, so there's nothing to vote for. Look at the big screen!" : "Everyone's voting. You'll draw in the next round!"); return; }
      const clock = clockFace("pp-clock-small");
      screen("vote",
        el("div", { className: "pp-pvote-head" },
          el("div", {}, el("h1", { className: "pp-ptitle", textContent: "Pick your favourite!" }), el("p", { className: "pp-pvote-word" }, catTag(game.category, "pp-wc-cat"), el("span", { textContent: game.word }))),
          clock),
        el("div", { className: "pp-pgallery" }, ...d.order.map((id, i) => drawingCard(id, i, { pick: true }))),
        el("p", { className: "pp-vote-hint", role: "status", textContent: "Names are hidden. Tap the drawing you like best (not your own)." }));
      game.voteTimer = countdown(clock, Date.now() + (d.seconds || R.VOTE_SECONDS) * 1000, null);
    }

    function onPick(d, from) {
      if (!amHost || !d || d.round !== game.round || game.phase !== "vote" || host.finished === game.round) return;
      if (!host.voters.includes(from) || !R.canVote(from, d.owner, game.order)) return;
      host.picks[from] = d.owner;
      ctx.send("voted", { round: game.round, ids: Object.keys(host.picks) });
      if (R.everyoneDone(host.voters, present(), Object.keys(host.picks))) { stop(host.phaseTimer); host.phaseTimer = later(1200, finishRound); }
    }
    function onVoted(d, from) {
      if (from !== hostId || !d || d.round !== game.round || !Array.isArray(d.ids)) return;
      game.voted = new Set(d.ids);
      if (amHost) refreshStrip();
    }

    function finishRound() {
      if (!amHost || host.finished === game.round) return;
      host.finished = game.round;
      stop(host.phaseTimer);
      const owners = game.order.length ? game.order : game.players.filter((id) => game.drawings[id]);
      const result = R.scoreRound(owners, host.picks);
      game.scores = R.addScores(game.scores, result.points);
      for (const id of game.players) if (!(id in game.scores)) game.scores[id] = 0;
      ctx.send("results", { round: game.round, total: game.total, order: owners, ...result, scores: game.scores, names });
    }

    /* =================================== RESULTS =================================== */
    function onResults(d, from) {
      if (from !== hostId || !d || d.round !== game.round) return;
      stop(game.voteTimer);
      stop(game.drawTimer);
      game.phase = "results";
      Object.assign(names, d.names || {});
      const before = { ...game.scores };
      game.scores = d.scores || {};
      game.lastPoints = d.points || {};
      game.last = d;
      if (amHost) tvReveal(d, before); else phoneResult(d);
    }

    function tvReveal(d) {
      const order = Array.isArray(d.order) ? d.order : [];
      const grid = el("div", { className: `pp-gallery reveal n${order.length}` });
      order.forEach((id, i) => {
        const card = drawingCard(id, i, { reveal: true });
        const top = (d.top || []).includes(id);
        const votes = (d.votes || {})[id] || 0;
        card.classList.add("hidden-name");
        if (top) card.classList.add("top");
        if (top) card.append(svg(I.sparkle, "pp-card-spark a"), svg(I.sparkle, "pp-card-spark b"));
        card.append(el("div", { className: "pp-card-who" },
          avatar(seatOf(id), "small"),
          el("span", { className: "pp-card-name", textContent: names[id] || "Player" }),
          el("span", { className: "pp-card-votes" }, votes ? `${votes} ${votes === 1 ? "vote" : "votes"}` : "no votes this time"),
          (d.points || {})[id] ? el("span", { className: "pp-card-points", textContent: `+${d.points[id]}` }) : null),
          ...(top ? [el("span", { className: "pp-card-best" }, svg(I.crown), el("span", { textContent: `Best drawing +${R.TOP_BONUS}` }))] : []));
        grid.append(card);
        later(reduced() ? 0 : 900 + i * REVEAL_STEP_MS, () => card.classList.remove("hidden-name"));
      });
      const next = button("See the scores", () => tvScores(d), "go");
      screen("reveal",
        el("div", { className: "pp-vote-head" },
          el("div", { className: "pp-vote-word" }, catTag(game.category), el("span", { textContent: game.word })),
          el("h1", { className: "pp-big-title", textContent: order.length ? "Who drew what?" : "No drawings this round!" }),
          next),
        order.length ? grid : el("p", { className: "pp-lead", textContent: "Nobody finished a drawing. On to the next one!" }),
        strip());
      announce(order.length ? "Who drew what?" : "No drawings this round.");
      game.autoNext = later(reduced() ? 6000 : 900 + order.length * REVEAL_STEP_MS + 5500, () => { if (game.phase === "results" && view.dataset.screen === "reveal") tvScores(d); });
    }

    function tvScores(d) {
      stop(game.autoNext);
      if (host.scoresShown === d.round) return; // "See the scores" pressed twice, or pressed as the reveal moved on
      host.scoresShown = d.round;
      const rows = R.standings(game.scores, names);
      const next = R.afterScores(d.round, d.total);
      const last = next === "final";
      const list = el("ol", { className: `pp-board-list ${rows.length <= 4 ? "few" : ""}`.trim() });
      rows.forEach((r, i) => {
        const gained = (d.points || {})[r.id] || 0;
        const lead = r.place === 1 && r.points > 0;
        // Each player is a lit panel on the scoreboard, a round place badge on its edge.
        const li = el("li", { className: `pp-row ${lead ? "lead" : ""}`.trim() },
          lead ? svg(I.crown, "pp-crown") : null,
          el("span", { className: "pp-row-place", textContent: R.ordinal(r.place) }),
          avatar(seatOf(r.id)),
          el("span", { className: "pp-row-name", textContent: r.name }),
          gained ? el("span", { className: "pp-row-gain", textContent: `+${gained}` }) : null,
          el("span", { className: "pp-row-total", textContent: String(r.points) }));
        li.style.setProperty("--i", i);
        li.style.setProperty("--tilt", `${[-1.4, 1.1, -0.7, 1.3, -1, 0.8, -1.3, 0.9][i % 8]}deg`);
        list.append(li);
      });
      // The gold key goes on by itself: a little teal clock dial inside it counts down (the ring drains; under
      // reduced motion it stays full and only the number counts). Pressing it goes early.
      const seconds = R.NEXT_SECONDS;
      const go = () => {
        if (host.advanced === d.round || game.phase !== "results" || game.round !== d.round) return;
        host.advanced = d.round;
        stop(game.nextTimer);
        if (last) ctx.send("final", { scores: game.scores, names }); else nextRound();
      };
      const count = el("b", { className: "pp-next-n", textContent: String(seconds) });
      const dial = el("span", { className: "pp-next-dial", "aria-hidden": "true" }, count);
      dial.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="pp-next-track" cx="20" cy="20" r="16.5"/><circle class="pp-next-arc" cx="20" cy="20" r="16.5" pathLength="100"/></svg>');
      dial.style.setProperty("--secs", `${seconds}s`);
      const key = el("button", { type: "button", className: "pp-btn pp-btn-go pp-next", onclick: go }, dial, el("span", { textContent: last ? "And the winner is…" : `Roll for round ${d.round + 1}` }));
      screen("scores",
        el("h1", { className: "pp-big-title" }, svg(I.sparkle, "pp-title-spark a"), last ? "Final scores!" : `Scores after round ${d.round}`, svg(I.sparkle, "pp-title-spark b")),
        list,
        el("div", { className: "pp-scores-actions" }, key));
      announce(`${last ? "Final scores." : `Scores after round ${d.round}.`} ${R.nextCall(next)} ${seconds} seconds.`);
      ctx.send("next", { round: d.round, next, seconds });
      const endsAt = Date.now() + seconds * 1000;
      stop(game.nextTimer);
      game.nextTimer = every(200, () => {
        const left = R.secondsLeft(endsAt, Date.now());
        if (count.textContent !== String(left)) count.textContent = String(left);
        if (left === 0) go();
      });
    }

    // A phone hears that the scores are up on the TV: a live "Next round in 8" under its result.
    function onNext(d, from) {
      if (from !== hostId || !d || amHost || d.round !== game.round || game.phase !== "results") return;
      const next = d.next === "final" ? "final" : "round";
      const endsAt = Date.now() + R.cleanNextSeconds(d.seconds) * 1000;
      const main = view.querySelector("main.pp-result, main.pp-wait");
      if (!main) return;
      const n = el("b", { className: "pp-next-n" });
      const call = el("p", { className: "pp-next-call", role: "timer" }, el("span", { textContent: R.nextCall(next) }), " ", n);
      const old = main.querySelector(".pp-next-call");
      if (old) old.replaceWith(call); else main.append(call);
      announce(`${R.nextCall(next)} ${R.secondsLeft(endsAt, Date.now())} seconds.`);
      stop(game.nextTimer);
      const tick = () => {
        const left = R.secondsLeft(endsAt, Date.now());
        if (n.textContent !== String(left)) n.textContent = String(left);
        if (left === 0) stop(game.nextTimer); // the TV moves everyone on; this only counts
      };
      game.nextTimer = every(200, tick);
      tick();
    }

    function phoneResult(d) {
      const mine = (d.order || []).includes(me);
      const votes = (d.votes || {})[me] || 0;
      const points = (d.points || {})[me] || 0;
      const top = (d.top || []).includes(me);
      const rows = R.standings(game.scores, names);
      const myRow = rows.find((r) => r.id === me);
      screen("result",
        mine ? el("div", { className: `pp-result-card ${top ? "lead" : ""}`.trim() },
          top ? el("span", { className: "pp-card-best" }, svg(I.crown), el("span", { textContent: `Best drawing! +${R.TOP_BONUS}` })) : null,
          top ? svg(I.sparkle, "pp-card-spark a") : null, top ? svg(I.sparkle, "pp-card-spark b") : null,
          votes ? el("p", { className: "pp-result-big" }, el("b", { textContent: String(votes) }), votes === 1 ? " vote" : " votes") : el("p", { className: "pp-result-big pp-result-none", textContent: "No votes this time" }),
          points ? el("p", { className: "pp-result-points", textContent: `+${points} points` }) : el("p", { className: "pp-small", textContent: "Keep drawing: the next word could be yours!" }),
          game.drawings[me] ? el("img", { className: "pp-result-img", src: game.drawings[me], alt: "Your drawing" }) : null)
          : el("div", { className: "pp-result-card" }, el("p", { className: "pp-result-big pp-result-none", textContent: inRound() ? "No drawing this round" : "Next round's yours!" }), el("p", { className: "pp-lead", textContent: inRound() ? "Nothing came in from you this time." : "You'll draw in the next round." })),
        myRow ? el("p", { className: "pp-rank" }, "You're ", el("b", { textContent: R.ordinal(myRow.place) }), myRow.points ? ` with ${myRow.points} ${myRow.points === 1 ? "point" : "points"}` : "") : null,
        el("p", { className: "pp-small", textContent: d.round >= d.total ? "That was the last round. Look at the big screen!" : "See who drew what on the big screen." }),
        // the TV's countdown fills this in once its scores are up (onNext); until then it only holds the space
        el("p", { className: "pp-next-call pending", "aria-hidden": "true" }, el("span", { textContent: R.nextCall(R.afterScores(d.round, d.total)) }), " ", el("b", { className: "pp-next-n", textContent: String(R.NEXT_SECONDS) })));
    }

    /* =================================== FINAL =================================== */
    function confetti() {
      const box = el("div", { className: "pp-confetti", "aria-hidden": "true" });
      const colors = ["#FFC23D", "#F2358A", "#1ED3C2", "#FFF4DE", "#8E7BFF", "#FFE7A6", "#FF8A3D"];
      for (let i = 0; i < 70; i++) {
        const c = el("i");
        c.style.setProperty("--x", `${Math.random() * 100}%`);
        c.style.setProperty("--d", `${(Math.random() * 2.4).toFixed(2)}s`);
        c.style.setProperty("--t", `${(3 + Math.random() * 3).toFixed(2)}s`);
        c.style.setProperty("--r", `${Math.round(Math.random() * 720 - 360)}deg`);
        c.style.setProperty("--c", colors[i % colors.length]);
        c.style.setProperty("--y", `${Math.round(Math.random() * 90)}%`);
        if (i % 3 === 0) c.className = "round";
        box.append(c);
      }
      return box;
    }
    function onFinal(d, from) {
      if (from !== hostId || !d) return;
      game.phase = "final";
      stop(game.autoNext);
      stop(game.nextTimer);
      Object.assign(names, d.names || {});
      game.scores = d.scores || {};
      const rows = R.standings(game.scores, names);
      const winners = rows.filter((r) => r.place === 1 && r.points > 0);
      const list = winners.map((w) => w.name);
      const together = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
      const title = !winners.length ? "Game over!" : winners.length > 2 ? "It's a tie!" : `${together} ${winners.length > 1 ? "win" : "wins"}!`;
      announce(title);
      if (amHost) {
        const podium = el("ol", { className: "pp-podium" });
        const spots = [rows[1], rows[0], rows[2]];
        spots.forEach((r, i) => {
          if (!r) { podium.append(el("li", { className: "pp-step empty" })); return; }
          const place = r.place;
          podium.append(el("li", { className: `pp-step p${Math.min(3, place)}` },
            place === 1 ? svg(I.crown, "pp-crown") : null,
            svg(I.sparkle, "pp-step-spark a"), svg(I.sparkle, "pp-step-spark b"),
            avatar(seatOf(r.id), "big"),
            el("span", { className: "pp-step-name", textContent: r.name }),
            el("span", { className: "pp-step-points", textContent: r.points ? `${r.points} ${r.points === 1 ? "point" : "points"}` : "no points yet" }),
            el("span", { className: "pp-step-block" }, el("b", { textContent: R.ordinal(place) }))));
        });
        const rest = rows.slice(3);
        screen("final",
          confetti(),
          el("h1", { className: "pp-winner", textContent: title }),
          podium,
          rest.length ? el("ol", { className: "pp-rest" }, ...rest.map((r) => el("li", {}, el("b", { textContent: R.ordinal(r.place) }), avatar(seatOf(r.id), "tiny"), el("span", { textContent: r.name }), el("span", { className: "pp-rest-pts", textContent: String(r.points || 0) })))) : null,
          el("div", { className: "pp-final-actions" },
            button("Play again", () => ctx.send("again", {}), "go", I.play)));
        return;
      }
      const myRow = rows.find((r) => r.id === me);
      screen("final",
        myRow && myRow.place === 1 && myRow.points > 0 ? confetti() : null,
        myRow ? el("div", { className: `pp-result-card ${myRow.place === 1 && myRow.points > 0 ? "lead" : ""}`.trim() },
          myRow.place === 1 && myRow.points > 0 ? svg(I.crown, "pp-crown") : null,
          avatar(seatOf(me), "big"),
          el("p", { className: "pp-result-big" }, "You came ", el("b", { textContent: R.ordinal(myRow.place) })),
          el("p", { className: "pp-result-points", textContent: myRow.points ? `${myRow.points} ${myRow.points === 1 ? "point" : "points"}` : "Thanks for drawing!" })) : null,
        el("h2", { className: "pp-ptitle", textContent: title }),
        el("ol", { className: "pp-mini-board" }, ...rows.map((r) => el("li", { className: r.id === me ? "me" : "" }, el("b", { textContent: R.ordinal(r.place) }), avatar(seatOf(r.id), "tiny"), el("span", { textContent: r.name }), el("span", { className: "pp-rest-pts", textContent: String(r.points || 0) })))),
        el("p", { className: "pp-small", textContent: "Thanks for playing! The host can start another game." }));
    }

    function onAgain(d, from) {
      if (from !== hostId) return;
      stop(host.phaseTimer);
      stop(game.nextTimer);
      Object.assign(game, { phase: "lobby", round: 0, total: 0, players: [], drawings: {}, done: new Set(), order: [], voted: new Set(), scores: {} });
      host.tilesShown = null; // back to the lobby after a game: the code tiles flip over again
      showLobby();
    }

    /* ---------- players coming and going ---------- */
    function onPlayersChange(players) {
      rememberNames(players);
      const ids = players.map((p) => p.id);
      if (!ids.includes(hostId) && !game.ended) {
        game.ended = true;
        screen("message", el("h1", { className: "pp-big-title", textContent: "The host left" }), el("p", { className: "pp-lead", textContent: "So this game is over. Taking you back home…" }));
        if (ctx.isHost()) later(2500, () => ctx.end("The host left, so the game ended."));
        return;
      }
      if (game.phase === "lobby") { if (amHost) tvLobby(); else phoneWait(); }
      else if (game.phase === "wait" && !amHost) phoneWait(view.querySelector(".pp-lead") ? view.querySelector(".pp-lead").textContent : undefined);
      else if (amHost) refreshStrip();
      if (!amHost) return;
      // Everyone who has just appeared, new or coming back (a phone that locked, a reload), gets the catch-up.
      const arrived = ids.filter((id) => !host.seen.has(id));
      host.seen = new Set(ids);
      if (arrived.length) ctx.send("sync", { round: game.round, total: game.total, scores: game.scores, names, settings: game.settings, phase: game.phase });
      if (game.phase === "draw" && R.everyoneDone(game.players, ids, [...game.done])) { stop(host.phaseTimer); host.phaseTimer = later(900, startVote); }
      if (game.phase === "vote" && R.everyoneDone(host.voters, ids, Object.keys(host.picks))) finishRound();
    }
    function onSync(d, from) {
      if (from !== hostId || !d || amHost || game.round || game.players.length) return;
      Object.assign(names, d.names || {});
      game.settings = R.cleanSettings(d.settings);
      game.total = d.total || 0;
      if (d.phase && d.phase !== "lobby" && Number.isInteger(d.round)) game.round = d.round; // the round on the phone's top bar
      // Once a game starts the room is locked, so a phone arriving mid-game is a player coming back.
      if (d.phase && d.phase !== "lobby" && d.phase !== "final") { game.phase = "wait"; phoneWait("Welcome back! A round is on right now. You'll draw in the next one."); }
      else if (d.phase === "final") phoneWait("The game just finished. Wait for the host to start another one!");
    }

    ctx.on("setup", onSetup);
    ctx.on("round", onRound);
    ctx.on("drawing", onDrawing);
    ctx.on("vote", onVote);
    ctx.on("pick", onPick);
    ctx.on("voted", onVoted);
    ctx.on("results", onResults);
    ctx.on("next", onNext);
    ctx.on("final", onFinal);
    ctx.on("again", onAgain);
    ctx.on("sync", onSync);
    ctx.onPlayersChange(onPlayersChange);

    showLobby();
    if (amHost) loadWords().catch(() => {});

    return () => {
      game.ended = true;
      for (const t of timers) { clearTimeout(t); clearInterval(t); }
      timers.clear();
      if (drawView) { drawView.board.discard(); drawView.root.remove(); }
    };
  }

  root.ScrawdleLobby.registerGame({
    id: "party",
    title: "Scrawdle Party",
    description: "Roll the die, everyone draws the word, then vote for the best drawing.",
    minPlayers: 1,
    ownsRoom: true,
    start,
  });
})(typeof window !== "undefined" ? window : globalThis);
