-- Keep snapshots accessible only to the server role used by APPuestas.
-- Revoke first so rerunning this migration leaves exactly SELECT and INSERT.
revoke all privileges on table public.nfl_snapshots
  from public, anon, authenticated, service_role;

grant select, insert on table public.nfl_snapshots to service_role;
