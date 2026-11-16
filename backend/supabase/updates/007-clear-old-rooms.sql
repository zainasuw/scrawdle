-- Clear old room codes every day. A room code is only needed while its party is on, so every day at
-- 10:15 UTC (the middle of the night in US time) pg_cron deletes lobby codes older than a day. Nothing
-- about who was in a room is stored (that's Realtime presence), so the code row is all there is to clear.
-- Run once in the SQL Editor. Safe to run again: it removes this job by name before scheduling it, so
-- there is never a second copy.

create extension if not exists pg_cron;

-- Remove an earlier copy of this job, if there is one (no rows means nothing to remove).
select cron.unschedule(jobid) from cron.job where jobname = 'purge-old-lobbies';

select cron.schedule(
  'purge-old-lobbies',
  '15 10 * * *',
  $$ delete from public.lobbies where created_at < now() - interval '1 day' $$
);
