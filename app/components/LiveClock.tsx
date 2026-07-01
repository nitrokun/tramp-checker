'use client'
import { useState, useEffect, type CSSProperties } from 'react'

// Intl の timeZone 指定で変換（手動の時差計算は DST でズレるため不使用）
function nowParts(tz: string) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const g = (t: string) => p.find(x => x.type === t)?.value ?? ''
  return {
    time: `${g('hour')}:${g('minute')}:${g('second')}`,
    weekday: g('weekday'),
    min: Number(g('hour')) * 60 + Number(g('minute')),
  }
}

// NY立会 9:30–16:00(ET)。祝日は考慮しない簡易版。週末は CLOSED。
function isNyOpen(et: { weekday: string; min: number }) {
  if (et.weekday === 'Sat' || et.weekday === 'Sun') return false
  return et.min >= 570 && et.min < 960
}

export default function LiveClock() {
  const [t, setT] = useState<{ jst: string; et: ReturnType<typeof nowParts> } | null>(null)

  useEffect(() => {
    const tick = () => setT({ jst: nowParts('Asia/Tokyo').time, et: nowParts('America/New_York') })
    tick()                                 // 初回即時
    const id = setInterval(tick, 1000)     // 毎秒更新
    return () => clearInterval(id)         // アンマウントで解除
  }, [])

  // 数字部分は等幅（tabular-nums）で毎秒の横幅ガタつきを防ぐ
  const num: CSSProperties = {
    fontVariantNumeric: 'tabular-nums', fontWeight: 800,
    fontSize: '1.15rem', color: '#1E1B16', letterSpacing: '0.01em',
  }
  const label: CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: '#5C564A' }

  // ハイドレーション不一致回避: マウント前はプレースホルダ（サーバ側で時刻を出さない）
  const clock = (jst: string, et: string) => (
    <>
      <span style={label}>🇯🇵 JST</span> <span style={num}>{jst}</span>
      <span style={{ color: '#B0A898', margin: '0 0.15rem' }}>/</span>
      <span style={label}>🇺🇸 ET</span> <span style={num}>{et}</span>
    </>
  )

  if (!t) {
    return (
      <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'baseline' }}>
        {clock('--:--:--', '--:--:--')}
      </span>
    )
  }

  const open = isNyOpen(t.et)
  return (
    <span style={{
      display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap',
      padding: '0.35rem 0.7rem', backgroundColor: '#EFE7DC',
      border: '1px solid #E3DED2', borderRadius: '2px',
    }}>
      {clock(t.jst, t.et.time)}
      <span style={{
        fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', marginLeft: '0.2rem',
        color: '#fff', backgroundColor: open ? '#557263' : '#9C4136', letterSpacing: '0.03em',
      }}>
        {open ? '● OPEN' : '● CLOSED'}
      </span>
    </span>
  )
}
