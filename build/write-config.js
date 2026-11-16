// Runs on Vercel while it publishes the site (see vercel.json). It fills frontend/supabase-config.js
// from the project's environment variables, so the Supabase address and key live in Vercel's
// settings, not in this repo. With no variables set the file is left as it is (offline play).
const fs = require("fs");
const path = require("path");

const url = (process.env.SUPABASE_URL || "").trim();
const anonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
const publicGallery = (process.env.PUBLIC_GALLERY || "").trim().toLowerCase() === "true";

if (!url && !anonKey) {
  console.log("write-config: no SUPABASE_URL or SUPABASE_ANON_KEY set, keeping the offline config.");
  process.exit(0);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error("write-config: SUPABASE_URL should look like https://abcdefghijklmnopqrst.supabase.co");
  process.exit(1);
}
if (!/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+)$/.test(anonKey) || /service_role|sb_secret_/.test(anonKey)) {
  console.error("write-config: SUPABASE_ANON_KEY must be the public (publishable or anon) key, never a secret key.");
  process.exit(1);
}

const file = path.join(__dirname, "..", "frontend", "supabase-config.js");
const out = `/* Written by build/write-config.js during the Vercel build. Do not edit on the live site. */
window.SCRAWDLE_SUPABASE = {
  url: ${JSON.stringify(url)},
  anonKey: ${JSON.stringify(anonKey)},
  publicGallery: ${publicGallery},
};
`;
fs.writeFileSync(file, out);
console.log(`write-config: online play on (${url}), public gallery ${publicGallery ? "on" : "off"}.`);
