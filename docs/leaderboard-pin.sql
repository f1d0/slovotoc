-- Slovotoč – zámek jména PINem.
-- Spustit celé najednou v SQL editoru Supabase. Je to bezpečné pustit
-- opakovaně.
--
-- Proč to musí být tady a ne v prohlížeči: anonymní klíč je veřejný a je
-- vidět ve zdrojovém kódu hry. Kontrola PINu v JavaScriptu by byla jen
-- doporučení – kdokoli může poslat požadavek do databáze přímo. Proto se
-- anonymnímu klíči zápis do tabulky zakáže úplně a jde výhradně přes
-- funkce níže, které PIN ověří na serveru.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- sloupce
alter table public.leaderboard
  add column if not exists pin_hash text,
  -- veřejná nápověda k PINu; ukazuje se až po chybném pokusu
  add column if not exists pin_hint text check (char_length(pin_hint) <= 40),
  add column if not exists pin_fails int not null default 0,
  add column if not exists pin_blocked_until timestamptz;

-- ------------------------------------------------------------- oprávnění
-- Čtení žebříčku zůstává veřejné, ale otisk PINu ani počítadlo pokusů
-- se přečíst nedají – proto výčet sloupců místo celé tabulky.
revoke select on public.leaderboard from anon;
grant select (id, device_id, name, avatar, levels, bonus, coins,
              stars, streak, updated_at)
  on public.leaderboard to anon;

-- Přímý zápis anonymním klíčem končí.
drop policy if exists "insert for everyone" on public.leaderboard;
drop policy if exists "update scores" on public.leaderboard;
revoke insert, update, delete on public.leaderboard from anon;

-- ------------------------------------------------------- stav jména
-- Kolik toho smí zjistit kdokoli, kdo napíše jméno: jestli je obsazené,
-- jestli je zamčené a jak daleko ten hráč došel. Nic víc.
create or replace function public.player_status(p_name text)
returns table (taken boolean, locked boolean, levels int, avatar text)
language sql stable security definer set search_path = public as $$
  select true, l.pin_hash is not null, l.levels, l.avatar
    from public.leaderboard l where l.name = p_name
  union all
  select false, false, 0, null::text
   where not exists (select 1 from public.leaderboard where name = p_name)
  limit 1;
$$;

-- --------------------------------------------------------- přihlášení
-- Vrací celý postup, když PIN sedí. Když nesedí, vrátí nápovědu, aby si
-- hráč vzpomněl. Po pěti chybách se jméno na čtvrt hodiny zamkne, aby
-- čtyřmístný PIN nešlo prostě zkusit celý.
create or replace function public.sign_in(p_name text, p_pin text)
returns table (ok boolean, reason text, hint text, avatar text,
               levels int, bonus int, coins int, stars int, streak int)
language plpgsql security definer set search_path = public, extensions as $$
declare r public.leaderboard;
begin
  select * into r from public.leaderboard where name = p_name;
  if r is null then
    return query select false, 'unknown', null::text, null::text, 0, 0, 0, 0, 0;
    return;
  end if;
  if r.pin_blocked_until is not null and r.pin_blocked_until > now() then
    return query select false, 'blocked', r.pin_hint, null::text, 0, 0, 0, 0, 0;
    return;
  end if;
  if r.pin_hash is null then
    -- jméno ještě není zamčené: pustíme, hra pak nabídne nastavení PINu
    return query select true, 'nopin', r.pin_hint, r.avatar,
                        r.levels, r.bonus, r.coins, r.stars, r.streak;
    return;
  end if;
  if p_pin is null or extensions.crypt(p_pin, r.pin_hash) <> r.pin_hash then
    update public.leaderboard set
      pin_fails = case when r.pin_fails + 1 >= 5 then 0 else r.pin_fails + 1 end,
      pin_blocked_until = case when r.pin_fails + 1 >= 5
                               then now() + interval '15 minutes' end
     where name = p_name;
    return query select false, 'wrong', r.pin_hint, null::text, 0, 0, 0, 0, 0;
    return;
  end if;
  update public.leaderboard
     set pin_fails = 0, pin_blocked_until = null where name = p_name;
  return query select true, 'ok', r.pin_hint, r.avatar,
                      r.levels, r.bonus, r.coins, r.stars, r.streak;
end $$;

-- ------------------------------------------------------------- zápis skóre
-- Jediná cesta, jak se skóre dostane do tabulky. Bez správného PINu
-- (u zamčeného jména) zápis neprojde, ať přijde odkudkoli.
create or replace function public.save_score(
  p_name text, p_pin text, p_device uuid, p_avatar text,
  p_levels int, p_bonus int, p_coins int, p_stars int, p_streak int)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r public.leaderboard;
begin
  select * into r from public.leaderboard where name = p_name;

  if r is null then
    insert into public.leaderboard (device_id, name, avatar, levels, bonus,
                                    coins, stars, streak)
    values (coalesce(p_device, gen_random_uuid()), p_name,
            coalesce(p_avatar, '🦊'), greatest(coalesce(p_levels, 0), 0),
            greatest(coalesce(p_bonus, 0), 0), greatest(coalesce(p_coins, 0), 0),
            greatest(coalesce(p_stars, 0), 0), greatest(coalesce(p_streak, 0), 0));
    return 'created';
  end if;

  if r.pin_hash is not null
     and (p_pin is null or extensions.crypt(p_pin, r.pin_hash) <> r.pin_hash) then
    raise exception 'wrong pin for %', p_name using errcode = '28000';
  end if;

  -- trigger leaderboard_keep_best_trg hlídá, že čísla nejdou dolů
  update public.leaderboard
     set avatar = coalesce(p_avatar, avatar),
         levels = coalesce(p_levels, levels),
         bonus  = coalesce(p_bonus,  bonus),
         coins  = coalesce(p_coins,  coins),
         stars  = coalesce(p_stars,  stars),
         streak = coalesce(p_streak, streak),
         updated_at = now()
   where name = p_name;
  return 'updated';
end $$;

-- --------------------------------------------------------- nastavení PINu
-- Zamčení jména, které PIN ještě nemá, nebo změna stávajícího (to už
-- vyžaduje ten starý).
create or replace function public.set_pin(
  p_name text, p_old_pin text, p_new_pin text, p_hint text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare r public.leaderboard;
begin
  if p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'pin must be four digits' using errcode = '22023';
  end if;
  select * into r from public.leaderboard where name = p_name;
  if r is null then
    raise exception 'no such player: %', p_name using errcode = 'P0002';
  end if;
  if r.pin_hash is not null
     and (p_old_pin is null or extensions.crypt(p_old_pin, r.pin_hash) <> r.pin_hash) then
    raise exception 'wrong pin' using errcode = '28000';
  end if;
  update public.leaderboard
     set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')),
         pin_hint = nullif(btrim(coalesce(p_hint, '')), ''),
         pin_fails = 0, pin_blocked_until = null
   where name = p_name;
  return 'ok';
end $$;

grant execute on function public.player_status(text) to anon;
grant execute on function public.sign_in(text, text) to anon;
grant execute on function public.save_score(text, text, uuid, text, int, int, int, int, int) to anon;
grant execute on function public.set_pin(text, text, text, text) to anon;

-- Zapomenutý PIN se resetuje ručně tady v editoru:
--   update public.leaderboard set pin_hash = null, pin_hint = null,
--          pin_fails = 0, pin_blocked_until = null where name = 'Jméno';
