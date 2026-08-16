-- Slovotoč – tabulka pro společný žebříček (Supabase / Postgres).
-- Spustit jednou v SQL editoru Supabase projektu.

create table public.leaderboard (
  id bigint generated always as identity primary key,
  device_id uuid not null,
  name text not null check (char_length(name) between 1 and 14),
  avatar text not null default '🦊' check (char_length(avatar) <= 4),
  levels int not null default 0 check (levels between 0 and 1000),
  bonus int not null default 0 check (bonus between 0 and 100000),
  coins int not null default 0 check (coins between 0 and 1000000),
  updated_at timestamptz not null default now(),
  unique (device_id, name)
);

alter table public.leaderboard enable row level security;

-- Žebříček je veřejný ke čtení a hráči do něj zapisují anonymním klíčem.
-- Mazání záměrně nemá politiku – nikdo tedy nemůže cizí skóre smazat.
create policy "read for everyone" on public.leaderboard
  for select using (true);

create policy "insert for everyone" on public.leaderboard
  for insert with check (true);

create policy "update scores" on public.leaderboard
  for update using (true) with check (true);

-- Přidáno později: hvězdy za úrovně a série denní výzvy.
-- Hra funguje i bez těchto sloupců (klient se umí vrátit ke staršímu
-- schématu), ale bez nich se hvězdy a série v žebříčku nezobrazí.
alter table public.leaderboard
  add column if not exists stars  int not null default 0 check (stars  between 0 and 10000),
  add column if not exists streak int not null default 0 check (streak between 0 and 10000);

-- Úklid testovacích řádků (spustit v SQL editoru, RLS se tam neuplatňuje):
-- delete from public.leaderboard where name in ('TestBot', 'Filip', 'Anička');
