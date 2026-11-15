/* Supabase project config (online play: lobbies, publishing, the gallery and the leaderboard).
 * Paste your own project's URL and its "anon" (public) key. The anon key is meant to ship in browser
 * code; Row Level Security in backend/supabase/schema.sql limits what it can do. Never put the
 * service_role key here or anywhere in this repo. With both values empty the game still runs
 * offline: solo drawing works, and online features stay hidden or show a friendly error. */
window.SCRAWDLE_SUPABASE = {
  url: "",
  anonKey: "",
};
