import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { judgeStatement, PROMPT_VERSION } from '@/lib/judge'

export const runtime    = 'nodejs'
export const maxDuration = 10

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Hobby 10s 制限内に収めるため default 3件。増やしたければ環境変数で上書き
const MAX_JUDGE = Number(process.env.MAX_JUDGE_PER_RUN ?? '3')

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = db()
  const stats = { judged: 0, skipped: 0 }

  try {
    // 業種マスタをDBから動的取得
    const { data: sectors, error: sectorsErr } = await supabase
      .from('sectors')
      .select('code, name_ja')
      .order('display_order')

    if (sectorsErr || !sectors?.length) {
      return NextResponse.json({ ...stats, error: 'sectors master empty' }, { status: 500 })
    }

    // 判定済み statement_id を取得して除外リストを作成
    const { data: judgedRows } = await supabase
      .from('judgements')
      .select('statement_id')
      .limit(5000)

    const judgedIds = new Set((judgedRows ?? []).map(r => r.statement_id))

    // 未判定のstatementを新しい順に取得
    const { data: recentStmts } = await supabase
      .from('statements')
      .select('id, content_en')
      .order('stated_at', { ascending: false })
      .limit(MAX_JUDGE * 3)

    const unjudged = (recentStmts ?? [])
      .filter(s => !judgedIds.has(s.id))
      .slice(0, MAX_JUDGE)

    const model = process.env.JUDGE_MODEL ?? 'claude-haiku-4-5-20251001'

    for (const stmt of unjudged) {
      try {
        const result = await judgeStatement(stmt.content_en, sectors)

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
            level: 'error', context: 'judge/insert',
            message: jErr?.message ?? 'judgement insert failed',
            meta: { statement_id: stmt.id },
          })
          stats.skipped++
          continue
        }

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
              level: 'warn', context: 'judge/sector_impacts',
              message: siErr.message,
              meta: { judgement_id: judgeRow.id },
            })
          }
        }

        await supabase
          .from('statements')
          .update({ content_ja: result.content_ja })
          .eq('id', stmt.id)

        stats.judged++
      } catch (e) {
        stats.skipped++
        await supabase.from('logs').insert({
          level: 'error', context: 'judge/ai',
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
