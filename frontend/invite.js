/* Inviting people into a party room from the TV lobby (party.js draws the buttons): the room's link, the words that go
 * with it in a text message, and the room's QR code. The QR code is made here in the browser by the vendored encoder
 * (vendor/qrcode.js, MIT), never by an online QR service: a room's code must not go to anyone else.
 * The pure parts are tested in tests/invite.test.js.
 *
 *   inviteLink(origin, pathname, code)  "https://your-scrawdle.example/?BKQZ" (lobby.js reads ?BKQZ and asks for a name)
 *   inviteText(code)                    the short line a share sheet puts with the link
 *   smsBody(link, code) / smsHref(body) a text message with the link in it, and the sms: link that opens it
 *   qrModules(qrcode, text)             the QR code's grid of dark (true) and light (false) squares
 *   qrSvg(modules, options)             that grid as an SVG: dark squares on a light quiet zone, crisp at any size */
(function (root) {
  "use strict";

  // The page's own address with ?CODE. A link to /index.html counts as / (the same page, a cleaner link).
  function inviteLink(origin, pathname, code) {
    const path = String(pathname || "/").replace(/index\.html?$/i, "") || "/";
    return `${String(origin || "")}${path.endsWith("/") ? path : `${path}/`}?${code}`;
  }

  const inviteText = (code) => `Come draw with us on Scrawdle! Our room is ${code}.`;
  const smsBody = (link, code) => `Come draw with us on Scrawdle! Tap to join room ${code}: ${link}`;
  // "sms:?&body=" opens a new message with that text on both iPhone and Android; the player picks who it goes to.
  const smsHref = (body) => `sms:?&body=${encodeURIComponent(body)}`;

  // ECC level M (about 15% of the code can be smudged or glared and still read) and the smallest version that fits.
  function qrModules(qrcode, text) {
    const qr = qrcode(0, "M");
    qr.addData(String(text), "Byte");
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  }

  // The dark squares as one SVG path, a rectangle per run of dark squares along each row, offset by the quiet zone.
  function qrPath(modules, quiet = 4) {
    let d = "";
    modules.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (!row[c]) continue;
        let end = c;
        while (end + 1 < row.length && row[end + 1]) end++;
        d += `M${c + quiet} ${r + quiet}h${end - c + 1}v1h${-(end - c + 1)}z`;
        c = end;
      }
    });
    return d;
  }

  // A square SVG: the light quiet zone (4 squares wide, as scanners expect) all round, then the code.
  function qrSvg(modules, { quiet = 4, dark = "#1B1240", light = "#FFF8E8", label = "" } = {}) {
    const size = modules.length + quiet * 2;
    const a11y = label ? ` role="img" aria-label="${String(label).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch])}"` : ' aria-hidden="true"';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"${a11y}>`
      + `<rect width="${size}" height="${size}" fill="${light}"/><path fill="${dark}" d="${qrPath(modules, quiet)}"/></svg>`;
  }

  const api = { inviteLink, inviteText, smsBody, smsHref, qrModules, qrPath, qrSvg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScrawdleInvite = api;
})(typeof window !== "undefined" ? window : globalThis);
