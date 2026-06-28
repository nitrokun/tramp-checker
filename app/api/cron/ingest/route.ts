import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchStatements } from '@/lib/sources/trumpstruth'
import { normalizeContent, contentMd5 } from '@/lib/normalize'
import { judgeStatement, PROMPT_VERSION } from '@/lib/judge'

export const runtime    = 'nodejs'
export const maxDuration = 60

/** service_role でRLSをバイパスして書き込む（クライアント露出禁止） */
function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** 1実行あたりの最大AI判定件数（タイムアウト&コスト対策） */
const MAX_JUDGE = Number(process.env.MAX_JUDGE_PER_RUN ?? '10')

export async function POST(req: NextRequest) {
  // ① 認証：Bearer CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = db()
  const stats = { fetched: 0, inserted: 0, judged: 0, skipped: 0 }

  try {
    // ② RSS取得
    const items = await fetchStatements()
    stats.fetched = items.length

    // ③ INSERT（SELECT-before-INSERT で content_hash / source_guid 双方をチェック）
    for (const item of items) {
      const normalized = normalizeContent(item.contentEn)
      if (!normalized) { stats.skipped++; continue }

      const hash = contentMd5(normalized)

      // 2つのUNIQUE制約を並列チェック（ON CONFLICTで2制約は捌けないためSELECT先行方式）
      const [{ data: byHash }, { data: byGuid }] = await Promise.all([
        supabase.from('statements').select('id').eq('content_hash', hash).maybeSingle(),
        supabase.from('statements').select('id').eq('source_guid', item.guid).maybeSingle(),
      ])

      if (byHash || byGuid) {
        stats.skipped++
        continue
      }

      const { error: insertErr } = await supabase.from('statements').insert({
        source:      'truth_social',
        source_url:  item.sourceUrl,
        source_guid: item.guid,
        content_en:  normalized,         // content_hash は PostgreSQL が md5(content_en) で自動生成
        stated_at:   item.statedAt.toISOString(),
      })

      if (insertErr) {
        // 競合が起きても停止しない（次回Cronで拾う）
        stats.skipped++
        await supabase.from('logs').insert({
          level: 'warn', context: 'ingest/insert',
          message: insertErr.message,
          meta: { guid: item.guid },
        })
        continue
      }

      stats.inserted++
    }

    // ④ 業種マスタをDBから動的取得（ハードコード禁止）
    const { data: sectors, error: sectorsErr } = await supabase
      .from('sectors')
      .select('code, name_ja')
      .order('display_order')

    if (sectorsErr || !sectors?.length) {
      return NextResponse.json(
        { ...stats, error: 'sectors master is empty or unreachable' },
        { status: 500 }
      )
    }

    // ⑤ 未判定 statement を取得（judgements 行を持たないものだけ、冪等性を保証）
    // 2-step: 判定済み statement_id を先に取得 → 除外
    const { data: judgedRows } = await supabase
      .from('judgements')
      .select('statement_id')
      .limit(5000)

    const judgedIds = new Set((judgedRows ?? []).map(r => r.statement_id))

    const { data: recentStmts } = await supabase
      .from('statements')
      .select('id, content_en')
      .order('stated_at', { ascending: false })
      .limit(MAX_JUDGE * 3)   // 多めに取って判定済みを除外後にMAX_JUDGEに絞る

    const unjudged = (recentStmts ?? [])
      .filter(s => !judgedIds.has(s.id))
      .slice(0, MAX_JUDGE)

    // ⑥ AI判定 → judgements / judgement_sector_impacts / content_ja を更新
    const model = process.env.JUDGE_MODEL ?? 'claude-haiku-4-5-20251001'

    for (const stmt of unjudged) {
      try {
        const result = await judgeStatement(stmt.content_en, sectors)

        // judgements に INSERT
        const { data: judgeRow, error: jErr } = await supabase
          .from('judgements')
          .insert({
            statement_id:   stmt.id,
            model,
            prompt_version: PROMPT_VERSION,
            sentiment:      result.sentiment,
            confidence:     result.confidence,
            impact_summary: result.impact_summary,
            rationale:      result.rationale,
          })
          .select('id')
          .single()

        if (jErr || !judgeRow) {
          await supabase.from('logs').insert({
            level: 'error', context: 'ingest/judge',
            message: jErr?.message ?? 'judgement insert failed',
            meta: { statement_id: stmt.id },
          })
          stats.skipped++
          continue
        }

        // judgement_sector_impacts に INSERT（FK制約はlib/judge.tsで事前除去済み）
        if (result.sector_impacts.length > 0) {
          const { error: siErr } = await supabase
            .from('judgement_sector_impacts')
            .insert(result.sector_impacts.map(si => ({
              judgement_id: judgeRow.id,
              sector_code:  si.sector_code,
              direction:    si.direction,
              note:         si.note,
            })))
          if (siErr) {
            await supabase.from('logs').insert({
              level: 'warn', context: 'ingest/sector_impacts',
              message: siErr.message,
              meta: { judgement_id: judgeRow.id },
            })
          }
        }

        // content_ja を statements に反映（UIが参照するフィールド）
        await supabase
          .from('statements')
          .update({ content_ja: result.content_ja })
          .eq('id', stmt.id)

        stats.judged++
      } catch (e) {
        stats.skipped++
        await supabase.from('logs').insert({
          level: 'error', context: 'ingest/judge',
          message: e instanceof Error ? e.message : String(e),
          meta: { statement_id: stmt.id },
        })
      }
    }

    return NextResponse.json(stats)
  } catch (e) {
    return NextResponse.json(
      { ...stats, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
