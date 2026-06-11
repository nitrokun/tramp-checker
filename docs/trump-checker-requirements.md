# トランプチェッカー 要件定義書 兼 設計書

- 版数: v1.0（2026-06-12）
- 作成: 久保圭司（CMO&CIO）／設計支援: クロ
- 目的: 本書のみで Claude Code が実装を開始できること

---

## 0. このドキュメントの読み方（Claude Code への指示）

- 本書は唯一の正とする。本書にない仕様は実装前に必ず確認を取ること
- 「§11 開発フェーズ」の順に実装する。フェーズを跨いだ先行実装は禁止
- 既存の CLAUDE.md グローバルルール（ハードコード禁止／DB操作前の確認必須／二重実装禁止／データ表現の一意性）は本プロジェクトにも全面適用する

---

## 1. プロジェクト概要

### 1.1 背景と目的
- 「お悩み解決サイト選手権」（https://onayami-contest.munakata-engineer.com/）への応募作品
- 解決する悩み: **個人投資家はトランプ大統領の発言で株価が乱高下するたびに一喜一憂している。発言を追い切れず、市場への影響判断も難しい**
- 提供価値: トランプ発言を自動収集し、AIが「市場全体のセンチメント」と「業種別の影響方向」を判定して即座に可視化・通知する

### 1.2 審査基準との対応
| 審査基準 | 本サイトの回答 |
|---|---|
| アイディア | 投資家の普遍的な悩み（発言ショックの常態化）を直撃 |
| 工夫・こだわり | 業種別判定／AI的中率の自己検証（答え合わせ）／プロンプトのバージョン管理 |
| 実用性 | 朝3秒で全体観が掴めるヒートマップ＋メール通知 |

### 1.3 コンテスト制約（遵守必須）
- 結果発表まで公開状態を維持すること（無断停止は失格リスク）
- 禁止事項: 肖像権侵害（**トランプ氏の顔写真・似顔絵は一切使用しない**）、特定個人への誹謗中傷（判定は中立トーン厳守）

---

## 2. 法務・コンプライアンス要件（最優先・変更禁止）

### 2.1 金融商品取引法（投資助言・代理業の回避）
- **完全無料・会員登録なしで全情報を閲覧可能にする**こと。判定情報をメール登録者限定にしてはならない（メールは公開情報の通知手段にすぎない構造を維持）
- **個別銘柄の言及・推奨は禁止。判定はすべて業種単位**（§5 sectors マスタの12業種のみ）
- 「買い」「売り」「推奨」等の売買指示と解釈されうる文言を UI・メール・判定出力のすべてで禁止

### 2.2 免責表示（全ページフッターに固定表示）
```
本サイトは特定の金融商品の売買を推奨するものではなく、公開情報に基づく
一般的な市況情報の提供を目的としています。投資の最終判断はご自身の責任で
行ってください。
```

### 2.3 特定電子メール法（メール配信機能）
メールフッターに以下4点を必ず表示する:
1. 運営者の氏名または名称
2. 受信拒否（配信停止）ができる旨の案内
3. 配信停止用URL（unsubscribe_token 付き、ワンクリックで完了）
4. 運営者の住所および問い合わせ先

- ダブルオプトイン必須（確認メールのリンククリックで本登録）
- 同意記録として consent_ip と登録日時を保存
- 配信停止後も該当行は物理削除せず最低1ヶ月保持（同意記録の保存義務）

---

## 3. 技術スタック

| 層 | 技術 | 備考 |
|---|---|---|
| フロント/API | Next.js (App Router) + TypeScript | Vercel デプロイ |
| DB | Supabase (PostgreSQL) | RLS 必須 |
| AI判定 | Anthropic API | 既定モデル: claude-haiku-4-5。環境変数で切替可能にする |
| メール | Resend | 無料枠 100通/日・3,000通/月 |
| 定期実行 | Vercel Cron | 自宅PC・タスクスケジューラへの依存は禁止 |
| リポジトリ | GitHub: jyoseikan org 配下に新規作成 | Vercel と CI/CD 連携 |

### 3.1 環境変数（ハードコード禁止。SETUP.md に一覧を記載すること）
```
ANTHROPIC_API_KEY=          # AI判定用
JUDGE_MODEL=claude-haiku-4-5  # 判定モデル（切替可能に）
STATEMENT_SOURCE=trumpstruth  # 取得ソース切替: trumpstruth | cnn_archive
RESEND_API_KEY=
NOTIFY_FROM_ADDRESS=
CONFIDENCE_THRESHOLD=0.75   # 即時メール配信のしきい値
DAILY_EMAIL_LIMIT=80        # サーキットブレーカー発動値
CRON_SECRET=                # Cron エンドポイント認証
NEXT_PUBLIC_SITE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=  # サーバー側のみ。クライアント露出禁止
SUPABASE_ANON_KEY=
```

---

## 4. データ取得（スクレイピング不実装）

自前スクレイパーは作らない。公開フィード/JSONの取得のみ。

### 4.1 ソース（アダプタパターンで抽象化）
- `lib/sources/trumpstruth.ts` — RSS: `https://www.trumpstruth.org/feed`（第1候補。運営が RSS 購読を公式に案内している）
- `lib/sources/cnn-archive.ts` — JSON: `https://ix.cnn.io/data/truth-social/truth_archive.json`（5分更新。非公式エンドポイントのため消滅リスクあり）
- 共通インターフェース: `fetchStatements(): Promise<RawStatement[]>`
- アクティブソースは環境変数 `STATEMENT_SOURCE` で切替（ハードコード禁止）
- 取得失敗時: リトライ1回 → 失敗を logs テーブルに記録（握りつぶし禁止）

### 4.2 取り込み Cron
- エンドポイント: `POST /api/cron/ingest`（`CRON_SECRET` による Bearer 認証必須）
- 間隔: 10分（vercel.json で定義）
- 処理: 取得 → content_hash で statements と突合 → 新規のみ insert → 新規分のみ AI 判定 → judgements / judgement_sector_impacts に insert → 即時メール配信判定（§7）

---

## 5. DBスキーマ（migration 全文）

### migration 001: コアテーブル
```sql
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
```

### migration 002: メール購読
```sql
create table subscribers (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique,
  delivery_mode      text not null default 'digest'
                     check (delivery_mode in ('instant', 'digest')),
  confirm_token      text not null default encode(gen_random_bytes(24), 'hex'),
  confirmed_at       timestamptz,
  unsubscribe_token  text not null default encode(gen_random_bytes(24), 'hex'),
  unsubscribed_at    timestamptz,
  consent_ip         text,
  created_at         timestamptz not null default now()
);

create table deliveries (
  id             uuid primary key default gen_random_uuid(),
  subscriber_id  uuid not null references subscribers(id) on delete cascade,
  judgement_id   uuid references judgements(id),
  kind           text not null check (kind in ('confirm', 'instant', 'digest')),
  sent_at        timestamptz not null default now(),
  unique (subscriber_id, judgement_id, kind)
);
```

### migration 003: 業種マスタと業種別判定
```sql
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
```

### RLS ポリシー（全テーブル共通方針）
- statements / judgements / judgement_sector_impacts / sectors / market_snapshots: RLS 有効化 + anon に select のみ許可。insert/update/delete のポリシーは作らない（service_role 経由のみ）
- subscribers / deliveries / logs: RLS 有効化。**anon ポリシーは一切作らない**（メールアドレスの公開は絶対禁止）

---

## 6. AI判定仕様

### 6.1 呼び出し
- モデル: 環境変数 `JUDGE_MODEL`（既定 claude-haiku-4-5）
- プロンプトは `lib/prompts/judge/v1.ts` に配置し、`prompt_version` をファイル名と一致させる。改善時は v2.ts を新規作成（v1 の上書き禁止 = 的中率のバージョン比較を可能にするため）
- **業種リストはプロンプトにハードコードせず、毎回 sectors テーブルから動的取得して埋め込む**

### 6.2 出力 JSON スキーマ（これ以外の形式を許容しない）
```json
{
  "content_ja": "発言の日本語要約（80字以内・中立トーン）",
  "sentiment": "positive | negative | neutral",
  "confidence": 0.0,
  "sector_impacts": [
    { "sector_code": "steel_materials", "direction": "positive", "note": "30字以内" }
  ],
  "impact_summary": "日本株・ドル円への波及見立て（100字以内）",
  "rationale": "判定根拠（150字以内）"
}
```

### 6.3 プロンプト必須制約
- sector_code はマスタのリスト内からのみ選択。リスト外は生成禁止と明示
- 影響が明確な業種のみ列挙（最大5業種）。市場と無関係な発言は sentiment: neutral、sector_impacts: []
- 売買推奨と解釈されうる表現の生成禁止
- insert 時に sector_code が FK 違反した行はその行のみスキップし logs に記録（判定全体は破棄しない）

---

## 7. メール配信仕様

### 7.1 API ルート
| ルート | 処理 |
|---|---|
| POST /api/subscribe | 仮登録 + 確認メール送信（consent_ip 記録） |
| GET /api/confirm?token= | confirmed_at を now() に更新 → 完了ページ表示 |
| GET /api/unsubscribe?token= | unsubscribed_at を now() に更新 → 完了ページ表示（物理削除しない） |
| POST /api/cron/digest | 毎朝 7:00 JST（cron: `0 22 * * *` UTC）。前日分まとめ送信 |

### 7.2 配信ロジック
- 即時: 新規 judgement が `sentiment != 'neutral'` かつ `confidence >= CONFIDENCE_THRESHOLD` のとき、delivery_mode='instant' かつ confirmed 済み かつ未解除の購読者へ送信
- ダイジェスト: 前日 0:00〜23:59 JST の全判定をまとめて送信
- 送信前に deliveries で重複チェック、送信後に insert
- **サーキットブレーカー: 当日送信数が `DAILY_EMAIL_LIMIT` を超えたら即時配信を停止しダイジェストへ退避。発動を logs に記録**

### 7.3 メールテンプレート
- 件名例: `【トランプチェッカー】ネガティブ判定: 対中関税に言及（確信度85%）`
- 本文: 日本語要約 / 総合判定 / 業種チップ / サイトへのリンク
- フッター: §2.3 の4項目を固定表示

---

## 8. UI・デザイン仕様（シティポップ・コラージュ）

### 8.1 デザイン原則
- フルカラー切り抜きコラージュ調。**彩度をしっかり落とす／背景単色をセクションごとに切替／モチーフの超接写**
- **角丸全廃**（border-radius: 0）。断ち切りの直線で構成
- ヒーローと登録セクションに薄い方眼グリッド背景（56px 間隔、線色 #E3DED2）
- **トランプ氏の顔写真・似顔絵は使用禁止**。ヒーローのビジュアルはモノクロ加工した瞳の超接写（ライセンスフリー写真。Unsplash 等で commercial 利用可を確認しダウンロード元を README に記録）

### 8.2 デザイントークン（tailwind.config に定義。任意の hex 直書き禁止）
```
paper:       #F4F1EA   // 紙白（ヒーロー・登録セクション背景）
paper-grid:  #E3DED2   // 方眼線
ink:         #1E1B16   // 墨（テキスト・暗部セクション背景）
ink-soft:    #2C2820   // 暗部カード
brand-red:   #B4453A   // くすみレンガ（主役・赤丸・メトリクス帯）
neg:         #9C4136   // ネガティブ強
neg-soft:    #B25A4E   // ネガティブ弱
pos:         #557263   // ポジティブ強
pos-soft:    #6B8A78   // ポジティブ弱
neutral:     #E2D7C6   // 中立タイル
sand:        #EFE7DC   // ヒートマップセクション背景
text-muted:  #5C564A
```

### 8.3 セクション構成（上から。背景単色を切替）
1. **ヒーロー**（paper + 方眼）: 巨大数字「16回/日」+ 赤丸 + コピー「市場は、その度に動く。」+ 瞳の超接写（右カラム）。脚注に出典「AFP 2025年1〜7月 投稿2,800件超の分析に基づく平均値」
2. **メトリクス帯**（brand-red）: 本日の発言数 / 24h総合センチメント / AI的中率（24h検証）
3. **業種ヒートマップ**（sand）: 12業種タイル。direction × 言及回数で濃淡。**色だけに頼らず矢印アイコン＋「×回数」テキストを必ず併記**（色覚多様性対応・削除禁止）
4. **発言フィード**（ink）: 判定バッジ / 確信度 / 経過時間 / 日本語要約 / 業種チップ / 的中バッジ（検証済のみ）
5. **メール登録**（paper + 方眼 + 赤丸あしらい）: email入力 + 配信モード select + 登録ボタン
6. **フッター**: §2.2 免責 + 運営者情報

### 8.4 レスポンシブ
- ヒーローの2カラム（数字｜瞳）はモバイル幅（< 640px）で縦積みに切替。**審査員はスマホで見る前提で必ず実機幅を確認**
- ヒートマップは auto-fit, minmax(148px, 1fr)

### 8.5 データ表示ルール
- 「最終取得 N分前」をヘッダーに常時表示（ソース死活監視を兼ねる）
- 的中率は v_judgement_results から動的算出（保存値を持たない）
- 表示数値はすべて丸め処理（確信度は整数%、的中率は整数%）

---

## 9. ページ・コンポーネント構成

```
app/
  page.tsx                    // トップ（§8.3 の全セクション）
  statements/[id]/page.tsx    // 発言詳細（判定根拠 rationale を表示）
  accuracy/page.tsx           // 的中率検証ページ（モデル別・prompt_version別）
  subscribe/done/page.tsx     // 登録完了・解除完了
  api/cron/ingest/route.ts
  api/cron/digest/route.ts
  api/subscribe/route.ts
  api/confirm/route.ts
  api/unsubscribe/route.ts
components/
  Hero.tsx / MetricsBar.tsx / SectorHeatmap.tsx
  StatementCard.tsx / SubscribeForm.tsx / Footer.tsx
lib/
  sources/{trumpstruth,cnn-archive}.ts
  prompts/judge/v1.ts
  judge.ts                    // Anthropic API 呼び出し + JSONパース + バリデーション
  mailer.ts                   // Resend ラッパ + サーキットブレーカー
  supabase.ts
```

---

## 10. 非機能要件

- 可用性: コンテスト結果発表まで公開維持（§1.3）。外部依存（フィード・API）の失敗はすべて logs に記録し、ヘッダーの「最終取得」表示で異常を可視化
- セキュリティ: service_role キーのクライアント露出禁止 / Cron 認証必須 / メールアドレスの anon 読み取り禁止
- コスト上限: Anthropic API 月数百円規模・Resend 無料枠・Vercel Hobby または Pro。超過見込みが出たら実装を止めて報告
- 既存ルール適用: ハードコード禁止（年・件数・しきい値・業種名・モデル名すべて）／DB破壊的操作前の確認必須／verify-one-then-batch

---

## 11. 開発フェーズ（この順で実装。各フェーズ完了時に動作確認報告）

### Phase 1: MVP（表示のみ）
1. リポジトリ作成・Next.js 雛形・Supabase プロジェクト・migration 001 + 003
2. ソースアダプタ（trumpstruth）+ ingest Cron + AI判定パイプライン
3. トップページ（ヒーロー / メトリクス / ヒートマップ / フィード / フッター）
4. Vercel デプロイ・独自ドメイン接続

### Phase 2: メール配信
5. migration 002 + Resend 連携 + subscribe/confirm/unsubscribe
6. ダイジェスト Cron + 即時配信 + サーキットブレーカー

### Phase 3: 答え合わせ
7. market_snapshots 取得 Cron（無料市況APIを調査のうえ提案 → 承認後に実装）
8. accuracy ページ（モデル別・prompt_version 別の的中率比較）

---

## 12. 受け入れ基準（全項目クリアで完成）

- [ ] 会員登録なしで全判定情報が閲覧できる
- [ ] 個別銘柄名がUI・メール・AI出力のどこにも出力されない（業種のみ）
- [ ] 免責表示が全ページに表示される
- [ ] トランプ氏の顔写真・似顔絵が一切使われていない
- [ ] 新規発言が10分以内に取り込まれ、判定付きでトップに表示される
- [ ] sectors マスタ外の業種が judgement_sector_impacts に入らない（FK で保証）
- [ ] ダブルオプトインを経ないアドレスにはメールが送信されない
- [ ] メールフッターに特定電子メール法の4項目が表示され、解除URLがワンクリックで機能する
- [ ] 1日の送信数が DAILY_EMAIL_LIMIT を超えると即時配信が自動停止する
- [ ] ヒートマップが色＋アイコン＋テキストの三重表現になっている
- [ ] モバイル幅でヒーローが縦積みに切り替わる
- [ ] anon キーで subscribers テーブルが読めないことを確認済み
