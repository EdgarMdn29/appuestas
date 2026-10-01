create table if not exists public.nfl_snapshots (
  id uuid primary key default gen_random_uuid(),
  season integer not null check (season between 1999 and 2200),
  captured_at timestamptz not null default now(),
  source text not null check (source = 'nflverse'),
  source_version text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists nfl_snapshots_season_captured_at_idx
  on public.nfl_snapshots (season, captured_at desc);

alter table public.nfl_snapshots enable row level security;

create or replace function public.reject_nfl_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'NFL snapshots are immutable';
end;
$$;

drop trigger if exists nfl_snapshots_immutable on public.nfl_snapshots;
create trigger nfl_snapshots_immutable
  before update or delete on public.nfl_snapshots
  for each row execute function public.reject_nfl_snapshot_mutation();
