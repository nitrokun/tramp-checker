-- migration 003: 業種マスタと業種別判定（要件定義書 §5 全文）
create table sectors (
  code          text primary key,
  name_ja       text not null,
  display_order int not null,
  unique (name_ja)
);

insert into sectors (code, name_ja, display_order) values
  ('semiconductor',  '半導体',               1),
  ('ai_tech',        'AI・ハイテク',          2),
  ('auto',           '自動車',               3),
  ('steel_materials','鉄鋼・アルミ・素材',     4),
  ('banking',        '銀行・金融',            5),
  ('energy',         'エネルギー',            6),
  ('defense',        '防衛・宇宙',            7),
  ('pharma',         '医薬品・ヘルスケア',     8),
  ('crypto',         '暗号資産関連',          9),
  ('consumer',       '消費・小売',           10),
  ('real_estate',    '不動産・建設',         11),
  ('agriculture',    '農業・食品',           12);

create table judgement_sector_impacts (
  id            uuid primary key default gen_random_uuid(),
  judgement_id  uuid not null references judgements(id) on delete cascade,
  sector_code   text not null references sectors(code),
  direction     text not null check (direction in ('positive', 'negative', 'neutral')),
  note          text,
  unique (judgement_id, sector_code)
);
create index idx_jsi_sector on judgement_sector_impacts (sector_code);
