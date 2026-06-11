# トランプチェッカー セットアップ手順

要件定義書: `docs/trump-checker-requirements.md`（唯一の正）

## 1. 環境変数一覧（§3.1）

`.env.local`（ローカル）および Vercel の環境変数に設定する。**ソースへのハードコード禁止。**

| 変数名 | 用途 | 例・既定値 |
|---|---|---|
| `ANTHROPIC_API_KEY` | AI判定用 | （シークレット） |
| `JUDGE_MODEL` | 判定モデル（切替可能） | `claude-haiku-4-5` |
| `STATEMENT_SOURCE` | 取得ソース切替 | `trumpstruth` \| `cnn_archive` |
| `RESEND_API_KEY` | メール配信（Phase 2） | （シークレット） |
| `NOTIFY_FROM_ADDRESS` | 送信元アドレス（Phase 2） | |
| `CONFIDENCE_THRESHOLD` | 即時メール配信のしきい値 | `0.75` |
| `DAILY_EMAIL_LIMIT` | サーキットブレーカー発動値 | `80` |
| `CRON_SECRET` | Cron エンドポイント認証 | （シークレット） |
| `NEXT_PUBLIC_SITE_URL` | 公開URL | |
| `SUPABASE_URL` | Supabase プロジェクトURL | |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー側のみ。**クライアント露出禁止** | （シークレット） |
| `SUPABASE_ANON_KEY` | 公開読み取り用 | |

`.env.example` をコピーして `.env.local` を作成し、各値を設定する。

## 2. ローカル開発

```bash
npm install
npm run dev   # http://localhost:3000
```

## 3. DB マイグレーション

`supabase/migrations/` の SQL を番号順に適用する（Supabase MCP の `apply_migration` または Dashboard SQL Editor）。

- `001_core.sql` — statements / judgements / market_snapshots / logs / get_price_at / v_judgement_results
- `003_sectors.sql` — sectors マスタ（12業種）+ judgement_sector_impacts
- `004_rls_phase1.sql` — Phase 1 テーブルの RLS（anon は select のみ。logs は anon 不可）

※ `002`（subscribers / deliveries）は Phase 2 で適用する。

## 4. デプロイ

- GitHub: https://github.com/jyoseikan/trump-checker
- Vercel と CI/CD 連携（Phase 1 手順4）
- Cron は `vercel.json` で定義（ingest: 10分間隔 / digest: `0 22 * * *` UTC = 朝7:00 JST）
