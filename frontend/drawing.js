/* Scrawdle drawing board: tools, undo/redo, auto-save in the browser, and the finish screen.
 *
 * The canvas is stored at twice its display size so lines stay sharp, and every drawing is the
 * same size no matter whose screen it was made on.
 *
 * To connect publishing, set:
 *   window.scrawdlePublish = async ({ blob, mode, prompts, day }) => { ... };
 * A "Publish drawing" button appears on the finish screen when that exists. `blob` is the
 * plain PNG of the drawing, and `prompts` is [{ label, value, optional }]. If it throws, the player
 * sees `err.userMessage` when it's set, and `err.alreadyPublished` turns the button off for that round.
 */
(function (root) {
  "use strict";

  const SCALE = 2;
  const HISTORY_BYTES = 96 * 1024 * 1024;
  // Ten bright crayon colours (plus the custom picker). Black first: it is the colour a round starts with.
  const COLORS = ["#1e1b2e", "#f23b3b", "#ff8a1f", "#ffd23f", "#4cc24a", "#2fb2ff", "#3557e8", "#7b4dff", "#ff4f9a", "#8b5a2b"];
  // Names for the colors, so nobody has to tell them apart by sight: shown on hover, read by screen
  // readers, and shown beside the tool's name for touch screens, where hovering isn't possible.
  const COLOR_NAMES = {
    "#1e1b2e": "Black", "#f23b3b": "Red", "#ff8a1f": "Orange", "#ffd23f": "Yellow", "#4cc24a": "Green",
    "#2fb2ff": "Sky blue", "#3557e8": "Blue", "#7b4dff": "Purple", "#ff4f9a": "Pink", "#8b5a2b": "Brown",
  };
  const colorName = (hex) => COLOR_NAMES[hex] || "Custom color";
  const TOOLS = [
    { id: "pen", label: "Pen", size: 3 },
    { id: "pencil", label: "Pencil", size: 4 },
    { id: "brush", label: "Brush", size: 14 },
    { id: "line", label: "Line", size: 3 },
    { id: "eraser", label: "Eraser", size: 20 },
    { id: "bucket", label: "Fill", size: null },
  ];

  const BRUSHES = [
    { id: "round", label: "Round" },
    { id: "marker", label: "Marker" },
    { id: "calligraphy", label: "Calligraphy" },
    { id: "crayon", label: "Crayon" },
    { id: "watercolor", label: "Watercolor" },
    { id: "spray", label: "Spray" },
    { id: "bristle", label: "Dry bristle" },
  ];
  // These build the whole stroke on a separate layer first, so a stroke doesn't darken
  // where it crosses itself. Later strokes still layer over earlier ones.
  const LAYERED = { marker: { alpha: 0.72, blend: "multiply" }, watercolor: { alpha: 0.5, blur: 0.14 } };

  const SIZE_PRESETS = [{ label: "Small", size: 2, dot: 5 }, { label: "Medium", size: 8, dot: 9 }, { label: "Large", size: 24, dot: 14 }];

  // The tools are chunky buzzer-pad keys (game.css draws the key round each): one 32 x 32 grid, a 2.8 round
  // outline in currentColor (cream on a violet key, ink on the gold key in your hand). Undo and Redo are arrows.
  const LINE = (body) => ({ box: "0 0 32 32", kind: "object", body: `<g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round">${body}</g>` });
  const ICONS = {
    pen: LINE('<path d="M6 26l2-7L21 6l5 5-13 13z"/><path d="M18 9l5 5"/>'),
    pencil: LINE('<path d="M6 26l2-7L21 6l5 5-13 13z"/><path d="M8 19l5 5"/><path d="M6.6 23.6L6 26l2.4-.6"/>'),
    brush: LINE('<path d="M26 5L15 17"/><path d="M14 17c-5-1-8 3-7 6 0 3-2 4-3 4 5 2 11 1 12-5 0-2-1-4-2-5z"/>'),
    line: LINE('<path d="M6 26L26 6"/><circle cx="6" cy="26" r="2.2" fill="currentColor"/><circle cx="26" cy="6" r="2.2" fill="currentColor"/>'),
    eraser: LINE('<path d="M11 26l-7-7L17 6l9 9-11 11z"/><path d="M10 13l9 9"/><path d="M15 26h13"/>'),
    bucket: LINE('<path d="M6 15l9-9 9 9-9 9z"/><path d="M11 3l4 3"/><path d="M26 19c2 3 2 6 0 6s-2-3 0-6z"/>'),
    clear: LINE('<path d="M6 9h20"/><path d="M12 9V5h8v4"/><path d="M8 9l2 18h12l2-18"/><path d="M14 14v8M18 14v8"/>'),
    undo: { box: "0 0 32 32", kind: "arrow", body: '<g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 7l-6 6 6 6"/><path d="M4 13h15c5 0 8 3 8 7s-3 7-8 7h-6"/></g>' },
    redo: { box: "0 0 32 32", kind: "arrow", body: '<g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 7l6 6-6 6"/><path d="M28 13H13c-5 0-8 3-8 7s3 7 8 7h6"/></g>' },
  };
  // Class names kept from before (tool-object for the tools, tool-chalk for the arrows), since Party's board styles them too.
  const iconOf = (name) => {
    const art = ICONS[name];
    const span = document.createElement("span");
    span.className = "tool-icon" + (art.kind === "object" ? " tool-object" : " tool-chalk");
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = `<svg viewBox="${art.box}" width="32" height="32" focusable="false">${art.body}</svg>`;
    return span;
  };

  // Versioned so pre-existing replay records retain their original width behavior.
  function brushWidthFactor(mode, pressure, speed = 0) {
    if (mode === "bounded") return pressure === null ? 1 : 0.25 + 0.75 * Math.max(0, Math.min(1, pressure));
    return pressure !== null ? 0.25 + pressure * 1.1 : Math.max(0.55, 1 - speed * 0.08);
  }

  /* ---------- Paint bucket ---------- */
  // Scanline fill on RGBA pixels. Colors within `tolerance` of the clicked one count as the same
  // area, then the fill grows one pixel so it tucks under the soft edges of lines.
  // Returns the changed rectangle, or null if nothing changed.
  function floodFill(pixels, width, height, startX, startY, rgba, tolerance) {
    const x0 = Math.floor(startX);
    const y0 = Math.floor(startY);
    if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return null;
    const at = (x0 + y0 * width) * 4;
    const tr = pixels[at], tg = pixels[at + 1], tb = pixels[at + 2], ta = pixels[at + 3];
    if (tr === rgba[0] && tg === rgba[1] && tb === rgba[2] && ta === rgba[3]) return null;

    const matches = (i) =>
      Math.abs(pixels[i] - tr) <= tolerance && Math.abs(pixels[i + 1] - tg) <= tolerance &&
      Math.abs(pixels[i + 2] - tb) <= tolerance && Math.abs(pixels[i + 3] - ta) <= tolerance;

    const seen = new Uint8Array(width * height);
    const stack = [x0 + y0 * width];
    let minX = x0, maxX = x0, minY = y0, maxY = y0;
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue;
      const y = Math.floor(p / width);
      let left = p;
      const rowStart = y * width;
      while (left > rowStart && !seen[left - 1] && matches((left - 1) * 4)) left--;
      let right = p;
      const rowEnd = rowStart + width - 1;
      while (right < rowEnd && !seen[right + 1] && matches((right + 1) * 4)) right++;
      for (let i = left; i <= right; i++) seen[i] = 1;
      minX = Math.min(minX, left - rowStart);
      maxX = Math.max(maxX, right - rowStart);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const nextRow of [y - 1, y + 1]) {
        if (nextRow < 0 || nextRow >= height) continue;
        const offset = (nextRow - y) * width;
        let inRun = false;
        for (let i = left; i <= right; i++) {
          const n = i + offset;
          const open = !seen[n] && matches(n * 4);
          if (open && !inRun) stack.push(n);
          inRun = open;
        }
      }
    }

    const paint = (p) => {
      const i = p * 4;
      pixels[i] = rgba[0]; pixels[i + 1] = rgba[1]; pixels[i + 2] = rgba[2]; pixels[i + 3] = rgba[3];
    };
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = x + y * width;
        if (!seen[p]) continue;
        paint(p);
        if (x > 0 && !seen[p - 1]) paint(p - 1);
        if (x < width - 1 && !seen[p + 1]) paint(p + 1);
        if (y > 0 && !seen[p - width]) paint(p - width);
        if (y < height - 1 && !seen[p + width]) paint(p + width);
      }
    }
    const x = Math.max(0, minX - 1);
    const y = Math.max(0, minY - 1);
    return { x, y, w: Math.min(width - 1, maxX + 1) - x + 1, h: Math.min(height - 1, maxY + 1) - y + 1 };
  }

  // A fill at partial opacity: floodFill paints solid color, so this goes back over the pixels it changed
  // and mixes the new color with what was there. `before` and `image` are ImageData-like ({ data, width }).
  function blendFill(before, image, rect, rgba, opacity) {
    if (!rect || opacity >= 1) return;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (x + y * image.width) * 4;
        if (image.data[i] === before.data[i] && image.data[i + 1] === before.data[i + 1] &&
            image.data[i + 2] === before.data[i + 2] && image.data[i + 3] === before.data[i + 3]) continue;
        for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(before.data[i + c] * (1 - opacity) + rgba[c] * opacity);
        image.data[i + 3] = 255;
      }
    }
  }

  /* ---------- Undo and redo ---------- */
  // Each entry keeps only the rectangle that changed. The oldest entries are dropped once the
  // total goes over the byte budget, but the newest always stays.
  class History {
    constructor(maxBytes) {
      this.maxBytes = maxBytes;
      this.entries = [];
      this.cursor = 0;
    }
    static size(e) { return e.before.data.length + e.after.data.length; }
    push(entry) {
      this.entries.length = this.cursor;
      this.entries.push(entry);
      let total = this.entries.reduce((sum, e) => sum + History.size(e), 0);
      while (total > this.maxBytes && this.entries.length > 1) total -= History.size(this.entries.shift());
      this.cursor = this.entries.length;
    }
    get canUndo() { return this.cursor > 0; }
    get canRedo() { return this.cursor < this.entries.length; }
    undo() { return this.canUndo ? this.entries[--this.cursor] : null; }
    redo() { return this.canRedo ? this.entries[this.cursor++] : null; }
    clear() { this.entries = []; this.cursor = 0; }
  }

  function dayKey(date) {
    const d = date || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /* ---------- Saved draft (IndexedDB, in this browser only) ---------- */
  // A picture as text (a data: URL), for browsers that won't store a picture file.
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const draftStore = {
    open() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("scrawdle", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("drafts");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async run(mode, action) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        let tx, req;
        try {
          tx = db.transaction("drafts", mode);
          req = action(tx.objectStore("drafts"));
        } catch (err) {
          db.close();
          reject(err);
          return;
        }
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("The save was cancelled")); };
      });
    },
    get(slot) { return this.run("readonly", (s) => s.get(slot)); },
    // Safari's private windows won't store a picture file in IndexedDB (the save is cancelled), but
    // they do store text. So if a save with a picture file fails, it's saved again with the picture as
    // text. draftImage and myDrawings.list read either kind. `stillWanted` lets a caller skip that
    // second try if a newer save has happened meanwhile, so an older drawing never lands on top of it.
    async put(draft, slot, stillWanted = () => true) {
      try {
        return await this.run("readwrite", (s) => s.put(draft, slot));
      } catch (err) {
        if (!draft || !(draft.blob instanceof Blob) || !stillWanted()) throw err;
        const { blob, ...rest } = draft;
        const asText = { ...rest, dataUrl: await blobToDataUrl(blob) };
        if (!stillWanted()) throw err;
        return this.run("readwrite", (s) => s.put(asText, slot));
      }
    },
    remove(slot) { return this.run("readwrite", (s) => s.delete(slot)); },
    keys() { return this.run("readonly", (s) => s.getAllKeys()); },
    // Saves from before Today and Free play had their own slots were all kept under "current".
    async migrate() {
      const old = await this.get("current");
      if (!old) return;
      await this.put(old, old.daily === false ? "free" : "today");
      await this.remove("current");
    },
  };
  // Daily Free Play (mode "scrawl") is a free draw with its own save, cleared each day like "today".
  // Daily Scrawl (mode "daily"), and the older "basic" and "detailed", share the "today" save.
  // A Time Challenge (round.timed) has its own slot, so it never replaces the Free Play drawing.
  const slotOf = (round) => (round.timed ? "timed" : round.mode === "scrawl" ? "scrawl" : round.daily === false ? "free" : "today");
  const SLOTS = ["today", "scrawl", "free", "timed"];

  // The finish screen's line for a Time Challenge. `timed` is { seconds, startedAt, used }: `used` is how
  // long it took, set when it ends; with none, it ended when the page was reloaded or left. Plain words, no emoji
  // (the game draws its own icons).
  function timedText(timed) {
    if (!timed || !timed.seconds) return "";
    if (typeof timed.used !== "number") return `${timed.seconds}-second Time Challenge. It ended when you left the drawing.`;
    if (timed.left) return `${timed.seconds}-second Time Challenge. You left after ${timed.used} ${timed.used === 1 ? "second" : "seconds"}.`;
    if (timed.used >= timed.seconds) return `Drawn in ${timed.seconds} seconds!`;
    return `Finished in ${timed.used} of ${timed.seconds} seconds!`;
  }
  // How long until local midnight, when the next day's parts arrive: "7h 12m", "12m", or "under a minute".
  function nextPartsIn(now = new Date()) {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(0, Math.round((midnight - now) / 60000));
    if (mins < 1) return "under a minute";
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  const draftImage = async (draft) => draft.blob || (await fetch(draft.dataUrl)).blob();
  // A drawing with something in it, as opposed to a round that was opened and left blank.
  // A canvas that was cleared and not drawn on again counts as blank: no "Continue drawing", nothing kept.
  const isMarked = (draft) => !Array.isArray(draft.ops) || draft.canReplay === false || (draft.ops.length > 0 && draft.ops[draft.ops.length - 1].type !== "clear");

  /* ---------- My drawings: finished drawings kept after their day ends (in this browser only) ---------- */
  // Stored in the same "drafts" store under keys starting "book|". A new store would mean a new database
  // version, and a page still open on the old code would then be unable to save.
  const BOOK = "book|";
  const BOOK_MAX = 60; // about two months of daily drawings; the oldest go first
  // Keys sort by day, then slot, then time, so sorting them sorts the drawings oldest first.
  const bookKey = (draft, slot) => `${BOOK}${draft.day}|${slot}|${String(draft.savedAt || 0).padStart(15, "0")}`;
  const keysToDrop = (keys, max = BOOK_MAX) => {
    const kept = keys.filter((k) => String(k).startsWith(BOOK)).sort();
    return kept.slice(0, Math.max(0, kept.length - max));
  };
  const myDrawings = {
    // Copies a drawing that's about to be thrown away or replaced. Blank rounds aren't kept.
    async keep(draft, slot, extra = {}) {
      if (!draft || !isMarked(draft)) return;
      const blob = await draftImage(draft);
      const entry = { day: draft.day, mode: draft.mode, daily: draft.daily !== false, prompts: draft.prompts, blob, savedAt: draft.savedAt || Date.now(), ...(draft.timed ? { timed: draft.timed } : {}), ...extra };
      await draftStore.put(entry, bookKey(entry, slot));
      for (const key of keysToDrop(await draftStore.keys())) await draftStore.remove(key);
    },
    // Newest first.
    async list() {
      const keys = (await draftStore.keys()).filter((k) => String(k).startsWith(BOOK)).sort().reverse();
      const out = [];
      for (const key of keys) {
        const entry = await draftStore.get(key);
        // Kept as text in a Safari private window: turned back into a picture file for the page.
        if (entry && (entry.blob || entry.dataUrl)) out.push({ key, ...entry, blob: await draftImage(entry) });
      }
      return out;
    },
    forget(key) { return String(key).startsWith(BOOK) ? draftStore.remove(key) : Promise.resolve(); },
    // How many are kept, without loading the pictures.
    async count() { return (await draftStore.keys()).filter((k) => String(k).startsWith(BOOK)).length; },
  };

  /* ---------- Sharing: the line that goes with a shared drawing, like a daily puzzle's ---------- */
  // A drawing's word: one word or phrase now (prompts = [{ label: category, value: word }]); drawings from the
  // animal-parts days have a list of parts, which reads as the parts joined with commas.
  // (a compound's non-breaking space from words.json reads and shares as a normal space)
  const wordOf = (prompts) => (Array.isArray(prompts) ? prompts.map((p) => p && p.value).filter(Boolean).map((v) => String(v).replace(/\u00a0/g, " ")).join(", ") : "");
  // `streak` is the player's current streak (streak.js); a daily drawing's line ends with it, Wordle-style, once
  // it's 3 days or more (the same point the home screen starts showing it).
  function shareLine({ mode, daily, prompts, day, timed }, url, streak = 0) {
    const date = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" });
    const fire = streak >= 3 ? ` · ${streak}-day streak` : "";
    if (mode === "scrawl") return `My Scrawdle Daily Doodle drawing for ${date}. Draw yours: ${url}${fire}`;
    const word = wordOf(prompts);
    if (timed && timed.seconds) return `My Scrawdle ${timed.seconds}-second Time Challenge: ${word}. Draw yours: ${url}`;
    if (daily === false) return `My Scrawdle Quick draw: ${word}. Draw yours: ${url}`;
    return `My Scrawdle Daily Word for ${date}: ${word}. Draw yours: ${url}${fire}`;
  }

  /* ---------- The finished image: the drawing in its gold-rimmed frame on the night set, the word and date under it ---------- */
  // Lettered in the show's own fonts (Shrikhand for the word, Bricolage Grotesque for the small line), stage.css.
  function letterDrawing(source, { prompts, day, timed, daily }) {
    const W = source.width;
    const H = source.height;
    const m = 56;           // the dark set round the frame
    const cut = 18;         // the frame: a navy bezel with a gold rim
    const measure = document.createElement("canvas").getContext("2d");
    const wordFont = '64px "Shrikhand", "Bricolage Grotesque", "Trebuchet MS", sans-serif';
    measure.font = wordFont;
    const raw = wordOf(prompts) || "Scrawdle";
    const word = raw.charAt(0).toUpperCase() + raw.slice(1);
    // The word wraps to the drawing's width.
    const lines = [""];
    for (const piece of word.split(/\s+/)) {
      const next = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${piece}` : piece;
      if (measure.measureText(next).width > W - 40 && lines[lines.length - 1]) lines.push(piece);
      else lines[lines.length - 1] = next;
    }
    const lineH = 74;
    const out = document.createElement("canvas");
    out.width = W + (m + cut) * 2;
    out.height = H + (m + cut) * 2 + 40 + lines.length * lineH + 64;
    const c = out.getContext("2d");
    const ground = c.createLinearGradient(0, 0, 0, out.height);
    ground.addColorStop(0, "#141038"); ground.addColorStop(1, "#0B0926");
    c.fillStyle = ground;
    c.fillRect(0, 0, out.width, out.height);
    const round = (x, y, w, h, r) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); };
    // the frame: a soft shadow, the gold rim, the navy bezel, then the drawing
    c.save();
    c.shadowColor = "rgba(0,0,0,.55)"; c.shadowBlur = 40; c.shadowOffsetY = 16;
    c.fillStyle = "#FFC23D";
    round(m - 6, m - 6, W + cut * 2 + 12, H + cut * 2 + 12, 48); c.fill();
    c.restore();
    c.fillStyle = "#120C35";
    round(m, m, W + cut * 2, H + cut * 2, 42); c.fill();
    c.fillStyle = "#FFFFFF";
    round(m + cut - 4, m + cut - 4, W + 8, H + 8, 18); c.fill();
    c.drawImage(source, m + cut, m + cut);
    const textTop = H + (m + cut) * 2 + 24;
    c.fillStyle = "#FFC23D";
    c.font = wordFont;
    c.textBaseline = "top";
    lines.forEach((line, i) => c.fillText(line, m, textTop + i * lineH));
    c.font = '700 30px "Bricolage Grotesque", "Trebuchet MS", sans-serif';
    c.fillStyle = "#C9BEF0";
    const date = new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const what = timed && timed.seconds ? `${timed.seconds}-second Time Challenge` : daily === false ? "Quick draw" : "Daily Word";
    c.fillText(`Scrawdle · ${what} · ${date}`, m, textTop + lines.length * lineH + 8);
    return out;
  }

  /* ---------- The board ---------- */
  // idPrefix keeps a second board's controls (a lobby game's, say) from repeating the main board's ids.
  // A board that is never given a round (start or restore) never saves, so it can't touch the drafts.
  // palette, if given, is where the colors go (the easel's ledge on the main drawing screen); otherwise
  // they sit in the tray with the tools, as on Scrawdle Party's board.
  function createBoard({ canvas, toolbar, settings, palette, idPrefix = "" }) {
    let ctx = canvas.getContext("2d", { willReadFrequently: true });
    const W = canvas.width;
    const H = canvas.height;
    const history = new History(HISTORY_BYTES);
    const sizes = Object.fromEntries(TOOLS.map((t) => [t.id, t.size]));
    const opacities = Object.fromEntries(TOOLS.map((t) => [t.id, 100])); // percent, kept separately for each tool
    let tool = "pen";
    let brushKind = "round";
    let filterWorks = "filter" in ctx;
    let color = COLORS[0];
    let round = null; // { mode, prompts, day }
    let stroke = null;
    let saveTimer = null;
    let saveGeneration = 0; // a slower, older save must never overwrite a newer state
    let unsaved = false;
    let openDb = null; // kept open so a last save can start while the page is closing
    // Everything drawn, in order, so it can be replayed. opsAt moves with undo and redo.
    let ops = [];
    let opsAt = 0;
    let canReplay = true;
    let locked = false; // set by setLocked; nothing locks the board since votes replaced self-judging
    let onDone = () => {};

    const rgba = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
    const paintColor = () => (tool === "eraser" ? "#ffffff" : color);
    const blank = () => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); };
    blank();
    const isBlank = () => new Uint32Array(ctx.getImageData(0, 0, W, H).data.buffer).every((px) => px === 0xffffffff);
    const seededRandom = (seed) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    /* --- toolbar --- */
    const el = (tag, props, ...kids) => {
      const n = Object.assign(document.createElement(tag), props);
      n.append(...kids);
      return n;
    };
    const trayButton = (icon, label, onclick) => el("button", { type: "button", className: "tool", onclick },
      iconOf(icon), el("span", { className: "tool-label", textContent: label }));
    const status = el("span", { className: "save-status", role: "status" });
    const toolButtons = {};
    for (const t of TOOLS) {
      toolButtons[t.id] = trayButton(t.id, t.label, () => setTool(t.id));
      toolButtons[t.id].dataset.tool = t.id; // so a small screen can leave out the extra tools (game.css)
    }
    const swatches = COLORS.map((c) => {
      const b = el("button", { type: "button", className: "swatch", title: colorName(c), onclick: () => setColor(c) });
      b.style.setProperty("--swatch", c);
      b.dataset.color = c;
      b.setAttribute("aria-label", colorName(c));
      return b;
    });
    // "Custom" opens Scrawdle's own color picker (color-picker.js), not the browser's built-in one,
    // so it looks the same in every browser. Each board gets its own.
    const wheel = el("button", { type: "button", className: "wheel", title: "Pick any color" });
    wheel.setAttribute("aria-label", "Pick any color");
    const picker = root.ScrawdleColorPicker ? root.ScrawdleColorPicker.create({ anchor: wheel, onInput: (c) => setColor(c) }) : null;
    wheel.addEventListener("click", () => { if (picker) picker.toggle(color); });
    // On the main drawing screen a joystick stands on the control deck. It is a real control: it opens the same
    // custom colour picker as the rainbow marker (arcade.css draws it; Party's board has no deck for it).
    const joystick = el("button", { type: "button", className: "joystick", title: "Pick any color" });
    joystick.setAttribute("aria-label", "Pick any color");
    joystick.addEventListener("click", () => { if (picker) picker.toggle(color); });
    const sizeInput = el("input", { type: "range", min: 1, max: 60, value: 3, id: `${idPrefix}tool-size`, oninput: (e) => {
      if (sizes[tool] !== null) sizes[tool] = Number(e.target.value);
      refreshToolbar();
    } });
    sizeInput.setAttribute("aria-label", "Stroke size");
    const presetButtons = SIZE_PRESETS.map((p) => {
      const dot = el("i");
      dot.style.width = dot.style.height = `${p.dot}px`;
      const b = el("button", { type: "button", className: "size-dot", onclick: () => {
        if (sizes[tool] !== null) sizes[tool] = p.size;
        refreshToolbar();
      } }, dot);
      b.setAttribute("aria-label", `${p.label} stroke`);
      return b;
    });
    const preview = el("span", { className: "stroke-preview" });
    preview.setAttribute("aria-hidden", "true");
    preview.innerHTML = '<svg viewBox="0 0 48 30" width="48" height="30"><path d="M5 20c8-14 14-14 19-5s11 7 19-5"/></svg>';
    const previewLine = preview.querySelector("path");
    const opacityInput = el("input", { type: "range", min: 5, max: 100, value: 100, id: `${idPrefix}tool-opacity`, oninput: (e) => {
      opacities[tool] = Number(e.target.value);
      refreshToolbar();
    } });
    opacityInput.setAttribute("aria-label", "Opacity");
    const opacityValue = el("output", { className: "opacity-value", textContent: "100%" });
    opacityValue.htmlFor = `${idPrefix}tool-opacity`;
    const opacityRow = el("div", { className: "opacity-row" }, el("span", { textContent: "Opacity" }), opacityValue);
    const sizeGroup = el("div", { className: "tray-group tray-sizes" },
      el("div", { className: "size-top" }, ...presetButtons, preview), sizeInput, el("div", { className: "tool-opacity" }, opacityRow, opacityInput));
    const brushSelect = el("select", { id: `${idPrefix}brush-kind`, onchange: (e) => { brushKind = e.target.value; } },
      ...BRUSHES.map((b) => el("option", { value: b.id, textContent: b.label })));
    const brushLabel = el("label", { className: "brush-kind", htmlFor: `${idPrefix}brush-kind` }, el("span", { textContent: "Brush type" }), brushSelect);
    const undoBtn = trayButton("undo", "Undo", undo);
    undoBtn.dataset.act = "undo";
    const redoBtn = trayButton("redo", "Redo", redo);
    redoBtn.dataset.act = "redo";
    const clearBtn = trayButton("clear", "Clear", clearAll);
    clearBtn.setAttribute("aria-label", "Clear canvas");
    const doneBtn = el("button", { type: "button", className: "btn primary done", onclick: () => onDone() });
    doneBtn.innerHTML = '<svg class="done-tick" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path d="M6 17l7 7L26 8" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Done!</span>';
    const brushPanel = el("div", { className: "brush-panel", hidden: true, id: `${idPrefix}brush-panel` });
    const wideSettings = window.matchMedia("(min-width: 1000px)");
    const brushToggle = el("button", {type: "button", className: "brush-toggle", textContent: "Round · brush settings"});
    brushToggle.setAttribute("aria-controls", `${idPrefix}brush-panel`);
    brushToggle.setAttribute("aria-expanded", "false");
    const brushChoices = BRUSHES.map((b) => {
      const choice = el("button", {type: "button", className: "brush-choice", textContent: b.label, onclick: () => {
        brushKind = b.id; brushSelect.value = b.id; refreshToolbar();
      }});
      choice.dataset.kind = b.id;
      brushPanel.append(choice);
      return choice;
    });
    brushToggle.onclick = () => {
      brushPanel.hidden = !brushPanel.hidden;
      if (!brushPanel.hidden) renderBrushPreviews();
      brushToggle.setAttribute("aria-expanded", String(!brushPanel.hidden));
    };
    brushPanel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { brushPanel.hidden = true; brushToggle.setAttribute("aria-expanded", "false"); brushToggle.focus(); }
    });
    const brushControls = el("div", {className: "brush-controls"}, brushToggle, brushPanel);
    const sizeValue = el("output", {className: "size-value", textContent: "3 px"});
    sizeValue.htmlFor = `${idPrefix}tool-size`;
    sizeGroup.prepend(sizeValue);
    const custom = el("div", {className: "custom-color"}, wheel, el("span", {textContent: "Custom"}));
    if (picker) custom.append(picker.el);
    const colorGroup = el("div", {className: "tray-group tray-colors"}, el("div", {className: "swatches"}, ...swatches), custom);
    if (palette) palette.append(colorGroup);
    const footer = el("div", {className: "studio-footer"}, ...(palette ? [joystick] : []), status,
      el("div", {className: "history-actions"}, undoBtn, redoBtn, clearBtn), doneBtn);
    toolbar.append(
      el("div", {className: "tray"},
        el("div", {className: "tray-group tray-tools"}, ...Object.values(toolButtons)),
        ...(palette ? [] : [colorGroup]),
        ...(settings ? [] : [sizeGroup])),
      footer
    );

    /* --- toast: one short line with one action, for things that can be undone; never a question box --- */
    // It lives in the board's own dialog when there is one (Scrawdle Party draws inside the lobby game), since a
    // modal dialog would cover anything fixed to the page.
    const toastEl = el("div", { className: "toast", role: "status" });
    const toastText = el("span", { className: "toast-text" });
    const toastAction = el("button", { type: "button", className: "toast-action", hidden: true });
    toastEl.append(toastText, toastAction);
    (canvas.closest("dialog") || document.body).append(toastEl);
    let toastTimer = null;
    function hideToast() { clearTimeout(toastTimer); toastEl.classList.remove("show"); }
    function toast(text, { action, onAction, ms = 5000 } = {}) {
      clearTimeout(toastTimer);
      toastText.textContent = text;
      toastAction.hidden = !action;
      toastAction.textContent = action || "";
      toastAction.onclick = () => { hideToast(); if (onAction) onAction(); };
      // Above the deck when the deck runs along the bottom of the window; otherwise (the deck is a side column, on a
      // phone held sideways or a wide monitor) at the top, in the empty middle of the top row, never over the colors.
      const bar = footer.getBoundingClientRect();
      const bottomBar = bar.width > innerWidth * 0.6 && bar.bottom >= innerHeight - 48 && bar.top > 0;
      toastEl.style.bottom = bottomBar ? `${innerHeight - bar.top + 12}px` : "auto";
      toastEl.style.top = bottomBar ? "auto" : "12px";
      requestAnimationFrame(() => toastEl.classList.add("show"));
      toastTimer = setTimeout(hideToast, ms);
    }

    const settingsTitle = el("h2", {className: "settings-title", textContent: "Pen"});
    if (settings) settings.append(settingsTitle, brushControls, sizeGroup);
    else toolbar.append(brushControls);
    function syncBrushPanel() {
      brushPanel.hidden = !(wideSettings.matches && tool === "brush");
      brushToggle.setAttribute("aria-expanded", String(!brushPanel.hidden));
      if (!brushPanel.hidden) renderBrushPreviews();
    }
    wideSettings.addEventListener("change", syncBrushPanel);

    function refreshToolbar() {
      for (const [id, b] of Object.entries(toolButtons)) b.setAttribute("aria-pressed", String(id === tool));
      for (const b of swatches) b.setAttribute("aria-pressed", String(b.dataset.color === color));
      wheel.classList.toggle("on", !COLORS.includes(color));
      wheel.style.setProperty("--custom-color", color);
      const noSize = sizes[tool] === null;
      sizeInput.disabled = noSize;
      for (const b of presetButtons) b.disabled = noSize;
      sizeGroup.classList.toggle("no-size", noSize);
      const toolName = tool === "brush" ? "Brushes" : TOOLS.find(t => t.id === tool).label;
      settingsTitle.textContent = tool === "eraser" ? toolName : `${toolName} · ${colorName(color)}`;
      brushLabel.hidden = tool !== "brush";
      brushControls.hidden = tool !== "brush";
      brushToggle.textContent = `${BRUSHES.find(b => b.id === brushKind).label} · brush settings`;
      brushChoices.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.kind === brushKind)));
      markDone(); // a fresh or restored canvas dims Done until something is drawn
      sizeValue.textContent = noSize ? "Fill area" : `${sizes[tool]} px`;
      if (!noSize) {
        sizeInput.value = sizes[tool];
        SIZE_PRESETS.forEach((p, i) => presetButtons[i].setAttribute("aria-pressed", String(p.size === sizes[tool])));
        previewLine.style.strokeWidth = Math.min(16, Math.max(1.5, sizes[tool] * 0.75));
      }
      opacityInput.value = opacities[tool];
      opacityValue.textContent = `${opacities[tool]}%`;
      previewLine.style.opacity = opacities[tool] / 100;
      // White and the eraser wouldn't show on the tray, so they preview in soft grey.
      previewLine.style.stroke = tool === "eraser" || color === "#ffffff" ? "#c9c2b2" : color;
      undoBtn.disabled = locked || !history.canUndo;
      redoBtn.disabled = locked || !history.canRedo;
      clearBtn.disabled = locked;
      canvas.dataset.tool = tool;
    }
    function setTool(id) { tool = id; refreshToolbar(); syncBrushPanel(); }
    function setColor(c) {
      color = c;
      if (!brushPanel.hidden) renderBrushPreviews();
      if (tool === "eraser") tool = "pen";
      refreshToolbar();
    }

    /* --- history --- */
    function record(rect, before, op) {
      if (!rect || rect.w <= 0 || rect.h <= 0) return;
      history.push({ x: rect.x, y: rect.y, before, after: ctx.getImageData(rect.x, rect.y, rect.w, rect.h) });
      ops.length = opsAt;
      ops.push(op);
      opsAt = ops.length;
      changed();
    }
    function crop(source, rect) {
      const out = ctx.createImageData(rect.w, rect.h);
      for (let row = 0; row < rect.h; row++) {
        const start = ((rect.y + row) * source.width + rect.x) * 4;
        out.data.set(source.data.subarray(start, start + rect.w * 4), row * rect.w * 4);
      }
      return out;
    }
    function undo() {
      if (locked || stroke) return; // finish the stroke first, or history would fall out of order
      hideToast(); // "Cleared. Undo" is answered, or stale
      const e = history.undo();
      if (e) { opsAt--; ctx.putImageData(e.before, e.x, e.y); changed(); }
    }
    function redo() {
      if (locked || stroke) return;
      hideToast();
      const e = history.redo();
      if (e) { opsAt++; ctx.putImageData(e.after, e.x, e.y); changed(); }
    }
    function clearAll() {
      if (locked || stroke || isBlank()) return;
      const before = ctx.getImageData(0, 0, W, H);
      blank();
      record({ x: 0, y: 0, w: W, h: H }, before, { type: "clear" });
      toast("Cleared.", { action: "Undo", onAction: undo }); // it acts at once; the way back is right there for 5 s
    }
    function changed() {
      refreshToolbar();
      scheduleSave();
    }

    /* --- strokes --- */
    function point(e) {
      const r = canvas.getBoundingClientRect();
      const bx = canvas.clientLeft;
      const by = canvas.clientTop;
      return {
        x: (e.clientX - r.left - bx) * (W / canvas.clientWidth),
        y: (e.clientY - r.top - by) * (H / canvas.clientHeight),
        pressure: e.pointerType === "pen" ? e.pressure : null,
        t: e.timeStamp,
      };
    }
    function grow(x, y, pad) {
      const b = stroke.box;
      b.minX = Math.min(b.minX, x - pad); b.maxX = Math.max(b.maxX, x + pad);
      b.minY = Math.min(b.minY, y - pad); b.maxY = Math.max(b.maxY, y + pad);
    }
    function boxRect(b) {
      const x = Math.max(0, Math.floor(b.minX));
      const y = Math.max(0, Math.floor(b.minY));
      return { x, y, w: Math.min(W, Math.ceil(b.maxX)) - x, h: Math.min(H, Math.ceil(b.maxY)) - y };
    }

    // Repeatable noise tied to a spot on the paper.
    function grain(x, y) {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return n - Math.floor(n);
    }
    function showLayer() {
      const s = stroke;
      const look = LAYERED[s.kind];
      // Only the stroke's own area changes, so only that area is put back and redrawn.
      const r = boxRect(s.box);
      ctx.putImageData(s.base, 0, 0, r.x, r.y, r.w, r.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.globalAlpha = look.alpha * s.opacity;
      // White can't show through "multiply", so it paints normally.
      if (look.blend && paintColorOf(s) !== "#ffffff") ctx.globalCompositeOperation = look.blend;
      if (look.blur && filterWorks) ctx.filter = `blur(${(s.width * look.blur).toFixed(1)}px)`;
      ctx.drawImage(s.layer.canvas, 0, 0);
      ctx.restore();
    }
    const paintColorOf = (s) => s.color;
    // Runs the drawing code on the stroke's fade layer, which is what `ctx` means for that moment.
    function onFade(s, fn) {
      const real = ctx;
      ctx = s.fade;
      try { fn(); } finally { ctx = real; }
    }
    // Puts back the original where the stroke is, then shows the fade layer over it at the stroke's opacity.
    function showFade(s) {
      const r = boxRect(s.box);
      ctx.putImageData(s.base, 0, 0, r.x, r.y, r.w, r.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.globalAlpha = s.opacity;
      ctx.drawImage(s.fade.canvas, 0, 0);
      ctx.restore();
    }

    function dab(x, y, radius) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(radius, 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    const draw = {
      smooth(p) { // pen and eraser: curves through the midpoints of the points
        const s = stroke;
        const mid = { x: (s.last.x + p.x) / 2, y: (s.last.y + p.y) / 2 };
        ctx.lineWidth = s.width;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(s.mid.x, s.mid.y);
        ctx.quadraticCurveTo(s.last.x, s.last.y, mid.x, mid.y);
        ctx.stroke();
        s.mid = mid;
        grow(p.x, p.y, s.width);
        grow(s.last.x, s.last.y, s.width);
      },
      pencil(p) { // scattered graphite grains along the path
        const s = stroke;
        const dist = Math.hypot(p.x - s.last.x, p.y - s.last.y);
        const steps = Math.max(1, Math.ceil(dist / 1.5));
        const spread = s.width / 2;
        for (let i = 1; i <= steps; i++) {
          const x = s.last.x + ((p.x - s.last.x) * i) / steps;
          const y = s.last.y + ((p.y - s.last.y) * i) / steps;
          const grains = Math.ceil(spread * 1.1) + 1;
          for (let g = 0; g < grains; g++) {
            const a = s.random() * Math.PI * 2;
            const r = s.random() * spread;
            ctx.globalAlpha = 0.2 + s.random() * 0.45;
            ctx.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, 1.6, 1.6);
          }
        }
        ctx.globalAlpha = 1;
        grow(p.x, p.y, spread + 3);
        grow(s.last.x, s.last.y, spread + 3);
      },
      brush(p) {
        const kinds = { marker: draw.layered, watercolor: draw.layered, calligraphy: draw.calligraphy, crayon: draw.crayon, spray: draw.spray, bristle: draw.bristle };
        (kinds[stroke.kind] || draw.round)(p);
      },
      layered(p) { // marker and watercolor: draw on the layer, then show it over the original
        const s = stroke;
        const mid = { x: (s.last.x + p.x) / 2, y: (s.last.y + p.y) / 2 };
        const l = s.layer;
        l.lineWidth = s.width;
        l.beginPath();
        l.moveTo(s.mid.x, s.mid.y);
        l.quadraticCurveTo(s.last.x, s.last.y, mid.x, mid.y);
        l.stroke();
        s.mid = mid;
        grow(p.x, p.y, s.width * 1.5);
        grow(s.last.x, s.last.y, s.width * 1.5);
        if (!s.quiet) paintSoon(s); // a replay shows the layer once per frame itself
      },
      calligraphy(p) { // a slanted nib: thick one way, thin the other
        const s = stroke;
        const nx = Math.cos(-Math.PI / 4) * s.width * 0.6;
        const ny = Math.sin(-Math.PI / 4) * s.width * 0.6;
        ctx.beginPath();
        ctx.moveTo(s.last.x - nx, s.last.y - ny);
        ctx.lineTo(s.last.x + nx, s.last.y + ny);
        ctx.lineTo(p.x + nx, p.y + ny);
        ctx.lineTo(p.x - nx, p.y - ny);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.stroke();
        grow(p.x, p.y, s.width);
        grow(s.last.x, s.last.y, s.width);
      },
      crayon(p) { // wax catches a fixed paper grain, so gaps stay put when you go over them
        const s = stroke;
        const r = s.width / 2;
        const dist = Math.hypot(p.x - s.last.x, p.y - s.last.y);
        const steps = Math.max(1, Math.ceil(dist / Math.max(1.5, r / 3)));
        for (let i = 1; i <= steps; i++) {
          const cx = s.last.x + ((p.x - s.last.x) * i) / steps;
          const cy = s.last.y + ((p.y - s.last.y) * i) / steps;
          for (let dy = -r; dy <= r; dy += 2) {
            for (let dx = -r; dx <= r; dx += 2) {
              if (dx * dx + dy * dy > r * r) continue;
              const gx = Math.round((cx + dx) / 2);
              const gy = Math.round((cy + dy) / 2);
              if (grain(gx, gy) > 0.42) ctx.fillRect(gx * 2, gy * 2, 2, 2);
            }
          }
        }
        grow(p.x, p.y, r + 3);
        grow(s.last.x, s.last.y, r + 3);
      },
      spray(p) { // a mist of dots, denser in the middle
        const s = stroke;
        const r = s.width;
        const dist = Math.hypot(p.x - s.last.x, p.y - s.last.y);
        const dots = Math.ceil(10 + r * 0.8 + dist * 2);
        for (let i = 0; i < dots; i++) {
          const a = s.random() * Math.PI * 2;
          const d = r * Math.pow(s.random(), 1.6);
          const t = s.random();
          ctx.globalAlpha = 0.35 + s.random() * 0.5;
          ctx.fillRect(s.last.x + (p.x - s.last.x) * t + Math.cos(a) * d, s.last.y + (p.y - s.last.y) * t + Math.sin(a) * d, 2, 2);
        }
        ctx.globalAlpha = 1;
        grow(p.x, p.y, r + 3);
        grow(s.last.x, s.last.y, r + 3);
      },
      bristle(p) { // separate hairs that run dry at different rates
        const s = stroke;
        const dx = p.x - s.last.x;
        const dy = p.y - s.last.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.5) return;
        const nx = -dy / dist;
        const ny = dx / dist;
        const prev = s.normal || { x: nx, y: ny };
        s.travel += dist;
        ctx.lineCap = "round";
        for (const hair of s.hairs) {
          const ink = Math.max(0, 1 - s.travel / hair.reach);
          if (ink <= 0) continue;
          ctx.globalAlpha = hair.alpha * (0.35 + 0.65 * ink);
          ctx.lineWidth = hair.width;
          ctx.beginPath();
          ctx.moveTo(s.last.x + prev.x * hair.at, s.last.y + prev.y * hair.at);
          ctx.lineTo(p.x + nx * hair.at, p.y + ny * hair.at);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        s.normal = { x: nx, y: ny };
        grow(p.x, p.y, s.width);
        grow(s.last.x, s.last.y, s.width);
      },
      round(p) { // width follows stylus pressure, or speed for a mouse or finger
        const s = stroke;
        const dist = Math.hypot(p.x - s.last.x, p.y - s.last.y);
        const dt = Math.max(p.t - s.last.t, 4);
        // Average the speed over recent points so one uneven event can't pinch the line.
        s.speed = s.speed * 0.85 + (dist / dt) * 0.15;
        const factor = brushWidthFactor(s.widthMode, p.pressure, s.speed);
        const target = s.radius + ((s.width / 2) * factor - s.radius) * 0.25;
        const steps = Math.max(1, Math.ceil(dist / Math.max(1, s.radius / 3)));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          dab(s.last.x + (p.x - s.last.x) * t, s.last.y + (p.y - s.last.y) * t, s.radius + (target - s.radius) * t);
        }
        s.radius = target;
        grow(p.x, p.y, s.width);
        grow(s.last.x, s.last.y, s.width);
      },
    };

    // Render samples with the actual brush engine, without modifying the drawing or history.
    function renderBrushPreviews() {
      const realCtx = ctx, realStroke = stroke;
      if (realStroke) return;
      const surface = document.createElement("canvas");
      surface.width = W; surface.height = H;
      try {
        for (const choice of brushChoices) {
          ctx = surface.getContext("2d", {willReadFrequently: true});
          ctx.clearRect(0, 0, W, H);
          const points = Array.from({length: 41}, (_, i) => ({x: 20 + i * 4, y: 38 - Math.sin(i / 40 * Math.PI * 2) * 12, t: i * 16, pressure: null}));
          const op = {tool: "brush", kind: choice.dataset.kind, color, width: 15, widthMode: "bounded", seed: 1234, points};
          openStroke(op); stroke.quiet = true;
          for (const point of points.slice(1)) extend(point);
          closeStroke();
          let sample = choice.querySelector("canvas");
          if (!sample) { sample = document.createElement("canvas"); sample.width = 200; sample.height = 76; sample.setAttribute("aria-hidden", "true"); choice.prepend(sample); }
          const sampleCtx = sample.getContext("2d");
          sampleCtx.clearRect(0, 0, 200, 76);
          sampleCtx.drawImage(surface, 0, 0, 200, 76, 0, 0, 200, 76);
        }
      } finally { ctx = realCtx; stroke = realStroke; }
    }

    function begin(e) {
      if (locked || !e.isPrimary || e.button !== 0 || stroke) return;
      e.preventDefault();
      const p = point(e);
      if (tool === "bucket") { fill(p); splash(p, color); return; }
      canvas.setPointerCapture(e.pointerId);
      const op = {
        type: "stroke", tool, kind: tool === "brush" ? brushKind : null, color: paintColor(),
        width: sizes[tool] * SCALE, widthMode: "bounded", seed: Math.floor(Math.random() * 4294967296), points: [p],
        opacity: opacities[tool] / 100,
      };
      openStroke(op);
      stroke.id = e.pointerId;
      stroke.op = op;
      if (op.kind === "spray") {
        stroke.timer = setInterval(() => { if (stroke && stroke.kind === "spray") addPoint(stroke.last); }, 50);
      }
    }
    // Starts a stroke from its recorded settings. Live drawing and replay both use this.
    function openStroke(op) {
      const p = op.points[0];
      const { tool: strokeTool, kind, width } = op;
      ctx.fillStyle = ctx.strokeStyle = op.color;
      ctx.lineCap = ctx.lineJoin = "round";
      const opacity = op.opacity === undefined ? 1 : op.opacity; // older saved strokes have none
      stroke = { opacity, widthMode: op.widthMode, tool: strokeTool, kind, color: op.color, width, random: seededRandom(op.seed), base: ctx.getImageData(0, 0, W, H), start: p, last: p, mid: p, radius: op.widthMode === "bounded" ? width / 2 * brushWidthFactor(op.widthMode, p.pressure) : strokeTool === "brush" ? width * 0.4 : width / 2, speed: 0, travel: 0, moved: false, box: { minX: p.x, maxX: p.x, minY: p.y, maxY: p.y } };
      grow(p.x, p.y, width * 1.5 + 3);
      // Below full opacity, a stroke that isn't already layered is drawn on its own transparent layer
      // and shown over the original, so crossing itself doesn't darken it (like marker and watercolor).
      if (opacity < 1 && !LAYERED[kind]) {
        const layer = document.createElement("canvas");
        layer.width = W;
        layer.height = H;
        const l = layer.getContext("2d", { willReadFrequently: true });
        l.strokeStyle = l.fillStyle = op.color;
        l.lineCap = l.lineJoin = "round";
        stroke.fade = l;
      }
      if (LAYERED[kind]) {
        const layer = document.createElement("canvas");
        layer.width = W;
        layer.height = H;
        const l = layer.getContext("2d");
        l.strokeStyle = l.fillStyle = stroke.color;
        l.lineCap = l.lineJoin = "round";
        l.beginPath();
        l.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
        l.fill();
        stroke.layer = l;
        showLayer();
      } else if (stroke.fade) {
        onFade(stroke, () => {
          if (kind === "bristle") {
            const count = Math.max(6, Math.round(width / 2));
            stroke.hairs = Array.from({ length: count }, () => ({
              at: (stroke.random() - 0.5) * width,
              width: 0.8 + stroke.random() * 2.2,
              alpha: 0.45 + stroke.random() * 0.55,
              reach: 300 + stroke.random() * 1500,
            }));
            draw.bristle({ ...p, x: p.x + 0.8 });
          } else if (kind === "calligraphy") draw.calligraphy(p);
          else if (kind === "crayon") draw.crayon(p);
          else if (kind === "spray") draw.spray(p);
          else if (strokeTool === "brush") dab(p.x, p.y, stroke.radius);
          else if (strokeTool === "pencil") draw.pencil(p);
          else if (strokeTool !== "line") dab(p.x, p.y, width / 2);
        });
        showFade(stroke);
      } else if (kind === "bristle") {
        const count = Math.max(6, Math.round(width / 2));
        stroke.hairs = Array.from({ length: count }, () => ({
          at: (stroke.random() - 0.5) * width,
          width: 0.8 + stroke.random() * 2.2,
          alpha: 0.45 + stroke.random() * 0.55,
          reach: 300 + stroke.random() * 1500,
        }));
        draw.bristle({ ...p, x: p.x + 0.8 });
      } else if (kind === "calligraphy") draw.calligraphy(p);
      else if (kind === "crayon") draw.crayon(p);
      else if (kind === "spray") draw.spray(p);
      else if (strokeTool === "brush") dab(p.x, p.y, stroke.radius);
      else if (strokeTool === "pencil") draw.pencil(p);
      else if (strokeTool !== "line") dab(p.x, p.y, width / 2);
    }
    function addPoint(p) {
      // A line only needs its two ends, so it doesn't keep every point the mouse passed through.
      if (stroke.tool === "line") stroke.op.points = [stroke.op.points[0], p];
      else stroke.op.points.push(p);
      extend(p);
    }
    function extend(p) {
      const s = stroke;
      if (s.tool === "line") {
        grow(p.x, p.y, s.width);
        s.last = p;
        s.moved = true;
        if (s.quiet) drawLine(s); else paintSoon(s);
        return;
      } else if (s.fade) {
        onFade(s, () => { if (s.tool === "pencil") draw.pencil(p); else if (s.tool === "brush") draw.brush(p); else draw.smooth(p); });
        if (!s.quiet) paintSoon(s);
      } else if (s.tool === "pencil") draw.pencil(p);
      else if (s.tool === "brush") draw.brush(p);
      else draw.smooth(p);
      s.last = p;
      s.moved = true;
    }
    // Puts back only where the last preview was, then draws the line to the newest point.
    function drawLine(s) {
      if (s.fade) {
        s.fade.clearRect(0, 0, W, H);
        s.fade.lineWidth = s.width;
        s.fade.beginPath();
        s.fade.moveTo(s.start.x, s.start.y);
        s.fade.lineTo(s.last.x, s.last.y);
        s.fade.stroke();
        showFade(s);
        return;
      }
      if (s.drawn) ctx.putImageData(s.base, 0, 0, s.drawn.x, s.drawn.y, s.drawn.w, s.drawn.h);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.start.x, s.start.y);
      ctx.lineTo(s.last.x, s.last.y);
      ctx.stroke();
      const pad = s.width + 2;
      s.drawn = boxRect({ minX: Math.min(s.start.x, s.last.x) - pad, maxX: Math.max(s.start.x, s.last.x) + pad, minY: Math.min(s.start.y, s.last.y) - pad, maxY: Math.max(s.start.y, s.last.y) + pad });
    }
    // Mice and pens can send many points per frame, so the line and layered brushes redraw at
    // most once per frame instead of once per point.
    function paintSoon(s) {
      s.dirty = true;
      if (s.frame) return;
      s.frame = requestAnimationFrame(() => {
        s.frame = 0;
        if (stroke === s) paint(s);
      });
    }
    function paint(s) {
      s.dirty = false;
      if (s.tool === "line") drawLine(s); else if (s.fade) showFade(s); else showLayer();
    }
    function move(e) {
      if (!stroke || e.pointerId !== stroke.id) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of events.length ? events : [e]) addPoint(point(ev));
    }
    function end(e) {
      if (!stroke || e.pointerId !== stroke.id) return;
      const op = stroke.op;
      const s = closeStroke();
      const rect = boxRect(s.box);
      record(rect, crop(s.base, rect), op);
    }
    function closeStroke() {
      const s = stroke;
      const target = s.fade || ctx; // the fade layer takes the stroke's drawing, then is shown over the original
      if (s.moved && (s.tool === "pen" || s.tool === "eraser")) {
        target.lineWidth = s.width;
        target.lineCap = "round";
        target.beginPath();
        target.moveTo(s.mid.x, s.mid.y);
        target.lineTo(s.last.x, s.last.y);
        target.stroke();
      }
      cancelAnimationFrame(s.frame);
      if (s.tool === "line" && s.dirty) paint(s);
      if (s.tool === "line" && !s.moved) { if (s.fade) onFade(s, () => dab(s.start.x, s.start.y, s.width / 2)); else dab(s.start.x, s.start.y, s.width / 2); }
      if (s.fade) showFade(s);
      if (s.layer) {
        s.layer.lineWidth = s.width;
        s.layer.beginPath();
        s.layer.moveTo(s.mid.x, s.mid.y);
        s.layer.lineTo(s.last.x, s.last.y);
        s.layer.stroke();
        showLayer();
      }
      clearInterval(s.timer);
      stroke = null;
      return s;
    }
    function fillAt(x, y, fillColor, opacity = 1) {
      const image = ctx.getImageData(0, 0, W, H);
      const before = ctx.getImageData(0, 0, W, H);
      const rect = floodFill(image.data, W, H, x, y, rgba(fillColor), 40);
      blendFill(before, image, rect, rgba(fillColor), opacity);
      if (rect) ctx.putImageData(image, 0, 0);
      return { rect, before };
    }
    // A splash when the bucket pours: a blob bursting out from the tap with a few droplets, in the paint's colour, on a
    // layer over the canvas for a third of a second (the real fill is already underneath). Not with reduced motion.
    let splashLayer = null;
    function splash(p, col) {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      if (!splashLayer) {
        splashLayer = document.createElement("canvas");
        splashLayer.className = "splash-layer";
        splashLayer.setAttribute("aria-hidden", "true");
        if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
        parent.append(splashLayer);
      }
      const r = canvas.getBoundingClientRect(), pr = parent.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      Object.assign(splashLayer.style, { left: `${r.left - pr.left}px`, top: `${r.top - pr.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      splashLayer.width = Math.round(r.width * dpr);
      splashLayer.height = Math.round(r.height * dpr);
      const s = splashLayer.getContext("2d");
      s.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = p.x / W * r.width, cy = p.y / H * r.height;
      const R = Math.max(26, Math.min(r.width, r.height) * .11);
      const lobes = Array.from({ length: 10 }, (_, i) => ({ a: (i / 10) * Math.PI * 2 + (Math.random() - .5) * .4, k: .65 + Math.random() * .7 }));
      const drops = Array.from({ length: 7 }, () => { const a = Math.random() * Math.PI * 2; return { a, d: R * (1.4 + Math.random() * 1.3), s: 3 + Math.random() * 5 }; });
      const t0 = performance.now(), DURATION = 380;
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / DURATION), ease = 1 - Math.pow(1 - t, 3);
        s.clearRect(0, 0, r.width, r.height);
        s.globalAlpha = 1 - t * t;
        s.fillStyle = col;
        s.strokeStyle = "rgba(30, 28, 25, .6)";
        s.lineWidth = 2;
        s.lineJoin = "round";
        s.beginPath(); // the blob: a wobbly ring of lobes growing out from the tap
        lobes.forEach((l, i) => {
          const rad = R * ease * l.k, x = cx + Math.cos(l.a) * rad, y = cy + Math.sin(l.a) * rad;
          if (i === 0) s.moveTo(x, y); else s.quadraticCurveTo(cx + Math.cos(l.a - .31) * rad * .55, cy + Math.sin(l.a - .31) * rad * .55, x, y);
        });
        s.closePath(); s.fill(); s.stroke();
        for (const d of drops) { // droplets fly out and fall a little
          const dist = d.d * ease, x = cx + Math.cos(d.a) * dist, y = cy + Math.sin(d.a) * dist + 16 * t * t;
          s.beginPath(); s.arc(x, y, d.s * (1 - t * .4), 0, Math.PI * 2); s.fill(); s.stroke();
        }
        if (t < 1) requestAnimationFrame(tick); else s.clearRect(0, 0, r.width, r.height);
      };
      requestAnimationFrame(tick);
    }
    function fill(p) {
      const opacity = opacities.bucket / 100;
      const { rect, before } = fillAt(p.x, p.y, color, opacity);
      if (rect) record(rect, crop(before, rect), { type: "fill", x: p.x, y: p.y, color, opacity });
    }

    /* --- replay: redraws the recorded strokes on another canvas, with the same code --- */
    function replay(target, { onEnd, instant = false } = {}) {
      target.width = W;
      target.height = H;
      const replayCtx = target.getContext("2d", { willReadFrequently: true });
      const steps = ops.slice(0, opsAt);
      const units = steps.reduce((sum, op) => sum + (op.points ? op.points.length + 1 : 1), 0) || 1;
      // Short enough to get to the finished drawing, however long it took to make.
      const duration = Math.min(4000, Math.max(2000, units * 8));
      let opIndex = 0;
      let pointIndex = 0;
      let replayStroke = null;
      let frame = 0;
      let done = 0;
      const startedAt = performance.now();
      // The drawing code uses `ctx` and `stroke`, so lend it the replay's for a moment.
      const inReplay = (fn) => {
        const realCtx = ctx;
        const realStroke = stroke;
        ctx = replayCtx;
        stroke = replayStroke;
        try { fn(); } finally {
          replayStroke = stroke;
          ctx = realCtx;
          stroke = realStroke;
        }
      };
      inReplay(blank);
      const advance = (budget) => {
        while (budget > 0 && opIndex < steps.length) {
          const op = steps[opIndex];
          budget--;
          if (op.type === "clear") { blank(); opIndex++; }
          else if (op.type === "fill") { fillAt(op.x, op.y, op.color, op.opacity === undefined ? 1 : op.opacity); opIndex++; }
          else if (!stroke) { openStroke(op); stroke.quiet = true; pointIndex = 1; }
          else if (pointIndex < op.points.length) extend(op.points[pointIndex++]);
          else { closeStroke(); opIndex++; }
        }
        if (stroke && stroke.layer) showLayer();
        else if (stroke && stroke.fade && stroke.tool !== "line") showFade(stroke);
      };
      const tick = (now) => {
        // Eases in, glides through the middle, and settles on the finished drawing.
        const t = Math.min(1, (now - startedAt) / duration);
        const budget = Math.ceil(units * t * t * (3 - 2 * t)) - done;
        if (budget > 0) {
          done += budget;
          inReplay(() => advance(budget));
        }
        if (opIndex < steps.length) frame = requestAnimationFrame(tick);
        else if (onEnd) onEnd();
      };
      if (instant) {
        inReplay(() => advance(Infinity));
        if (onEnd) onEnd();
      } else frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }

    canvas.addEventListener("pointerdown", begin);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("lostpointercapture", end); // the browser can drop a stroke with no pointerup
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      if (canvas.offsetParent === null) return;
      // A box open over the canvas takes the keys (the leave box, an ask box). A canvas that lives inside a dialog
      // (Scrawdle Party's, in the lobby game) keeps them: its own dialog, and the lobby that stays open underneath, don't count.
      const own = canvas.closest("dialog");
      const covered = [...document.querySelectorAll("dialog[open]")].some((d) => d !== own && !d.contains(canvas) && !(own && d.id === "lobby"));
      if (covered) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    });

    /* --- saving --- */
    function setStatus(text, state) {
      status.textContent = text;
      status.dataset.state = state || "";
    }
    // Done drawing looks dimmed while there is nothing on the canvas (index.html refuses it then).
    const blankNow = () => opsAt === 0 || (ops[opsAt - 1] && ops[opsAt - 1].type === "clear");
    function markDone() { doneBtn.classList.toggle("blank", blankNow()); }
    function scheduleSave() {
      markDone();
      clearTimeout(saveTimer);
      saveGeneration++;
      unsaved = true;
      setStatus("Saving\u2026", "saving");
      saveTimer = setTimeout(save, 400);
    }
    function canvasBlob() {
      return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }
    const draftOf = (image) => ({ ...round, ...image, ops: ops.slice(0, opsAt), canReplay, savedAt: Date.now() });
    let pendingSave = null; // the save in flight, so discard() can wait for it
    function save() { pendingSave = saveDraft().finally(() => { pendingSave = null; }); return pendingSave; }
    async function saveDraft() {
      if (!round) return;
      const generation = saveGeneration;
      try {
        const blob = await canvasBlob();
        if (generation !== saveGeneration || !round) return;
        await draftStore.put(draftOf({ blob }), slotOf(round), () => generation === saveGeneration);
        if (generation !== saveGeneration) return;
        unsaved = false;
        setStatus("Saved in this browser", "saved");
      } catch (err) {
        if (generation === saveGeneration) setStatus("Couldn't save", "failed"); // a newer save sets the status itself
      }
    }
    // Finishes any waiting save before leaving this drawing.
    async function flush() {
      clearTimeout(saveTimer);
      if (unsaved) await save();
    }
    // The page may be closing, so nothing here can wait. Start the write and let it finish.
    function saveNow() {
      if (!unsaved || !round || !openDb) return;
      clearTimeout(saveTimer);
      saveGeneration++;
      try {
        const tx = openDb.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put(draftOf({ dataUrl: canvas.toDataURL("image/png") }), slotOf(round));
        if (tx.commit) tx.commit(); // don't let the page closing abort it
        unsaved = false;
      } catch (err) { /* the 400 ms save may already have it */ }
    }
    draftStore.open().then((db) => { openDb = db; }).catch(() => {});
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveNow(); });

    /* --- rounds --- */
    // `timed` ({ seconds }) makes it a Time Challenge, with its own save slot.
    function start(mode, prompts, daily = true, timed = null) {
      // A Free play drawing, or today's in the other mode, that this round replaces goes to My drawings
      // first. The new round saves only after that, so it can't overwrite the old one before it's kept.
      const slot = slotOf({ mode, daily, timed });
      const kept = draftStore.get(slot).then((old) => myDrawings.keep(old, slot)).catch(() => {});
      clearTimeout(saveTimer);
      saveGeneration++;
      unsaved = false;
      round = { mode, prompts, daily, day: dayKey(), ...(timed ? { timed: { ...timed } } : {}) };
      blank();
      history.clear();
      ops = [];
      opsAt = 0;
      canReplay = true;
      refreshToolbar();
      return kept.then(save);
    }
    // What's saved in each slot, for the home screen. A drawing from an earlier day, Free play
    // included, moves to My drawings, so the home screen only offers today's.
    async function drafts() {
      const found = {};
      try { await draftStore.migrate(); } catch (err) { return found; }
      for (const slot of SLOTS) {
        try {
          const draft = await draftStore.get(slot);
          if (!draft) continue;
          if (draft.day !== dayKey()) {
            await myDrawings.keep(draft, slot).catch(() => {}); // its day is over, so it goes to My drawings
            await draftStore.remove(slot);
            continue;
          }
          const image = await draftImage(draft);
          (await createImageBitmap(image)).close();
          found[slot] = { slot, mode: draft.mode, daily: draft.daily !== false, day: draft.day, prompts: draft.prompts, timed: draft.timed || null, image, marked: isMarked(draft), finished: Boolean(draft.finished), savedAt: draft.savedAt || 0 };
        } catch (err) { // a damaged save shouldn't stop the game from opening
          await draftStore.remove(slot).catch(() => {});
        }
      }
      return found;
    }
    // Brings a saved drawing back onto the canvas.
    async function restore(slot) {
      let draft;
      try { draft = await draftStore.get(slot); } catch (err) { return null; }
      if (!draft) return null;
      if (draft.day !== dayKey()) { // its day is over (a tab left open past midnight): it goes to My drawings, like drafts() does
        await myDrawings.keep(draft, slot).catch(() => {});
        await draftStore.remove(slot).catch(() => {});
        return null;
      }
      try {
        const bitmap = await createImageBitmap(await draftImage(draft));
        ctx.drawImage(bitmap, 0, 0, W, H);
        bitmap.close();
      } catch (err) {
        await draftStore.remove(slot).catch(() => {});
        return null;
      }
      clearTimeout(saveTimer);
      saveGeneration++;
      unsaved = false;
      ops = Array.isArray(draft.ops) ? draft.ops : [];
      opsAt = ops.length;
      canReplay = Array.isArray(draft.ops) && draft.canReplay !== false;
      round = { mode: draft.mode, prompts: draft.prompts, daily: draft.daily !== false, day: draft.day, ...(draft.timed ? { timed: { ...draft.timed } } : {}), ...(draft.finished ? { finished: true } : {}) };
      history.clear();
      refreshToolbar();
      setStatus("Saved in this browser", "saved");
      return round;
    }
    function discard() {
      clearTimeout(saveTimer);
      saveGeneration++;
      unsaved = false;
      const slot = round && slotOf(round);
      round = null;
      blank();
      history.clear();
      ops = [];
      opsAt = 0;
      canReplay = true;
      setStatus("");
      refreshToolbar();
      const inFlight = pendingSave;
      return (async () => {
        if (inFlight) await inFlight.catch(() => {});
        if (slot) await draftStore.remove(slot).catch(() => {});
      })();
    }
    function setLocked(value) {
      locked = value;
      canvas.classList.toggle("locked", locked);
      refreshToolbar();
    }

    /* --- finished image: the drawing with its prompts and date underneath --- */
    function exportCanvas() {
      return letterDrawing(canvas, round);
    }

    refreshToolbar();
    return {
      start, drafts, restore, flush, discard, undo, redo, exportCanvas, canvasBlob, replay,
      save, setLocked,
      // A Time Challenge's progress ({ startedAt } when the clock starts, { used } when it ends), saved with the drawing.
      noteTimed(fields) { if (round && round.timed) { Object.assign(round.timed, fields); scheduleSave(); } },
      // Done drawing was pressed: the drawing counts as finished for the day (home says Done), published or not.
      markFinished() { if (round && !round.finished) { round.finished = true; scheduleSave(); } },
      // Keep it (the leave box): the drawing is kept in My drawings as a draft and leaves its slot.
      async stash() {
        if (!round) return;
        await flush();
        const slot = slotOf(round);
        const draft = await draftStore.get(slot).catch(() => null);
        if (draft) await myDrawings.keep(draft, slot, { draft: true, savedAt: Date.now() });
        await discard();
      },
      // A drawing left on its slot without Keep it (a closed tab) is dropped the next time home is built.
      forgetSlot(slot) { return (round && slotOf(round) === slot) ? Promise.resolve() : draftStore.remove(slot).catch(() => {}); },

      clear: clearAll, // erases the canvas but keeps the round and its parts; Undo brings the drawing back
      toast, // one short line with one action, for things that can be undone
      get locked() { return locked; },
      get canReplay() { return canReplay && opsAt > 0; },
      get round() { return round; },
      get isEmpty() { return isBlank(); },
      set onDone(fn) { onDone = fn; },
    };
  }

  /* ---------- Finish screen ---------- */
  // Set while the finish screen is open in this tab, so a refresh comes back to it (see index.html).
  const FINISH_KEY = "scrawdle-finish";
  function createFinishScreen(board, gallery, { onHome, onPlayAgain } = {}) {
    const dialog = document.createElement("dialog");
    dialog.id = "finish";
    // The drawing is the point of this screen: big, on its own, with the replay control under it, never on it. Beside
    // it (under it on a phone) the words, one primary button (Publish), two secondary (Download, Share) and at most
    // two quiet links. After Publish the buttons give way to a short "Published" moment, then the gallery.
    dialog.innerHTML = `
      <header class="app-header"><span class="wordmark">Scrawdle</span><button type="button" class="icon-key home-key" data-act="home" aria-label="Back to home" title="Back to home"><svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path d="M5 15L16 5l11 10"/><path d="M8 13v14h16V13"/><path d="M13.5 27v-7h5v7"/></svg></button></header>
      <div class="confetti" aria-hidden="true"></div>
      <div class="finish-body">
        <div class="finish-art-col">
          <div class="finish-art">
            <img alt="Your finished drawing">
            <canvas class="replay" hidden aria-label="Your drawing being redrawn"></canvas>
            <p class="finish-label"><span class="finish-cat"></span><span class="finish-prompt"></span></p>
          </div>
          <div class="finish-under"><button type="button" class="quiet-key replay-btn" data-act="replay"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg><span>Watch it redraw</span></button></div>
        </div>
        <div class="finish-side">
          <div class="finish-heading"><h1>You drew it!</h1><p class="finish-date"></p><p class="finish-streak" role="status" hidden></p><p class="finish-timed" hidden></p><p class="finish-next" hidden></p></div>
          <div class="finish-actions">
            <button type="button" class="btn primary" data-act="publish">Publish drawing</button>
            <button type="button" class="btn" data-act="gallery" hidden>See today's drawings</button>
            <div class="finish-pair">
              <button type="button" class="btn" data-act="download"><svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><path d="M16 5v15M9.5 14l6.5 6.5 6.5-6.5M6 26h20"/></svg><span>Download</span></button>
              <button type="button" class="btn" data-act="share"><svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><path d="M16 20V5M10 10.5L16 4.5l6 6M9 15H7v12h18V15h-2"/></svg><span>Share</span></button>
            </div>
          </div>
          <p class="publish-disclosure" hidden>Publishing shares your drawing with today’s gallery.</p>
          <p class="finish-note" role="status"></p>
          <details class="finish-share-box" hidden><summary>What Share sends</summary><p class="finish-share"></p></details>
          <div class="finish-secondary">
            <button type="button" class="quiet-key" data-act="again">Draw it again</button>
            <button type="button" class="quiet-key" data-act="keep">Keep drawing</button>
          </div>
          <div class="finish-published" role="status" hidden>
            <p class="finish-published-title">Published!</p>
            <p class="finish-published-line"></p>
            <button type="button" class="btn primary" data-act="see">See today’s drawings</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    const img = dialog.querySelector("img");
    // Confetti: a burst of show-coloured streamers when the screen opens and again on Publish (none with reduced motion).
    const confetti = dialog.querySelector(".confetti");
    const CONFETTI = ["#FFC23D", "#F2358A", "#1ED3C2", "#FFF4DE", "#8E7BFF", "#FFE7A6"]; // the show's gold, magenta, teal, cream
    const burst = () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      confetti.replaceChildren(...Array.from({ length: 36 }, (_, i) => {
        const bit = document.createElement("i");
        bit.style.setProperty("--x", `${Math.round(Math.random() * 100)}vw`);
        bit.style.setProperty("--drift", `${Math.round(Math.random() * 160 - 80)}px`);
        bit.style.setProperty("--spin", `${Math.round(Math.random() * 720 - 360)}deg`);
        bit.style.setProperty("--delay", `${Math.round(Math.random() * 380)}ms`);
        bit.style.setProperty("--fall", `${1300 + Math.round(Math.random() * 900)}ms`);
        bit.style.background = CONFETTI[i % CONFETTI.length];
        if (i % 3 === 0) bit.className = "dot";
        return bit;
      }));
      confetti.classList.remove("go");
      void confetti.offsetWidth; // restart the animation
      confetti.classList.add("go");
    };
    const note = dialog.querySelector(".finish-note");
    const actions = dialog.querySelector(".finish-actions");
    const secondary = dialog.querySelector(".finish-secondary");
    const disclosure = dialog.querySelector(".publish-disclosure");
    const shareEl = dialog.querySelector(".finish-share");
    const shareBox = dialog.querySelector(".finish-share-box"); // what Share sends, folded away until asked for
    const beat = dialog.querySelector(".finish-published");
    const publishBtn = dialog.querySelector('[data-act="publish"]');
    const downloadBtn = dialog.querySelector('[data-act="download"]');
    const shareBtn = dialog.querySelector('[data-act="share"]');
    const galleryBtn = dialog.querySelector('[data-act="gallery"]'); // shows instead of Publish once this round is published
    const replayBtn = dialog.querySelector('[data-act="replay"]');
    const replayCanvas = dialog.querySelector(".replay");
    // What to say for each day and mode already published. A player gets one drawing per round, so
    // this turns sharing off for that round only, and a new round can still be shared.
    const published = new Map();
    const roundKey = () => `${board.round.day}|${board.round.mode}`;
    // The replay control under the drawing: it waits while the drawing redraws, then offers "again".
    const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
    const AGAIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7.5 6 12 10V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>';
    const showPlay = (again) => {
      replayBtn.innerHTML = `${again ? AGAIN_ICON : PLAY_ICON}<span>${again ? "Watch it again" : "Watch it redraw"}</span>`;
      replayBtn.disabled = false;
    };
    let stopReplay = () => {};
    replayBtn.addEventListener("click", () => {
      stopReplay();
      img.hidden = true;
      replayCanvas.hidden = false;
      replayBtn.disabled = true;
      replayBtn.querySelector("span").textContent = "Redrawing…";
      stopReplay = board.replay(replayCanvas, {
        instant: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onEnd: () => { showPlay(true); dialog.dataset.replayed = "true"; },
      });
    });
    dialog.addEventListener("close", () => {
      stopReplay();
      img.hidden = false;
      replayCanvas.hidden = true;
      showPlay(false);
      delete dialog.dataset.replayed;
    });
    // Goes to the same Public drawings page as the home screen's link (public-drawings/), starting on this
    // drawing's own kind. The drawing is already saved, so leaving the game screen loses nothing.
    const goToGallery = () => {
      location.href = `public-drawings/?focus=${board.round.mode === "scrawl" ? "free" : "daily"}`;
    };
    galleryBtn.addEventListener("click", goToGallery);
    beat.querySelector('[data-act="see"]').addEventListener("click", goToGallery);
    let viewUrl = null; // the drawing on its own, for the screen
    let exportUrl = null; // the drawing with its prompt and date, for the download
    let exportBlob = null; // the same picture, for sharing
    let beatLine = ""; // the streak, or the parts, for the "Published" moment

    const release = () => {
      if (viewUrl) URL.revokeObjectURL(viewUrl);
      if (exportUrl) URL.revokeObjectURL(exportUrl);
      viewUrl = exportUrl = exportBlob = null;
    };
    const close = () => { dialog.close(); release(); };
    const keepBtn = dialog.querySelector('[data-act="keep"]');
    keepBtn.addEventListener("click", close);
    // Play again: a clean canvas with the same parts; this drawing is kept in My drawings (index.html does the start).
    const againBtn = dialog.querySelector('[data-act="again"]');
    againBtn.addEventListener("click", () => { close(); if (onPlayAgain) onPlayAgain(); });
    dialog.querySelector('[data-act="home"]').addEventListener("click", () => { close(); if (onHome) onHome(); });

    downloadBtn.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = exportUrl;
      a.download = `scrawdle-${board.round.day}.png`;
      a.click();
      note.textContent = "Downloaded.";
    });
    // Phones (and some laptop browsers) open their own share menu with the picture attached. Where that
    // isn't available, the picture is copied to paste anywhere, and as a last resort it downloads.
    shareBtn.addEventListener("click", async () => {
      const round = board.round;
      const file = new File([exportBlob], `scrawdle-${round.day}.png`, { type: "image/png" });
      const streak = round.daily !== false && root.ScrawdleStreak ? root.ScrawdleStreak.read(dayKey()).current : 0;
      const text = shareLine(round, `${location.origin}${location.pathname}`, streak);
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "My Scrawdle drawing", text });
          note.textContent = "Shared.";
          return;
        } catch (err) {
          if (err.name === "AbortError") return; // they closed the share menu
        }
      }
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": exportBlob })]);
        note.textContent = "Picture copied. Paste it into a message or post.";
        return;
      } catch (err) { /* no image clipboard here, so download instead */ }
      downloadBtn.click();
      note.textContent = "Sharing isn't available in this browser, so it downloaded instead. Attach the file to share it.";
    });
    // The button itself shows where publishing is up to, so it never looks stuck.
    const showPublish = (state) => {
      publishBtn.textContent = state === "sending" ? "Publishing…" : "Publish drawing";
      publishBtn.disabled = state === "sending";
    };
    // The moment after Publish: the buttons step back, one line says it's up, the streak (or the parts) under it, and
    // one button to the gallery. It fades in over 180 ms, stays at least a second, then the gallery opens by itself.
    const BEAT_MS = 1600;
    let beatTimer = null;
    const showBeat = () => {
      actions.hidden = true;
      secondary.hidden = true;
      disclosure.hidden = true;
      shareBox.hidden = true;
      note.textContent = "";
      beat.querySelector(".finish-published-line").textContent = beatLine;
      const nextEl = dialog.querySelector(".finish-next");
      if (nextEl.textContent === beatLine) nextEl.hidden = true; // said once, under "Published"
      beat.hidden = false;
      requestAnimationFrame(() => beat.classList.add("in"));
      burst();
      clearTimeout(beatTimer);
      beatTimer = setTimeout(() => { if (dialog.open && !beat.hidden) goToGallery(); }, BEAT_MS);
    };
    dialog.addEventListener("close", () => clearTimeout(beatTimer));
    publishBtn.addEventListener("click", async () => {
      const key = roundKey();
      showPublish("sending");
      note.textContent = "";
      try {
        const blob = await board.canvasBlob();
        await window.scrawdlePublish({ blob, ...board.round });
        // Publishing a Daily Scrawl (not Daily Free Play) is what unlocks Daily Scrawl on the Public drawings page.
        published.set(key, "Published. It’s in today’s gallery." + (board.round.mode === "scrawl" ? "" : " Everyone’s Daily Word drawings are unlocked there."));
        showPublish("ready");
        if (dialog.open) showBeat();
      } catch (err) {
        note.textContent = err.userMessage || "Couldn't publish. Your drawing is still saved here, so try again.";
        if (err.alreadyPublished) published.set(key, note.textContent);
        showPublish("ready");
        if (err.alreadyPublished) { publishBtn.hidden = true; galleryBtn.hidden = false; }
      }
    });

    const open = async () => {
      const [view, full] = await Promise.all([
        board.canvasBlob(),
        new Promise((resolve) => board.exportCanvas().toBlob(resolve, "image/png")),
      ]);
      release();
      viewUrl = URL.createObjectURL(view);
      exportUrl = URL.createObjectURL(full);
      exportBlob = full;
      img.src = viewUrl;
      const { daily, day, prompts } = board.round;
      const empty = board.isEmpty;
      // Back from a "Published" moment (the finish screen reopened): the buttons are back.
      clearTimeout(beatTimer);
      beat.hidden = true;
      beat.classList.remove("in");
      actions.hidden = false;
      secondary.hidden = false;
      const ready = daily && !empty && typeof window.scrawdlePublish === "function";
      // Published earlier (another visit or before a refresh): publish.js remembers it in this browser.
      const publishedNote = published.get(roundKey())
        || (typeof root.scrawdleIsPublished === "function" && root.scrawdleIsPublished(day, board.round.mode) ? "You’ve already published a drawing for this today, so this one stays in this browser." : null);
      showPublish("ready");
      publishBtn.hidden = !ready || Boolean(publishedNote);
      disclosure.hidden = publishBtn.hidden;
      // Published: the one primary button is the way to see it. Not daily, or nothing to publish: Download leads.
      const canSee = daily && !empty && typeof window.scrawdlePublicGallery === "function";
      galleryBtn.hidden = !(canSee && publishedNote);
      downloadBtn.classList.toggle("primary", publishBtn.hidden && galleryBtn.hidden);
      replayBtn.hidden = empty || !board.canReplay;
      dialog.querySelector(".finish-under").hidden = replayBtn.hidden;
      shareBtn.hidden = empty;
      keepBtn.textContent = board.locked ? "Back" : "Keep drawing";
      againBtn.hidden = empty || !onPlayAgain;
      const partsLine = wordOf(prompts);
      dialog.querySelector(".finish-prompt").textContent = partsLine;
      // The category chip (Silly, Food...) for a word; older animal-parts drawings and Daily Doodle show their mode.
      const cat = Array.isArray(prompts) && prompts.length === 1 && prompts[0].label ? prompts[0].label : "";
      dialog.querySelector(".finish-cat").textContent = board.round.mode === "scrawl" ? "Daily Doodle" : cat || (daily === false ? "Quick draw" : "Daily Word");
      dialog.querySelector(".finish-date").textContent = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      note.textContent = empty ? "Draw something first." : (ready && publishedNote) || "";
      // Finishing a daily drawing (not Free Play, not a blank one) counts today for the streak (streak.js).
      const streakEl = dialog.querySelector(".finish-streak");
      streakEl.textContent = "";
      let streakNow = 0;
      if (daily && !empty && root.ScrawdleStreak) {
        const s = root.ScrawdleStreak.record(day, dayKey());
        streakNow = s.current;
        streakEl.textContent = root.ScrawdleStreak.finishText(s, s.added, s.bestBefore);
      }
      // What Share will send, so there are no surprises.
      shareEl.textContent = empty ? "" : shareLine(board.round, `${location.origin}${location.pathname}`, streakNow);
      shareBox.hidden = !shareEl.textContent;
      shareBox.open = false;
      streakEl.hidden = !streakEl.textContent;
      // A Time Challenge says how long it took (timedText).
      const timedEl = dialog.querySelector(".finish-timed");
      timedEl.textContent = empty ? "" : timedText(board.round.timed);
      timedEl.hidden = !timedEl.textContent;
      // A blank canvas isn't celebrated, and nothing to download. Otherwise the heading names the drawing.
      const { mode, timed } = board.round;
      dialog.querySelector(".finish-heading h1").textContent = empty ? "Nothing drawn yet." : timed ? "Time Challenge, done!" : "You drew it!";
      againBtn.textContent = daily === false && !timed ? "Roll a new word" : "Draw it again";
      // A daily drawing is done for today: say when the next parts come.
      const nextEl = dialog.querySelector(".finish-next");
      nextEl.textContent = daily && !empty && !timed ? `New word in ${nextPartsIn()}` : "";
      nextEl.hidden = !nextEl.textContent;
      beatLine = streakEl.textContent || nextEl.textContent || partsLine; // the streak when there is one; the parts are already in the heading
      downloadBtn.hidden = empty;
      dialog.classList.toggle("is-empty", empty); // a blank canvas gets no chalk stars round it (screens.css)
      dialog.showModal();
      if (!empty) burst();
      try { sessionStorage.setItem(FINISH_KEY, "1"); } catch (err) { /* private browsing: a refresh just goes back to the drawing */ }
    };
    board.onDone = open;
    dialog.addEventListener("close", () => { try { sessionStorage.removeItem(FINISH_KEY); } catch (err) { /* see above */ } });
    return { open };
  }

  const api = { wordOf, floodFill, blendFill, FINISH_KEY, History, dayKey, brushWidthFactor, slotOf, SLOTS, timedText, nextPartsIn, COLORS, COLOR_NAMES, bookKey, keysToDrop, BOOK_MAX, shareLine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScrawdleDrawing = { ...api, createBoard, createFinishScreen, HISTORY_BYTES, myDrawings, letterDrawing };
})(typeof window !== "undefined" ? window : globalThis);

