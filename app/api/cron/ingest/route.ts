import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchStatements } from '@/lib/sources/trumpstruth'
import { normalizeContent, contentMd5 } from '@/lib/normalize'

export const runtime    = 'nodejs'
export const maxDuration = 10

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = db()
  const stats = { fetched: 0, inserted: 0, skipped: 0 }

  const deadline = Date.now() + 7_000  // Vercel 10s 制限に対して 7s で打ち切り

  try {
    const items = await fetchStatements()
    stats.fetched = items.length

    for (const item of items) {
      if (Date.now() > deadline) break  // 残り時間不足なら次回 Cron に回す
      const normalized = normalizeContent(item.contentEn)
      if (!normalized) { stats.skipped++; continue }

      const hash = contentMd5(normalized)

      const [{ data: byHash }, { data: byGuid }] = await Promise.all([
        supabase.from('statements').select('id').eq('content_hash', hash).maybeSingle(),
        supabase.from('statements').select('id').eq('source_guid', item.guid).maybeSingle(),
      ])

      if (byHash || byGuid) { stats.skipped++; continue }

      const { error: insertErr } = await supabase.from('statements').insert({
        source:      'truth_social',
        source_url:  item.sourceUrl,
        source_guid: item.guid,
        content_en:  normalized,
        stated_at:   item.statedAt.toISOString(),
      })

      if (insertErr) {
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

    return NextResponse.json(stats)
  } catch (e) {
    return NextResponse.json(
      { ...stats, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
