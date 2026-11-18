-- Pear : socle multi-tenant.
-- Toutes les tables ont la RLS activée. Les rôles publics de Supabase
-- (anon, authenticated) n'ont AUCUNE politique : une clé publique ne lit
-- rien. Le serveur accède aux données soit avec la clé service_role (API
-- REST, isolation faite par le serveur), soit en prenant le rôle
-- pearl_app (connexion directe, isolation faite par la base via app.tenant).

create table if not exists pearl_migrations (
  id         text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists pearl_tenants (
  slug          text primary key check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name          text not null,
  status        text not null default 'trial' check (status in ('trial', 'active', 'suspended')),
  plan          text not null default 'trial',
  pack          text,
  modules       text[] not null default '{}',
  branding      jsonb not null default '{}'::jsonb,
  domains       text[] not null default '{}',
  billing       jsonb not null default '{}'::jsonb,
  trial_ends_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists pearl_tenants_domains on pearl_tenants using gin (domains);

create table if not exists pearl_documents (
  tenant     text not null references pearl_tenants(slug) on delete cascade on update cascade,
  name       text not null,
  content    jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (tenant, name)
);

create table if not exists pearl_blobs (
  tenant     text not null references pearl_tenants(slug) on delete cascade on update cascade,
  name       text not null,
  data       text not null,           -- base64
  updated_at timestamptz not null default now(),
  primary key (tenant, name)
);

create table if not exists pearl_members (
  user_id     uuid not null,
  tenant      text not null references pearl_tenants(slug) on delete cascade on update cascade,
  role        text not null check (role in ('owner', 'admin', 'manager', 'agent', 'observer')),
  person_name text,
  email       text,
  created_at  timestamptz not null default now(),
  primary key (user_id, tenant)
);
create index if not exists pearl_members_tenant on pearl_members (tenant);

create table if not exists pearl_platform_admins (
  user_id    uuid primary key,
  created_at timestamptz not null default now()
);

alter table pearl_migrations      enable row level security;
alter table pearl_tenants         enable row level security;
alter table pearl_documents       enable row level security;
alter table pearl_blobs           enable row level security;
alter table pearl_members         enable row level security;
alter table pearl_platform_admins enable row level security;

-- Rôle applicatif soumis à la RLS (connexion directe).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'pearl_app') then
    create role pearl_app nologin;
  end if;
end $$;
grant pearl_app to current_user;
grant usage on schema public to pearl_app;
grant select, insert, update, delete on pearl_documents, pearl_blobs to pearl_app;

drop policy if exists pearl_documents_tenant on pearl_documents;
create policy pearl_documents_tenant on pearl_documents to pearl_app
  using (tenant = current_setting('app.tenant', true))
  with check (tenant = current_setting('app.tenant', true));

drop policy if exists pearl_blobs_tenant on pearl_blobs;
create policy pearl_blobs_tenant on pearl_blobs to pearl_app
  using (tenant = current_setting('app.tenant', true))
  with check (tenant = current_setting('app.tenant', true));
