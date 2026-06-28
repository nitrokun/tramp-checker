import Anthropic from '@anthropic-ai/sdk'

export const PROMPT_VERSION = 'v1'

type SectorMaster = { code: string; name_ja: string }

export type JudgementResult = {
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

const VALID_SENTIMENTS  = new Set(['positive', 'negative', 'neutral'])
const VALID_DIRECTIONS  = new Set(['positive', 'negative', 'neutral'])

/**
 * Anthropic API でトランプ発言を判定する。
 * - temperature:0 で厳密JSON出力
 * - 業種コードはDBマスタから動的に渡し、LLMの自由生成を禁止
 * - FK 違反コード・無効direction は除去（停止させない）
 */
export async function judgeStatement(
  contentEn: string,
  sectors:   SectorMaster[]
): Promise<JudgementResult> {
  const model = process.env.JUDGE_MODEL ?? 'claude-haiku-4-5-20251001'
  const sectorList = sectors
    .map(s => `  - code: "${s.code}"  name: "${s.name_ja}"`)
    .join('\n')

  const client = new Anthropic()

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

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`AI response has no JSON: ${raw.slice(0, 200)}`)

  const parsed = JSON.parse(match[0]) as JudgementResult

  // sentiment バリデーション
  if (!VALID_SENTIMENTS.has(parsed.sentiment)) {
    throw new Error(`Invalid sentiment: ${parsed.sentiment}`)
  }

  // confidence 正規化
  parsed.confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0))

  // sector_impacts: FK違反 & 無効direction を除去（停止させない）
  const validCodes = new Set(sectors.map(s => s.code))
  parsed.sector_impacts = (parsed.sector_impacts ?? []).filter(i =>
    typeof i.sector_code === 'string' &&
    validCodes.has(i.sector_code) &&
    VALID_DIRECTIONS.has(i.direction)
  ).slice(0, 5)

  return parsed
}
