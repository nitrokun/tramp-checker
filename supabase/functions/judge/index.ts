import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'

const PROMPT_VERSION = 'v1'
const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral'])
const VALID_DIRECTIONS  = new Set(['positive', 'negative', 'neutral'])

type SectorMaster = { code: string; name_ja: string }

type JudgementResult = {
  content_ja:     string
  sentiment:      'positive' | 'negative' | 'neutral'
  confidence:     number
  sector_impacts: Array<{
    sector_code: string
    direction:   'positive' | 'negative' | 'neutral'
    note:        string
  }>
  impact_summary: string
  rationale:      string
}

async function judgeStatement(
  contentEn: string,
  sectors:   SectorMaster[],
  model:     string,
): Promise<JudgementResult> {
  const sectorList = sectors
    .map(s => `  - code: "${s.code}"  name: "${s.name_ja}"`)
    .join('\n')

  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    temperature: 0,
    messages: [{
      role: 'user',
      content: `あなたは市場影響アナリストです。以下のトランプ大統領の発言を分析し、JSONのみを返してください（説明文不要）。

## 発言（英語）
${contentEn}

## 業種マスタ（sector_code は必ずこのリストの code 列から選択。リスト外の生成禁止）
${sectorList}

## 出力形式（JSON のみ）
{
  "content_ja":     "発言の日本語要約（80字以内・中立トーン）",
  "sentiment":      "positive | negative | neutral",
  "confidence":     0.00,
  "sector_impacts": [
    { "sector_code": "（上記マスタの code のみ）", "direction": "positive | negative | neutral", "note": "30字以内・事実ベース" }
  ],
  "impact_summary": "日本株・ドル円への波及見立て（100字以内）",
  "rationale":      "判定根拠（150字以内・事実ベース・中立）"
}

## 制約
- sentiment / direction は positive / negative / neutral の3値のみ
- confidence は 0.00〜1.00
- sector_impacts は影響が明確な業種のみ（最大5件）。市場と無関係なら []
- sector_code はマスタの code 値のみ。自由生成・新造禁止
- 「買い」「売り」「推奨」等の売買指示表現禁止
- 個別銘柄名の出力禁止`,
    }],
  })

  const raw   = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`AI response has no JSON: ${raw.slice(0, 200)}`)

  const parsed = JSON.parse(match[0]) as JudgementResult

  if (!VALID_SENTIMENTS.has(parsed.sentiment)) {
    throw new Error(`Invalid sentiment: ${parsed.sentiment}`)
  }
  parsed.confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0))

  const validCodes = new Set(sectors.map(s => s.code))
  parsed.sector_impacts = (parsed.sector_impacts ?? [])
    .filter(i =>
      typeof i.sector_code === 'string' &&
      validCodes.has(i.sector_code) &&
      VALID_DIRECTIONS.has(i.direction),
    )
    .slice(0, 5)

  return parsed
}

// ── エントリーポイント ──────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  // 認証
  const auth       = req.headers.get('authorization') ?? ''
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')              ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const stats = { judged: 0, skipped: 0 }
  const MAX_JUDGE = Number(Deno.env.get('MAX_JUDGE_PER_RUN') ?? '10')
  const model     = Deno.env.get('JUDGE_MODEL') ?? 'claude-haiku-4-5-20251001'

  try {
    // 業種マスタ（DBから動的取得・ハードコード禁止）
    const { data: sectors, error: sectorsErr } = await supabase
      .from('sectors')
      .select('code, name_ja')
      .order('display_order')

    if (sectorsErr || !sectors?.length) {
      return json({ ...stats, error: 'sectors master empty' }, 500)
    }

    // 判定済み statement_id を取得して除外
    const { data: judgedRows } = await supabase
      .from('judgements')
      .select('statement_id')
      .limit(5000)

    const judgedIds = new Set((judgedRows ?? []).map((r: { statement_id: string }) => r.statement_id))

    // 未判定の statement を新しい順に取得
    const { data: recentStmts } = await supabase
      .from('statements')
      .select('id, content_en')
      .order('stated_at', { ascending: false })
      .limit(MAX_JUDGE * 3)

    const unjudged = (recentStmts ?? [])
      .filter((s: { id: string }) => !judgedIds.has(s.id))
      .slice(0, MAX_JUDGE)

    for (const stmt of unjudged as Array<{ id: string; content_en: string }>) {
      try {
        const result = await judgeStatement(stmt.content_en, sectors, model)

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

    return json(stats)
  } catch (e) {
    return json(
      { ...stats, error: e instanceof Error ? e.message : String(e) },
      500,
    )
  }
})
