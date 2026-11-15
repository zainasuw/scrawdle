/* Today's gallery: other players' published drawings, with votes, and your own result.
 * publish.js connects the real drawings and votes by setting:
 *   window.scrawdleGallery = async ({ day, mode, prompts }) => [{ id, imageUrl, caption, mine, votes }];
 *   window.scrawdleVote = async ({ drawingId, value }) => {};  // 1, -1, or 0 to take it back
 * `votes` is { up, down, mine } (see votes.js), or null when voting isn't available. Your own
 * drawing (mine: true) gets no vote buttons; its votes show as your result instead.
 */
(function (root) {
  "use strict";
  // With no options the gallery is a dialog over the page (today's drawings, opened from the finish screen).
  // With { container } it is the page itself: the Public drawings route (frontend/public-drawings/) puts it
  // in that element, and Back leaves the page instead of closing a dialog.
  // "Loading today's drawings" at once; after a second a small ring joins it (flow.css .loading). Never a blank area.
  function loading(note, on) {
    note.classList.toggle("loading", on);
    if (on) note.textContent = "Loading today\u2019s drawings";
  }

  function createGallery(board, { container } = {}) {
    const page = Boolean(container);
    const dialog = document.createElement(page ? "main" : "dialog");
    dialog.id = "gallery";
    dialog.setAttribute("aria-labelledby", "gallery-title");
    if (page) dialog.className = "gallery-page";
    const wordmark = page ? '<a class="wordmark" href="../" aria-label="Scrawdle, back to the home screen">Scrawdle</a>' : '<span class="wordmark">Scrawdle</span>';
    dialog.innerHTML = '<header class="app-header">' + wordmark + '<button class="quiet home-key" type="button" aria-label="Back to home" title="Back to home"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 10v10h5v-6h3v6h5V10"/></svg></button></header><div class="gallery-heading"><h2 id="gallery-title"></h2><p class="gallery-sub">Today\u2019s drawings, posted without names. They leave this page at midnight and are deleted within two days.</p></div><div class="public-filters" hidden></div><p class="gallery-note" role="status"></p><ul class="gallery-grid"></ul>';
    const closeBtn = dialog.querySelector("button");
    const open = () => { if (!page) dialog.showModal(); };
    const isOpen = () => page || dialog.open;
    // On the page, Back goes to where you came from on this site (like the browser's Back), or home if you
    // arrived some other way, such as a pasted link.
    function leavePage() {
      let fromThisSite = false;
      try { fromThisSite = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin; } catch (err) { /* no usable referrer */ }
      if (fromThisSite && history.length > 1) history.back();
      else location.href = "../";
    }
    closeBtn.addEventListener("click", () => (page ? leavePage() : dialog.close()));
    const title = dialog.querySelector("h2");
    const note = dialog.querySelector(".gallery-note");
    const filters = dialog.querySelector(".public-filters");
    const grid = dialog.querySelector(".gallery-grid");
    let request = 0;
    dialog.addEventListener("close", () => { request++; });
    (page ? container : document.body).appendChild(dialog);
    // Time to midnight, the way the home screen says it ("5h 48m").
    function untilMidnight(now = new Date()) {
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const mins = Math.max(0, Math.round((midnight - now) / 60000));
      if (mins < 1) return "under a minute";
      const h = Math.floor(mins / 60), m = mins % 60;
      return h ? `${h}h ${m}m` : `${m}m`;
    }
    function addCard(url, caption, mine) {
      const li = document.createElement("li");
      if (mine) li.className = "mine";
      const img = document.createElement("img");
      img.src = url;
      img.alt = caption ? `Drawing: ${caption}` : "A player's drawing";
      img.loading = "lazy"; // the public page can hold a lot of drawings
      li.append(img);
      if (caption) {
        const p = document.createElement("p");
        p.textContent = caption;
        li.append(p);
      }
      grid.append(li);
      return li;
    }
    // A small heart in the corner of someone else's drawing: press it to like the drawing (it fills red),
    // press again to take it back. The number is how many players like it. Shows the change straight away,
    // and puts the old one back if saving it fails.
    function addVotes(li, item) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "like";
      b.addEventListener("click", vote);
      let busy = false;
      const render = () => {
        const liked = item.votes.mine === 1;
        const count = item.votes.up;
        b.replaceChildren(root.ScrawdleVotes.heartIcon(liked), String(count));
        b.setAttribute("aria-label", `Like, ${count} ${count === 1 ? "like" : "likes"}`);
        b.setAttribute("aria-pressed", String(liked));
        b.disabled = busy;
      };
      async function vote() {
        if (busy) return;
        const before = item.votes;
        const { value, votes } = root.ScrawdleVotes.applyVote(before, 1);
        item.votes = votes;
        busy = true;
        render();
        try {
          await root.scrawdleVote({ drawingId: item.id, value });
        } catch (err) {
          item.votes = before;
          note.textContent = err.userMessage || "Couldn't save your vote. Try again.";
        }
        busy = false;
        render();
      }
      render();
      li.append(b);
    }
    // Report, under someone else's drawing. Three different players' reports hide it for everyone
    // (the number is set in the database's report_drawing; change this message with it). This
    // browser remembers what it reported, so the button stays "Reported".
    const REPORTED_KEY = "scrawdle-reported";
    const reportedIds = () => {
      try { return JSON.parse(localStorage.getItem(REPORTED_KEY) || "[]"); } catch (err) { return []; }
    };
    // The question before a report, in the game's own box (the browser's confirm() looks like an error).
    let reportBox = null;
    function askReport() {
      if (!reportBox) {
        reportBox = document.createElement("dialog");
        reportBox.className = "ask-box";
        reportBox.innerHTML = '<h2>Report this drawing?</h2><p>It is hidden from everyone once 3 players report it.</p><div class="ask-actions"><button type="button" class="btn primary" value="yes">Report drawing</button><button type="button" class="quiet" value="no">Cancel</button></div>';
        document.body.append(reportBox);
        reportBox.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) reportBox.close(b.value); else if (e.target === reportBox) reportBox.close("no"); });
      }
      return new Promise((resolve) => {
        reportBox.addEventListener("close", () => resolve(reportBox.returnValue === "yes"), { once: true });
        reportBox.returnValue = "no";
        reportBox.showModal();
      });
    }
    function addReport(li, item) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "quiet report";
      const reported = () => { b.textContent = "Reported"; b.disabled = true; };
      if (reportedIds().includes(item.id)) reported();
      else b.textContent = "Report";
      b.addEventListener("click", async () => {
        if (!await askReport()) return;
        b.disabled = true;
        try {
          const { hidden } = await root.scrawdleReport({ drawingId: item.id });
          try { localStorage.setItem(REPORTED_KEY, JSON.stringify([...reportedIds(), item.id].slice(-200))); } catch (err) { /* private browsing */ }
          reported();
          note.textContent = hidden ? "Thanks. That drawing is hidden now." : "Thanks for reporting it.";
          if (hidden) li.remove();
        } catch (err) {
          b.disabled = false;
          note.textContent = err.userMessage || "Couldn't send your report. Try again.";
        }
      });
      li.append(b);
    }
    async function show(myImageUrl) {
      const round = board.round;
      const token = ++request;
      title.textContent = "Today's drawings";
      filters.hidden = true;
      grid.replaceChildren();
      const myCard = addCard(myImageUrl, "Your drawing · saved locally", true);
      open();
      loading(note, true);
      try {
        const items = await root.scrawdleGallery({ day: round.day, mode: round.mode, prompts: round.prompts });
        if (token !== request || !isOpen()) return;
        loading(note, false);
        const mine = items.find((item) => item.mine);
        const others = items.filter((item) => !item.mine);
        // Your result: its likes, and won once anyone likes your published drawing (see votes.js).
        if (mine) myCard.querySelector("p").textContent = "Your drawing · Published" + (round.mode === "daily" ? ` · New word in ${untilMidnight()}` : "");
        if (!mine || mine.votes) addResult(myCard, mine && mine.votes);
        note.textContent = others.length ? "" : "No community drawings to show yet.";
        const canVote = typeof root.scrawdleVote === "function";
        const canReport = typeof root.scrawdleReport === "function";
        for (const item of others) {
          const li = addCard(item.imageUrl, item.caption);
          if (canVote && item.votes) addVotes(li, item);
          if (canReport && item.id) addReport(li, item);
        }
      } catch (err) {
        if (token === request && isOpen()) { loading(note, false); note.textContent = "Couldn't load today's drawings. Close and reopen the gallery to try again."; }
      }
    }
    // Public drawings: today's published Daily Word drawings. They stay locked until this player has posted
    // their own (publish.js's scrawdleHasPosted). That's a courtesy in the page, not security: the database
    // lets anyone read published drawings. Daily Word is the only kind that publishes now (Quick draw and the
    // party game don't), so there is no switch. Rows from the retired Daily Doodle (mode "scrawl") may still
    // sit in the table until the daily wipe; they aren't asked for, so they don't show.
    const MODES = ["daily", "basic", "detailed"]; // Daily Word, plus the older Basic and Detailed
    // A padlock drawn in two halves, so it can break: the shackle pops off and the body splits (see pages.css).
    const LOCK_SVG = '<svg class="lock-icon" viewBox="0 0 24 24" aria-hidden="true"><path class="lock-shackle" d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path class="lock-half left" d="M4.5 11H12v10H6.5a2 2 0 0 1-2-2z" fill="currentColor"/><path class="lock-half right" d="M12 11h7.5v8a2 2 0 0 1-2 2H12z" fill="currentColor"/></svg>';
    // The same padlock, open: what the line shows once the lock has broken.
    const OPEN_LOCK_SVG = '<svg class="lock-icon open" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V7a4.5 4.5 0 0 1 8.8-1.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4.5 11h15v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" fill="currentColor"/></svg>';
    // The breaking lock plays once for each day's unlock, the first time the page opens after you've posted. This
    // browser remembers which day it last played for.
    const UNLOCK_SEEN_KEY = "scrawdle-unlock-seen";
    const BREAK_MS = 1150;
    const localDay = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    // Your own drawing on the public page shows how it did, like the old Today's drawings page did.
    function addResult(li, votes) {
      if (votes) li.append(root.ScrawdleVotes.likeCount(votes.up, false));
      const text = root.ScrawdleVotes.resultText(votes);
      if (!text) return;
      const result = document.createElement("p");
      result.className = "vote-result";
      result.classList.toggle("won", root.ScrawdleVotes.isWin(votes));
      result.textContent = text;
      li.append(result);
    }
    // The old `focus` option ("daily" or "free", from a finished drawing's link) is accepted and ignored:
    // with one kind of drawing there is nothing to focus on.
    async function showPublic() {
      const token = ++request;
      const posted = typeof root.scrawdleHasPosted === "function" && root.scrawdleHasPosted();
      title.textContent = "Public drawings";
      grid.replaceChildren();
      filters.replaceChildren();
      let seenDay = null;
      try { seenDay = localStorage.getItem(UNLOCK_SEEN_KEY); } catch (err) { /* private browsing: it just plays each time */ }
      const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const breaking = posted && seenDay !== localDay() && !reduceMotion;
      if (posted && seenDay !== localDay()) {
        try { localStorage.setItem(UNLOCK_SEEN_KEY, localDay()); } catch (err) { /* see above */ }
      }
      let items = null;
      let lockBreaking = breaking; // true until the lock has finished breaking
      // The lock is a plain status line, not a button or a tab: shown while the drawings are locked, and on the
      // day's first visit after posting, when the padlock breaks and the line says they're unlocked. Any other
      // time there is nothing above the drawings.
      filters.hidden = posted && !breaking;
      if (!posted || breaking) {
        const lock = document.createElement("p");
        lock.className = "lock-line locked";
        const mark = document.createElement("span");
        mark.className = "lock-mark";
        mark.innerHTML = LOCK_SVG;
        const text = document.createElement("span");
        text.className = "lock-text";
        text.textContent = "Locked until you post today\u2019s Daily Word.";
        lock.append(mark, text);
        filters.append(lock);
        if (breaking) {
          // The padlock shakes and breaks, then the line pops open with sparks where the lock was.
          requestAnimationFrame(() => lock.classList.add("breaking"));
          setTimeout(() => {
            if (token !== request) return;
            lockBreaking = false;
            lock.classList.remove("locked", "breaking");
            lock.classList.add("open", "unlocked-pop");
            text.textContent = "Unlocked! Everyone\u2019s Daily Word drawings are here now.";
            mark.innerHTML = OPEN_LOCK_SVG;
            for (let i = 0; i < 8; i++) {
              const spark = document.createElement("i");
              spark.className = "spark";
              spark.style.setProperty("--angle", `${i * 45}deg`);
              mark.append(spark);
            }
            render();
            setTimeout(() => {
              lock.classList.remove("unlocked-pop");
              mark.querySelectorAll(".spark").forEach((s) => s.remove());
            }, 3500);
          }, BREAK_MS);
        }
      }
      function render() {
        grid.replaceChildren();
        note.replaceChildren();
        if (!posted) { // nothing loads behind the lock; the lock line says why, the link says how to open it
          note.textContent = "";
        } else {
          if (!items || lockBreaking) return;
          const shown = items.filter((item) => MODES.includes(item.mode)); // only what was asked for, whatever comes back
          const canVote = typeof root.scrawdleVote === "function";
          const canReport = typeof root.scrawdleReport === "function";
          for (const item of shown) {
            // Your own card says it's up and when the next word comes, since Publish lands here.
            const li = addCard(item.imageUrl, item.mine ? `Your drawing · Published · New word in ${untilMidnight()}` : "", item.mine);
            if (item.mine) { // your own drawing has no vote or report buttons; its votes show as your result
              if (item.votes) addResult(li, item.votes);
              continue;
            }
            if (canVote && item.votes) addVotes(li, item);
            if (canReport && item.id) addReport(li, item);
          }
          if (shown.length) return;
          // You have posted, so there's nothing to ask you to draw: just say the page is empty for now.
          note.textContent = "No drawings showing yet today. Check back soon!";
          return;
        }
        if (page) { // the public page, locked: a way to go and draw
          const go = document.createElement("a");
          go.className = "quiet";
          go.href = "../";
          go.textContent = "Draw today\u2019s word";
          note.append(go);
        }
      }
      open();
      if (!posted) { render(); return; }
      loading(note, true);
      try {
        items = await root.scrawdlePublicGallery({ modes: MODES });
        if (token !== request || !isOpen()) return;
        loading(note, false);
        render();
      } catch (err) {
        if (token !== request || !isOpen()) return;
        loading(note, false);
        note.textContent = page ? "Couldn't load the public drawings. Reload this page to try again." : "Couldn't load the public drawings. Close and reopen this page to try again.";
      }
    }
    return { show, showPublic };
  }
  if (typeof module === "undefined" || !module.exports) root.ScrawdleGallery = { createGallery };
})(typeof window !== "undefined" ? window : globalThis);
