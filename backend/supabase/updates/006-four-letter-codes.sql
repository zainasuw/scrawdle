-- 4-letter lobby codes. Shorter to read off a TV and type on a phone. Codes made before this
-- (5 letters) still work until they're cleared. Run once in the SQL Editor.
alter table public.lobbies drop constraint if exists lobbies_code_check;
alter table public.lobbies add constraint lobbies_code_check check (code ~ '^[A-Z]{4,5}$');

create or replace function public.create_lobby()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  letters constant text := 'BCDFGHJKLMNPQRSTVWXZ';
  new_code text;
  attempts int := 0;
begin
  loop
    new_code := '';
    for i in 1..4 loop
      new_code := new_code || substr(letters, 1 + floor(random() * length(letters))::int, 1);
    end loop;
    begin
      insert into public.lobbies (code) values (new_code);
      return new_code;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts >= 20 then
        raise exception 'could not find a free lobby code';
      end if;
    end;
  end loop;
end;
$$;
