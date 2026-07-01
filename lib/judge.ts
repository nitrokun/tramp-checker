import Anthropic from '@anthropic-ai/sdk'

export const PROMPT_VERSION = 'v2'

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
      content: `あなたは米国市場を主に分析し、その日本株への波及を評価するアナリストです。以下のトランプ大統領の発言について、二段階で影響を評価し、JSONのみを返してください（説明文不要）。

## 分析手順（必ずこの順序で推論すること）
1. まず発言が「米国市場・米国セクター」に与える直接的な影響を評価する。
2. 次にその影響が「ドル円（為替）」と「米国景気」を経由して、日本株にどう波及するかを評価する。
3. 波及が乏しい場合は無理に影響を作らず、「日本への波及は限定的」と明示してよい。

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
    { "sector_code": "（上記マスタの code のみ）", "direction": "positive | negative | neutral", "note": "米国セクターへの影響・30字以内・事実ベース" }
  ],
  "impact_summary": "冒頭に『ドル円: 円安/円高/中立 ・ 日本株波及: 強い/中/限定的』を必ず記し、続けて波及見立てを述べる（120字以内）",
  "rationale":      "米国市場→ドル円・米国景気→日本株、という二段階推論の根拠（150字以内・事実ベース・中立）"
}

## 各フィールドの視点（重要）
- sector_impacts.direction … 手順1で評価した「米国セクター」への影響方向（日本株ではなく米国側）
- sentiment            … 手順2で評価した「日本株全体」への波及方向
- impact_summary       … ドル円方向と日本株波及度を冒頭に明記したうえでの波及見立て

## 制約
- sentiment / direction は positive / negative / neutral の3値のみ
- confidence は 0.00〜1.00
- sector_impacts は影響が明確な米国セクターのみ（最大5件）。無関係なら []
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
