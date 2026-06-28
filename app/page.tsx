import { supabase } from '@/lib/supabase'

// ── 定数 ──────────────────────────────────────────────
const SENTIMENT = {
  positive: { label: 'ポジティブ', icon: '↑', bg: '#557263', color: '#fff' },
  negative: { label: 'ネガティブ', icon: '↓', bg: '#9C4136', color: '#fff' },
  neutral:  { label: '中立',       icon: '→', bg: '#E2D7C6', color: '#1E1B16' },
} as const

const DIRECTION = {
  positive: { icon: '↑', bg: '#557263' },
  negative: { icon: '↓', bg: '#9C4136' },
  neutral:  { icon: '→', bg: '#5C564A' },
} as const

const SOURCE_LABEL: Record<string, string> = {
  truth_social: 'Truth Social',
  speech:       '演説',
  interview:    'インタビュー',
  news_rss:     'ニュース',
}

const GRID_BG = {
  backgroundImage: [
    'linear-gradient(to right, #E3DED2 1px, transparent 1px)',
    'linear-gradient(to bottom, #E3DED2 1px, transparent 1px)',
  ].join(', '),
  backgroundSize: '56px 56px',
}

// ── 型 ────────────────────────────────────────────────
type Sentiment = keyof typeof SENTIMENT

type FeedItem = {
  id: string
  sentiment: Sentiment
  confidence: number
  impact_summary: string | null
  created_at: string
  statements: {
    id: string
    source: string
    content_ja: string | null
    stated_at: string
    source_url: string | null
  } | null
  judgement_sector_impacts: Array<{
    sector_code: string
    direction: string
    sectors: { name_ja: string } | null
  }>
}

type SectorRow = {
  code: string
  name_ja: string
  display_order: number
  judgement_sector_impacts: Array<{ direction: string }>
}

// ── ユーティリティ ────────────────────────────────────
function safeHref(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : null
  } catch { return null }
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diffMs / 60_000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (days  > 0) return `${days}日前`
  if (hours > 0) return `${hours}時間前`
  if (mins  > 0) return `${mins}分前`
  return 'たった今'
}

// ── ページ（Server Component） ───────────────────────
export default async function Home() {

  // 発言フィード（最新10件）
  const { data: rawFeed } = await supabase
    .from('judgements')
    .select(`
      id, sentiment, confidence, impact_summary, created_at,
      statements ( id, source, content_ja, stated_at, source_url ),
      judgement_sector_impacts (
        sector_code, direction,
        sectors ( name_ja )
      )
    `)
    .order('created_at', { ascending: false })
    .limit(20)

  const feed = (rawFeed ?? []) as unknown as FeedItem[]

  // 業種ヒートマップ
  const { data: rawSectors } = await supabase
    .from('sectors')
    .select('code, name_ja, display_order, judgement_sector_impacts ( direction )')
    .order('display_order')

  const sectors = (rawSectors ?? []) as unknown as SectorRow[]

  // 直近24h ローリングウィンドウ（発言数・センチメント共通）
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { count: count24h } = await supabase
    .from('statements')
    .select('id', { count: 'exact', head: true })
    .gte('stated_at', since24h)
  const { data: recentJ } = await supabase
    .from('judgements')
    .select('sentiment')
    .gte('created_at', since24h)

  const counts24h = { positive: 0, negative: 0, neutral: 0 }
  ;(recentJ ?? []).forEach((j: { sentiment: string }) => {
    counts24h[j.sentiment as Sentiment]++
  })
  const total24h = Object.values(counts24h).reduce((a, b) => a + b, 0)

  // フィードデータで補完
  const countsFeed = { positive: 0, negative: 0, neutral: 0 }
  feed.forEach(f => { countsFeed[f.sentiment]++ })
  const totalFeed = Object.values(countsFeed).reduce((a, b) => a + b, 0)

  const activeCounts = total24h > 0 ? counts24h : countsFeed
  const activeTotal  = total24h > 0 ? total24h  : totalFeed

  const [dominantKey] = Object.entries(activeCounts).sort(([, a], [, b]) => b - a)[0] ?? []
  const dominant = dominantKey ? SENTIMENT[dominantKey as Sentiment] : null
  const negRate  = activeTotal > 0
    ? Math.round((activeCounts.negative / activeTotal) * 100)
    : 0

  // ── レンダリング ───────────────────────────────────
  return (
    <main>

      {/* ① ヒーロー ─────────────────────────────── */}
      <section style={{ backgroundColor: '#F4F1EA', ...GRID_BG, overflow: 'hidden' }}>
        <div className="max-w-5xl mx-auto px-6 pt-16" style={{ paddingBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2rem' }}>

            {/* 左カラム */}
            <div style={{ flex: 1, paddingBottom: '4rem' }}>

              {/* 大型タイトル */}
              <div style={{ lineHeight: 0.88, marginBottom: '2rem' }}>
                <div style={{
                  fontSize: '5.5rem', fontWeight: 900, color: '#B4453A',
                  letterSpacing: '-0.03em', fontStyle: 'italic',
                }}>
                  TRUMP
                </div>
                <div style={{
                  fontSize: '5.5rem', fontWeight: 900, color: '#1E1B16',
                  letterSpacing: '-0.03em',
                }}>
                  CHECKER
                </div>
              </div>

              <div className="leading-none mb-4">
                <span style={{ fontSize: '6rem', fontWeight: 900, color: '#1E1B16', lineHeight: 1 }}>
                  19
                </span>
                <span style={{ fontSize: '2.25rem', fontWeight: 700, color: '#1E1B16' }}>回</span>
                <span style={{ fontSize: '1.7rem', color: '#5C564A' }}>/日</span>
              </div>

              <h1 style={{ fontSize: '2.25rem', fontWeight: 700, color: '#1E1B16', lineHeight: 1.3 }}
                className="mb-4">
                市場は、その度に動く。
              </h1>

              <p style={{ color: '#5C564A' }} className="text-base leading-relaxed mb-8 max-w-md">
                トランプ大統領の発言をAIがリアルタイムで収集・判定。
                個人投資家が一喜一憂する前に、業種別の影響を可視化します。
              </p>

              <p style={{ color: '#5C564A', fontSize: '0.8rem' }}>
                ※ Financial Times / Daily Beast 2026年調査に基づく平均値
              </p>
            </div>

            {/* 右カラム：トランプ画像（セクション下端まで伸ばす） */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/tramp_amekomi.png"
              alt="TRUMP"
              className="hidden sm:block"
              style={{
                width: '400px',
                height: 'auto',
                display: 'block',
                flexShrink: 0,
                filter: 'drop-shadow(-16px 0 32px rgba(0,0,0,0.35))',
                alignSelf: 'flex-end',
              }}
            />

          </div>
        </div>
      </section>

      {/* ② メトリクス帯 ──────────────────────────── */}
      <section style={{ backgroundColor: '#B4453A' }} className="py-8 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-3 gap-4 text-center text-white">

          <div>
            <div style={{ fontSize: '2.75rem', fontWeight: 900, lineHeight: 1 }}>
              {count24h ?? 0}
            </div>
            <div className="text-sm mt-1 tracking-wide" style={{ opacity: 0.8 }}>
              直近24h 発言数
            </div>
          </div>

          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 900 }}>
              {dominant ? `${dominant.icon} ${dominant.label}` : '---'}
            </div>
            <div className="text-sm mt-1 tracking-wide" style={{ opacity: 0.8 }}>
              {total24h > 0 ? '直近24h センチメント' : '直近センチメント'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '2.75rem', fontWeight: 900, lineHeight: 1 }}>
              {negRate}%
            </div>
            <div className="text-sm mt-1 tracking-wide" style={{ opacity: 0.8 }}>
              ネガティブ判定率
            </div>
          </div>

        </div>
      </section>

      {/* ③ 業種ヒートマップ ──────────────────────── */}
      <section style={{ backgroundColor: '#EFE7DC' }} className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 style={{ color: '#1E1B16', fontWeight: 700, fontSize: '1.25rem' }} className="mb-1">
            業種別 影響ヒートマップ
          </h2>
          <p style={{ color: '#5C564A', fontSize: '0.9rem' }} className="mb-8">
            直近の発言が各業種に与えた影響の集積（色・矢印・回数の三重表示）
          </p>

          <div className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
            {sectors.map(s => {
              const impacts = s.judgement_sector_impacts ?? []
              const pos = impacts.filter(i => i.direction === 'positive').length
              const neg = impacts.filter(i => i.direction === 'negative').length
              const net = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral'
              const bg      = net === 'positive' ? '#6B8A78' : net === 'negative' ? '#B25A4E' : '#E2D7C6'
              const color   = net === 'neutral' ? '#1E1B16' : '#ffffff'
              const arrow   = net === 'positive' ? '↑' : net === 'negative' ? '↓' : '→'
              return (
                <div key={s.code} style={{ backgroundColor: bg, color }} className="p-4">
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, opacity: 0.8 }}>
                    {arrow} ×{impacts.length}回
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 700 }} className="mt-1 leading-tight">
                    {s.name_ja}
                  </div>
                  {impacts.length > 0 && (
                    <div style={{ fontSize: '0.8rem', opacity: 0.7 }} className="mt-2">
                      ↑{pos} ↓{neg}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ④ 発言フィード ──────────────────────────── */}
      <section style={{ backgroundColor: '#1E1B16' }} className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 style={{ color: '#F4F1EA', fontWeight: 700, fontSize: '1.25rem' }} className="mb-1">
            最新 発言フィード
          </h2>
          <p style={{ color: '#B0A898', fontSize: '0.9rem' }} className="mb-8">
            AIによるリアルタイム市場影響判定
          </p>

          <div className="flex flex-col gap-4">
            {feed.length === 0 && (
              <p style={{ color: '#5C564A' }}>発言データがまだありません</p>
            )}
            {feed.map(item => {
              const s      = SENTIMENT[item.sentiment] ?? SENTIMENT.neutral
              const stmt   = Array.isArray(item.statements) ? item.statements[0] : item.statements
              const impacts = item.judgement_sector_impacts ?? []
              return (
                <div key={item.id} style={{ backgroundColor: '#2C2820' }} className="p-5">

                  {/* ヘッダー行 */}
                  <div className="flex items-center flex-wrap gap-3 mb-3">
                    <span style={{ backgroundColor: s.bg, color: s.color }}
                      className="text-sm font-bold px-3 py-1 inline-block">
                      {s.icon} {s.label}
                    </span>
                    <span style={{ color: '#B4453A', fontWeight: 700, fontSize: '1rem' }}>
                      確信度 {Math.round(item.confidence * 100)}%
                    </span>
                    {safeHref(stmt?.source_url ?? null) ? (
                      <a href={safeHref(stmt?.source_url ?? null)!} target="_blank" rel="noopener noreferrer"
                        style={{ color: '#8C8278', fontSize: '0.875rem' }} className="ml-auto">
                        {SOURCE_LABEL[stmt?.source ?? ''] ?? stmt?.source}
                        {stmt?.stated_at ? ` · ${timeAgo(stmt.stated_at)}` : ''}
                      </a>
                    ) : (
                      <span style={{ color: '#8C8278', fontSize: '0.875rem' }} className="ml-auto">
                        {SOURCE_LABEL[stmt?.source ?? ''] ?? stmt?.source}
                        {stmt?.stated_at ? ` · ${timeAgo(stmt.stated_at)}` : ''}
                      </span>
                    )}
                  </div>

                  {/* 発言要約（日本語） */}
                  <p style={{ color: '#F4F1EA', fontSize: '1rem', lineHeight: 1.75 }}
                    className="mb-3">
                    {stmt?.content_ja ?? '（日本語要約なし）'}
                  </p>

                  {/* 市場影響見立て */}
                  {item.impact_summary && (
                    <p style={{
                      color: '#C8C0B4', fontSize: '0.875rem', lineHeight: 1.6,
                      borderLeft: '2px solid #B4453A', paddingLeft: '0.75rem',
                    }} className="mb-3">
                      {item.impact_summary}
                    </p>
                  )}

                  {/* 業種チップ */}
                  {impacts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {impacts.map(imp => {
                        const dir = DIRECTION[imp.direction as keyof typeof DIRECTION] ?? DIRECTION.neutral
                        return (
                          <span key={imp.sector_code}
                            style={{ backgroundColor: dir.bg, color: '#fff', fontSize: '0.8rem' }}
                            className="px-2 py-1 font-medium">
                            {dir.icon} {imp.sectors?.name_ja ?? imp.sector_code}
                          </span>
                        )
                      })}
                    </div>
                  )}

                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ⑥ フッター（免責） ─────────────────────── */}
      <footer style={{ backgroundColor: '#1E1B16', borderTop: '1px solid #2C2820' }}
        className="py-10 px-6">
        <div className="max-w-5xl mx-auto">
          <p style={{ color: '#9C9488', fontSize: '0.8rem', lineHeight: 1.8 }}>
            本サイトは特定の金融商品の売買を推奨するものではなく、公開情報に基づく
            一般的な市況情報の提供を目的としています。投資の最終判断はご自身の責任で
            行ってください。
          </p>
          <p style={{
            color: '#9C9488', fontSize: '0.75rem', lineHeight: 1.8,
            marginTop: '1rem', borderTop: '1px solid #2C2820', paddingTop: '1rem',
          }}>
            本サービスはAIによる自動分析であり、投資助言を目的としたものではありません。
            掲載情報に基づく投資判断および損失について、当サービスは一切の責任を負いません。
            投資は自己責任でお願いします。
          </p>
          <p style={{ color: '#5C564A', fontSize: '0.8rem', marginTop: '0.75rem' }}>
            © 2026 トランプチェッカー
          </p>
        </div>
      </footer>

    </main>
  )
}
