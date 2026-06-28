export type RawStatement = {
  guid:      string
  contentEn: string
  statedAt:  Date
  sourceUrl: string
}

/** CDATA対応の簡易タグ抽出 */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${tag}>`,
    'i'
  )
  const m = xml.match(re)
  if (!m) return ''
  return (m[1] ?? m[2] ?? '').trim()
}

/** HTML エンティティをデコード */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** HTMLタグを除去 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** Truth Social の RSS フィードを取得してパース */
export async function fetchStatements(): Promise<RawStatement[]> {
  const feedUrl = process.env.RSS_FEED_URL ?? 'https://www.trumpstruth.org/feed'

  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'TrumpChecker/1.0 (contest submission)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`RSS fetch failed: HTTP ${res.status} ${feedUrl}`)

  const xml = await res.text()

  // <item>...</item> を全件抽出
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? []

  const results: RawStatement[] = []

  for (const block of itemBlocks) {
    const guid = extractTag(block, 'guid') || extractTag(block, 'link')
    if (!guid) continue

    // 本文優先順位: content:encoded > description > title
    const rawContent =
      extractTag(block, 'content:encoded') ||
      extractTag(block, 'description') ||
      extractTag(block, 'title')
    if (!rawContent) continue

    const contentEn = decodeHtml(stripHtml(rawContent))
    if (!contentEn) continue

    const pubDateStr = extractTag(block, 'pubDate')
    const statedAt   = pubDateStr ? new Date(pubDateStr) : new Date()
    if (isNaN(statedAt.getTime())) continue

    const sourceUrl = extractTag(block, 'link') || guid

    results.push({ guid, contentEn, statedAt, sourceUrl })
  }

  return results
}
