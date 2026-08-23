-- Slovotoč – hlášení slov („tohle slovo mělo hra uznat" / „tohle slovo tam
-- nepatří"). Spustit celé najednou v SQL editoru Supabase.
--
-- Do téhle chvíle se hlášení otevíralo jako GitHub issue. To funguje pro
-- jednoho člověka na světě a pro nikoho dalšího: děti ani rodiče GitHub
-- nemají a hlášení tím padalo do prázdna. Teď se ukládá sem a je vidět
-- v Table editoru Supabase.

create table if not exists public.word_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- slovo, jak ho hráč napsal (bez diakritiky, tak jak ho složil na kole)
  word text not null check (char_length(word) between 1 and 24),
  -- missing = mělo být uznáno, wrong = tohle slovo do hry nepatří
  kind text not null check (kind in ('missing', 'wrong')),
  level int check (level between 0 and 1000),
  player text check (char_length(player) <= 14),
  device_id uuid,
  -- co s tím: new → added (přidáno do extra-words.txt) / rejected (neuznáno)
  status text not null default 'new' check (status in ('new', 'added', 'rejected')),
  note text,
  -- stejné slovo z jednoho zařízení podruhé není nové hlášení
  unique (word, kind, device_id)
);

create index if not exists word_reports_new_idx
  on public.word_reports (created_at desc) where status = 'new';

alter table public.word_reports enable row level security;

-- Hráči smějí hlásit, ale nic víc: žádný update, žádné mazání.
drop policy if exists "report for everyone" on public.word_reports;
create policy "report for everyone" on public.word_reports
  for insert with check (true);

drop policy if exists "read reports" on public.word_reports;
create policy "read reports" on public.word_reports
  for select using (true);

-- Anonymní klíč je veřejný, takže se čtou jen sloupce, které nikoho
-- neidentifikují – jméno hráče ani id zařízení mezi ně nepatří. V Table
-- editoru Supabase (ten jede pod jiným klíčem) je samozřejmě vidět vše.
revoke all on public.word_reports from anon;
grant insert (word, kind, level, player, device_id) on public.word_reports to anon;
grant select (id, created_at, word, kind, level, status) on public.word_reports to anon;
