-- Slovotoč – statistika „kol bez nápovědy" na společném žebříčku.
-- Spustit celé najednou v SQL editoru Supabase. Je bezpečné pustit opakovaně.
--
-- Přidává dva sloupce: kolik kol hráč zvládl bez nápovědy a jaká byla jeho
-- nejdelší série takových kol. Obojí se v prohlížeči počítá z hvězdiček,
-- které se ukládaly odjakživa, takže se nikomu nic nedopočítává zpětně –
-- první uložení skóre po aktualizaci hry přinese správná čísla samo.
--
-- Starší verze hry, které nová čísla neposílají, fungují dál beze změny:
-- oba parametry mají výchozí hodnotu.

-- ---------------------------------------------------------------- sloupce
alter table public.leaderboard
  add column if not exists clean      int not null default 0,
  add column if not exists clean_best int not null default 0;

-- Čtení žebříčku je veřejné, ale po sloupcích (otisk PINu se přečíst nesmí),
-- takže se nové sloupce musí přidat i sem.
grant select (id, device_id, name, avatar, levels, bonus, coins,
              stars, streak, clean, clean_best, updated_at)
  on public.leaderboard to anon;

-- --------------------------------------------------------- „jen nahoru"
-- Hvězdy ani kola bez nápovědy nemůžou ubýt, takže je trigger drží nahoře
-- stejně jako úrovně.
--
-- Mince jsou naopak jediné číslo, které ubývat MÁ – hráč je utrácí za
-- nápovědy. Dokud je trigger držel na maximu, stačilo se přihlásit na jiném
-- telefonu a peněženka byla zase plná; s progresivní cenou nápovědy je to
-- díra, kterou má smysl zavřít. Poslední zápis proto u mincí vyhrává.
create or replace function public.leaderboard_keep_best()
returns trigger language plpgsql as $$
begin
  new.levels     := greatest(coalesce(new.levels,     0), coalesce(old.levels,     0));
  new.stars      := greatest(coalesce(new.stars,      0), coalesce(old.stars,      0));
  new.bonus      := greatest(coalesce(new.bonus,      0), coalesce(old.bonus,      0));
  new.streak     := greatest(coalesce(new.streak,     0), coalesce(old.streak,     0));
  new.clean      := greatest(coalesce(new.clean,      0), coalesce(old.clean,      0));
  new.clean_best := greatest(coalesce(new.clean_best, 0), coalesce(old.clean_best, 0));
  new.coins      := coalesce(new.coins, old.coins);
  return new;
end $$;

drop trigger if exists leaderboard_keep_best_trg on public.leaderboard;
create trigger leaderboard_keep_best_trg
  before update on public.leaderboard
  for each row execute function public.leaderboard_keep_best();

-- ------------------------------------------------------------ uložení
-- Starou devítiparametrovou verzi je nutné zahodit, ne jen přepsat: kdyby
-- vedle sebe zůstaly obě, PostgREST by u volání bez nových parametrů nevěděl,
-- kterou z nich zavolat, a odpověděl by chybou.
drop function if exists public.save_score(text, text, uuid, text, int, int, int, int, int);

create or replace function public.save_score(
  p_name text, p_pin text, p_device uuid, p_avatar text,
  p_levels int, p_bonus int, p_coins int, p_stars int, p_streak int,
  p_clean int default 0, p_clean_best int default 0)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r public.leaderboard;
begin
  select * into r from public.leaderboard where name = p_name;

  if r is null then
    insert into public.leaderboard (device_id, name, avatar, levels, bonus,
                                    coins, stars, streak, clean, clean_best)
    values (coalesce(p_device, gen_random_uuid()), p_name,
            coalesce(p_avatar, '🦊'), greatest(coalesce(p_levels, 0), 0),
            greatest(coalesce(p_bonus, 0), 0), greatest(coalesce(p_coins, 0), 0),
            greatest(coalesce(p_stars, 0), 0), greatest(coalesce(p_streak, 0), 0),
            greatest(coalesce(p_clean, 0), 0), greatest(coalesce(p_clean_best, 0), 0));
    return 'created';
  end if;

  if r.pin_hash is not null
     and (p_pin is null or extensions.crypt(p_pin, r.pin_hash) <> r.pin_hash) then
    raise exception 'wrong pin for %', p_name using errcode = '28000';
  end if;

  -- trigger leaderboard_keep_best_trg hlídá, že čísla nejdou dolů
  update public.leaderboard
     set avatar     = coalesce(p_avatar, avatar),
         levels     = coalesce(p_levels, levels),
         bonus      = coalesce(p_bonus,  bonus),
         coins      = coalesce(p_coins,  coins),
         stars      = coalesce(p_stars,  stars),
         streak     = coalesce(p_streak, streak),
         clean      = coalesce(p_clean,      clean),
         clean_best = coalesce(p_clean_best, clean_best),
         updated_at = now()
   where name = p_name;
  return 'updated';
end $$;

-- ---------------------------------------------------------- přihlášení
-- Vrací i nová čísla, aby si je hráč přenesl na nový telefon. Návratový typ
-- se mění, takže i tady musí jít stará verze pryč jako první.
drop function if exists public.sign_in(text, text);

create or replace function public.sign_in(p_name text, p_pin text)
returns table (ok boolean, reason text, hint text, avatar text,
               levels int, bonus int, coins int, stars int, streak int,
               clean int, clean_best int)
language plpgsql security definer set search_path = public, extensions as $$
declare r public.leaderboard;
begin
  select * into r from public.leaderboard where name = p_name;
  if r is null then
    return query select false, 'unknown', null::text, null::text, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  if r.pin_blocked_until is not null and r.pin_blocked_until > now() then
    return query select false, 'blocked', r.pin_hint, null::text, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  if r.pin_hash is null then
    -- jméno ještě není zamčené: pustíme, hra pak nabídne nastavení PINu
    return query select true, 'nopin', r.pin_hint, r.avatar,
                        r.levels, r.bonus, r.coins, r.stars, r.streak,
                        r.clean, r.clean_best;
    return;
  end if;
  if p_pin is null or extensions.crypt(p_pin, r.pin_hash) <> r.pin_hash then
    update public.leaderboard set
      pin_fails = case when r.pin_fails + 1 >= 5 then 0 else r.pin_fails + 1 end,
      pin_blocked_until = case when r.pin_fails + 1 >= 5
                               then now() + interval '15 minutes' end
     where name = p_name;
    return query select false, 'wrong', r.pin_hint, null::text, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  update public.leaderboard
     set pin_fails = 0, pin_blocked_until = null where name = p_name;
  return query select true, 'ok', r.pin_hint, r.avatar,
                      r.levels, r.bonus, r.coins, r.stars, r.streak,
                      r.clean, r.clean_best;
end $$;

-- ------------------------------------------------------------ oprávnění
grant execute on function public.sign_in(text, text) to anon;
grant execute on function public.save_score(
  text, text, uuid, text, int, int, int, int, int, int, int) to anon;

-- Přímý zápis pro jména bez PINu (starší verze hry) musí umět nové sloupce
-- taky, jinak by se jim skóre přestalo ukládat.
grant insert (device_id, name, avatar, levels, bonus, coins, stars, streak,
              clean, clean_best, updated_at)
  on public.leaderboard to anon;
grant update (device_id, name, avatar, levels, bonus, coins, stars, streak,
              clean, clean_best, updated_at)
  on public.leaderboard to anon;
