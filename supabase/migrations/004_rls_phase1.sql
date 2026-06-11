-- migration 004: Phase 1 テーブルの RLS（要件定義書 §5 RLSポリシー方針）
-- 公開テーブル: RLS 有効化 + anon に select のみ許可（書き込みポリシーは作らない = service_role 経由のみ）
alter table statements enable row level security;
alter table judgements enable row level security;
alter table judgement_sector_impacts enable row level security;
alter table sectors enable row level security;
alter table market_snapshots enable row level security;

create policy "anon_select_statements" on statements for select to anon using (true);
create policy "anon_select_judgements" on judgements for select to anon using (true);
create policy "anon_select_jsi" on judgement_sector_impacts for select to anon using (true);
create policy "anon_select_sectors" on sectors for select to anon using (true);
create policy "anon_select_snapshots" on market_snapshots for select to anon using (true);

-- logs: RLS 有効化のみ。anon ポリシーは一切作らない
alter table logs enable row level security;
