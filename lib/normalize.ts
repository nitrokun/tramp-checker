import { createHash } from 'crypto'

/**
 * RSS本文を正規化してからDBに保存することで、
 * content_hash（PostgreSQL側 md5(content_en)）を決定論にする。
 * 同一投稿を再取得しても常に同じハッシュ → 重複登録・AI再判定課金を防ぐ。
 */
export function normalizeContent(raw: string): string {
  let s = raw
    .trim()
    // 改行統一（CR+LF / CR → LF）
    .replace(/\r\n|\r/g, '\n')
    // 行内の連続空白をシングルスペースに圧縮（改行は保持）
    .replace(/[^\S\n]+/g, ' ')
    // 3行以上連続する空行を2行に圧縮
    .replace(/\n{3,}/g, '\n\n')
    // 全角英数記号 → 半角（FF01-FF5E）
    .replace(/[！-～]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
    )
    // 末尾の短縮URL（t.co等）を除去
    .replace(/\s*https?:\/\/t\.co\/\S+\s*$/g, '')
    // 末尾の一般URLを除去
    .replace(/\s*https?:\/\/\S+\s*$/g, '')
    .trim()
  return s
}

/** Node.js の crypto で PostgreSQL md5() と同一のハッシュを生成 */
export function contentMd5(normalized: string): string {
  return createHash('md5').update(normalized, 'utf8').digest('hex')
}
