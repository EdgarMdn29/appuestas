create table if not exists public.nfl_odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null,
  nfl_snapshot_id uuid not null references public.nfl_snapshots (id) on delete restrict,
  season integer not null check (season between 1999 and 2200),
  week integer not null check (week between 1 and 30),
  nfl_game_id text not null,
  odds_event_id text not null,
  commence_time timestamptz not null,
  captured_at timestamptz not null,
  market_last_update timestamptz not null,
  bookmaker_key text not null,
  bookmaker_title text not null,
  market text not null check (market in ('MONEYLINE', 'SPREAD', 'TOTAL')),
  outcome text not null,
  point numeric,
  price numeric not null check (price > 1),
  home_team text not null,
  away_team text not null,
  source text not null check (source = 'ODDS_API'),
  created_at timestamptz not null default now(),
  constraint nfl_odds_snapshots_market_outcome_point_check check (
    (market = 'MONEYLINE' and outcome in ('HOME', 'AWAY') and point is null)
    or (market = 'SPREAD' and outcome in ('HOME', 'AWAY') and point is not null)
    or (market = 'TOTAL' and outcome in ('OVER', 'UNDER') and point is not null)
  )
);

-- NULLS NOT DISTINCT makes the point-less moneyline outcome unique per capture.
create unique index if not exists nfl_odds_snapshots_capture_outcome_uidx
  on public.nfl_odds_snapshots
  (capture_id, odds_event_id, bookmaker_key, market, outcome, point) nulls not distinct;

create index if not exists nfl_odds_snapshots_capture_id_idx
  on public.nfl_odds_snapshots (capture_id);
create index if not exists nfl_odds_snapshots_nfl_game_id_idx
  on public.nfl_odds_snapshots (nfl_game_id);
create index if not exists nfl_odds_snapshots_captured_at_idx
  on public.nfl_odds_snapshots (captured_at desc);
create index if not exists nfl_odds_snapshots_odds_event_id_idx
  on public.nfl_odds_snapshots (odds_event_id);

alter table public.nfl_odds_snapshots enable row level security;

create or replace function public.reject_nfl_odds_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'NFL odds snapshots are immutable';
end;
$$;

drop trigger if exists nfl_odds_snapshots_immutable on public.nfl_odds_snapshots;
create trigger nfl_odds_snapshots_immutable
  before update or delete on public.nfl_odds_snapshots
  for each row execute function public.reject_nfl_odds_snapshot_mutation();

revoke all privileges on table public.nfl_odds_snapshots
  from public, anon, authenticated, service_role;
grant select, insert on table public.nfl_odds_snapshots to service_role;
