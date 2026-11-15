# backend

Online play uses Supabase. There's no server to run: this folder holds the database setup.

- `supabase/schema.sql`: the full setup for a new project. Run it once in the SQL Editor. It creates the `drawings` table (published drawings, with Row Level Security), likes and reports, today's and yesterday's rankings, and the room-code functions (`create_lobby`, `lobby_exists`). Create the public `drawings` storage bucket as its comments describe.
- `supabase/updates/`: the same changes as separate numbered steps, for a project that was set up before them. A new project only needs `schema.sql`.
- `supabase/functions/purge-old-drawings/`: an optional Edge Function that deletes old drawings every day. To use it: deploy it from the dashboard, turn "Verify JWT" off in its settings, add a secret `CRON_SECRET`, then schedule it with the commented block at the bottom of `schema.sql`.

Keys: the **anon** key goes in `frontend/supabase-config.js` and is safe to publish; the **service_role** key must never be committed.
