-- Slovotoč – migrace: jméno hráče je identita (ne zařízení).
-- Spustit celé najednou v SQL editoru Supabase.

-- 1) Úklid: testovací profily a hráči, kteří nikdy nedohráli ani jednu
--    úroveň (duplicity vzniklé založením stejného jména na jiném zařízení).
delete from public.leaderboard where name in ('TestBot', 'ZkouskaHrac', 'Anička');
delete from public.leaderboard where levels = 0;

-- 2) Kdyby po úklidu zbyla dvě stejná jména, necháme to lepší z nich.
delete from public.leaderboard a
using public.leaderboard b
where a.name = b.name
  and (a.levels, a.stars, a.bonus, a.coins, a.id)
    < (b.levels, b.stars, b.bonus, b.coins, b.id);

-- 3) Identita = jméno. Dřív byla (device_id, name), takže stejný hráč
--    na druhém telefonu vznikl podruhé.
alter table public.leaderboard
  drop constraint if exists leaderboard_device_id_name_key;
create unique index if not exists leaderboard_name_key
  on public.leaderboard (name);

-- 4) Skóre smí jen růst. Když se někdo přihlásí na novém zařízení
--    a hra tam začne s nižšími čísly, tenhle trigger je nepustí dolů,
--    takže nikdo nemůže cizí (ani vlastní) výsledek přepsat směrem dolů.
create or replace function public.leaderboard_keep_best()
returns trigger language plpgsql as $$
begin
  new.levels := greatest(coalesce(new.levels, 0), coalesce(old.levels, 0));
  new.stars  := greatest(coalesce(new.stars,  0), coalesce(old.stars,  0));
  new.bonus  := greatest(coalesce(new.bonus,  0), coalesce(old.bonus,  0));
  new.coins  := greatest(coalesce(new.coins,  0), coalesce(old.coins,  0));
  new.streak := greatest(coalesce(new.streak, 0), coalesce(old.streak, 0));
  return new;
end $$;

drop trigger if exists leaderboard_keep_best_trg on public.leaderboard;
create trigger leaderboard_keep_best_trg
  before update on public.leaderboard
  for each row execute function public.leaderboard_keep_best();
