create table if not exists public.betting_picks (
  id uuid primary key default gen_random_uuid(),
  sport text not null check (sport in ('MLB', 'NFL')),
  event_id text not null,
  event_date date not null,
  created_at timestamptz not null default now(),

  home_team text,
  away_team text,
  market text not null,
  selection text not null,
  odds numeric(10,4) not null check (odds > 1),

  estimated_probability numeric(8,6) not null check (estimated_probability >= 0 and estimated_probability <= 1),
  implied_probability numeric(8,6) not null check (implied_probability >= 0 and implied_probability <= 1),
  edge numeric(8,6) not null,
  ev numeric(10,6) not null,
  confidence numeric(6,2) not null check (confidence >= 0 and confidence <= 100),

  grade text not null,
  decision text not null check (decision in ('BET', 'NO BET')),
  units numeric(10,4) not null default 0,

  result text not null default 'PENDING' check (result in ('PENDING', 'WIN', 'LOSS', 'PUSH', 'VOID')),
  settled_at timestamptz,

  is_parlay boolean not null default false,
  parlay_id uuid,

  phase text check (phase in ('REGULAR_SEASON', 'PLAYOFFS')),
  model_version text not null default 'unknown',
  prompt_version text not null default 'unknown',
  config_version text not null default 'unknown'
);

create index if not exists betting_picks_event_date_idx
  on public.betting_picks (event_date desc);

create index if not exists betting_picks_sport_event_date_idx
  on public.betting_picks (sport, event_date desc);

create index if not exists betting_picks_result_idx
  on public.betting_picks (result);

comment on table public.betting_picks is
  'Immutable historical record of APPuestas recommendations and their eventual results.';

alter table public.betting_picks enable row level security;

-- Server routes use the service_role client for reads, inserts, and settlement updates.
-- Client roles do not need direct access to this table.
drop policy if exists "Allow read betting picks" on public.betting_picks;
revoke all privileges on table public.betting_picks from public, anon, authenticated;
revoke all privileges on table public.betting_picks from service_role;
grant select, insert, update on table public.betting_picks to service_role;
