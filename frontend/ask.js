/* The game's yes/no box (window.scrawdleAsk), for what can't be undone: Remove, Close room, Leave, Delete, Report, and
 * starting Daily Word over a drawing. Two violet keys the same size, the safe answer first and focused; Esc or a tap
 * outside the box answers no too. The thing being asked about is never gold. On the party TV the box is sized in the
 * TV's --u like the rest of the set (the "tv" class). It uses #ask-box when the page has one (index.html) and makes it
 * otherwise (the Public drawings page).
 *   await scrawdleAsk({ title, body, yes, no })  -> true only for the yes key */
(function (root) {
  "use strict";
  if (typeof document === "undefined") return;
  function box() {
    let el = document.getElementById("ask-box");
    if (!el) {
      el = document.createElement("dialog");
      el.id = "ask-box";
      el.className = "ask-box";
      el.setAttribute("aria-labelledby", "ask-title");
      el.setAttribute("aria-describedby", "ask-body");
      el.innerHTML = '<h2 id="ask-title"></h2><p id="ask-body"></p><div class="ask-actions"><button type="button" class="ask-key" value="no"></button><button type="button" class="ask-key" value="yes"></button></div>';
      document.body.append(el);
    }
    if (!el.dataset.wired) {
      el.dataset.wired = "1";
      el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) el.close(b.value); else if (e.target === el) el.close("no"); });
    }
    return el;
  }
  root.scrawdleAsk = function ask({ title, body, yes, no }) {
    const el = box();
    el.querySelector("#ask-title").textContent = title;
    el.querySelector("#ask-body").textContent = body || "";
    el.querySelector("#ask-body").hidden = !body;
    el.querySelector('[value="yes"]').textContent = yes;
    el.querySelector('[value="no"]').textContent = no;
    el.classList.toggle("tv", Boolean(document.querySelector("#lobby-game[open] .pp-tv")));
    return new Promise((resolve) => {
      el.addEventListener("close", () => resolve(el.returnValue === "yes"), { once: true });
      el.returnValue = "no";
      el.showModal();
      el.querySelector('[value="no"]').focus();
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
