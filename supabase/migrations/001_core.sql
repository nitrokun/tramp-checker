-- migration 001: コアテーブル（要件定義書 §5 全文）
create table statements (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('truth_social', 'news_rss', 'speech', 'interview')),
  source_url    text,
  content_en    text not null,
  content_ja    text,
  content_hash  text generated always as (md5(content_en)) stored,
  stated_at     timestamptz not null,
  fetched_at    timestamptz not null default now(),
  raw           jsonb,
  unique (content_hash)
);
create index idx_statements_stated_at on statements (stated_at desc);

create table judgements (
  id               uuid primary key default gen_random_uuid(),
  statement_id     uuid not null references statements(id) on delete cascade,
  model            text not null,
  prompt_version   text not null,
  sentiment        text not null check (sentiment in ('positive', 'negative', 'neutral')),
  confidence       numeric(3,2) not null check (confidence between 0 and 1),
  impact_summary   text,
  rationale        text,
  created_at       timestamptz not null default now()
);
create index idx_judgements_statement on judgements (statement_id, created_at desc);

create table market_snapshots (
  id          uuid primary key default gen_random_uuid(),
  symbol      text not null check (symbol in ('sp500_future', 'usdjpy', 'nikkei225')),
  price       numeric not null,
  captured_at timestamptz not null,
  source      text not null,
  unique (symbol, captured_at)
);
create index idx_snapshots_symbol_time on market_snapshots (symbol, captured_at desc);

create table logs (
  id         uuid primary key default gen_random_uuid(),
  level      text not null check (level in ('info', 'warn', 'error')),
  context    text not null,
  message    text not null,
  meta       jsonb,
  created_at timestamptz not null default now()
);

create or replace function get_price_at(p_symbol text, p_time timestamptz)
returns numeric language sql stable as $$
  select price from market_snapshots
  where symbol = p_symbol and captured_at <= p_time
  order by captured_at desc limit 1
$$;

create or replace view v_judgement_results as
select
  j.id as judgement_id,
  s.id as statement_id,
  s.stated_at,
  j.model,
  j.sentiment,
  j.confidence,
  get_price_at('sp500_future', s.stated_at)                       as price_before,
  get_price_at('sp500_future', s.stated_at + interval '1 hour')   as price_after_1h,
  get_price_at('sp500_future', s.stated_at + interval '24 hours') as price_after_24h,
  case
    when get_price_at('sp500_future', s.stated_at + interval '24 hours') is null then null
    when j.sentiment = 'neutral' then null
    when (get_price_at('sp500_future', s.stated_at + interval '24 hours')
          > get_price_at('sp500_future', s.stated_at)) = (j.sentiment = 'positive')
      then true
    else false
  end as hit_24h
from judgements j
join statements s on s.id = j.statement_id;
