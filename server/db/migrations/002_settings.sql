-- Réglages de la plateforme (code d'installation de la console…).
-- RLS active, aucune politique : seule la clé service_role y accède.
create table if not exists pearl_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table pearl_settings enable row level security;
