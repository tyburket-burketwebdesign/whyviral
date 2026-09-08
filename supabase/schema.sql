-- WhyViral schema. Run once in Supabase: SQL Editor → New query → paste → Run.
--
-- Design rule: Stripe is the source of truth for subscription state. This table
-- is a cache that the webhook writes and the app only reads. Never compute
-- subscription status here.

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------- accounts
-- An account can exist before an email does. The first analysis is anonymous,
-- keyed on a device id generated in the browser, and gets claimed later when
-- the person signs in.
create table if not exists accounts (
  id           uuid primary key default uuid_generate_v4(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  email        text unique,
  device_id    text unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists accounts_device_idx on accounts(device_id);
create index if not exists accounts_auth_idx   on accounts(auth_user_id);

-- ------------------------------------------------------------ entitlements
-- plan:   'free' | 'pro'
-- status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
create table if not exists entitlements (
  account_id             uuid primary key references accounts(id) on delete cascade,
  plan                   text not null default 'free',
  status                 text not null default 'none',
  trial_used             int  not null default 0,
  trial_limit            int  not null default 3,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

create index if not exists entitlements_customer_idx on entitlements(stripe_customer_id);

-- -------------------------------------------------------------- usage_events
-- One row per billable action. This is how the trial is counted, and later how
-- you measure whether people come back — the retention number that decides
-- whether this is a business.
create table if not exists usage_events (
  id         bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  kind       text not null,               -- 'analysis' | 'enrich' | 'control'
  meta       jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_account_time_idx on usage_events(account_id, created_at desc);

-- -------------------------------------------------------------- saved runs
-- Replaces localStorage so history follows the person across devices.
create table if not exists analyses (
  id         uuid primary key default uuid_generate_v4(),
  account_id uuid not null references accounts(id) on delete cascade,
  topic      text,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists analyses_account_time_idx on analyses(account_id, created_at desc);

-- ------------------------------------------------------- row level security
-- The API uses the service role key and bypasses RLS. These policies exist so
-- that if the anon key is ever exposed client-side, it reads nothing it
-- shouldn't. Entitlements are deliberately read-only to the client: only the
-- Stripe webhook may write them.
alter table accounts     enable row level security;
alter table entitlements enable row level security;
alter table usage_events enable row level security;
alter table analyses     enable row level security;

drop policy if exists "own account" on accounts;
create policy "own account" on accounts
  for select using (auth.uid() = auth_user_id);

drop policy if exists "own entitlement" on entitlements;
create policy "own entitlement" on entitlements
  for select using (
    account_id in (select id from accounts where auth_user_id = auth.uid())
  );

drop policy if exists "own usage" on usage_events;
create policy "own usage" on usage_events
  for select using (
    account_id in (select id from accounts where auth_user_id = auth.uid())
  );

drop policy if exists "own analyses" on analyses;
create policy "own analyses" on analyses
  for all using (
    account_id in (select id from accounts where auth_user_id = auth.uid())
  );

-- --------------------------------------------------------------- automation
-- Every account gets an entitlement row immediately, so the app never has to
-- handle a missing one.
create or replace function ensure_entitlement() returns trigger as $$
begin
  insert into entitlements (account_id) values (new.id)
  on conflict (account_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists accounts_ensure_entitlement on accounts;
create trigger accounts_ensure_entitlement
  after insert on accounts
  for each row execute function ensure_entitlement();

-- ------------------------------------------------------------ trial_claims
-- One row per identity signal that has consumed a trial. The unique constraint
-- is what actually enforces it: a second account presenting the same
-- normalised email, device or card fingerprint cannot insert, so it gets no
-- trial. Denied a trial, not denied an account — they can still subscribe.
create table if not exists trial_claims (
  kind       text not null,               -- 'email' | 'device' | 'card'
  value      text not null,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kind, value)
);

create index if not exists trial_claims_account_idx on trial_claims(account_id);

alter table trial_claims enable row level security;
-- No client policy at all: only the service role touches this table.

-- Normalised email lives on the account so duplicates are visible in queries.
alter table accounts add column if not exists email_normalized text;
create index if not exists accounts_email_norm_idx on accounts(email_normalized);

-- ---------------------------------------------------------------- profiles
-- Collected at sign-up. Phone and marketing consent are stored with the exact
-- wording shown and the moment it was given, because "they ticked a box" is not
-- a defence under TCPA — you need to show what they agreed to.
alter table accounts add column if not exists full_name        text;
alter table accounts add column if not exists phone            text;
alter table accounts add column if not exists phone_consent    boolean default false;
alter table accounts add column if not exists consent_text     text;
alter table accounts add column if not exists consent_at       timestamptz;
alter table accounts add column if not exists birthdate        date;
alter table accounts add column if not exists marketing_opt_in boolean default false;

create index if not exists accounts_phone_idx on accounts(phone);
