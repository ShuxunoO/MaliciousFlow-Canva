import type { Chapter } from './case'

interface ReportBlock { type: string; html?: string; caption?: string }
interface ReportChapter { id: string; title: string; lede?: string; blocks?: ReportBlock[] }
interface LocalReport { chapters: ReportChapter[]; refs?: [string, string[]][] }

export function importLocalReport(report: LocalReport): { chapters: Chapter[]; sources: [string, string[]][] } {
  const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
  const cleanText = (element: Element) => element.textContent?.trim() ?? ''
  const chapters = report.chapters.map(chapter => {
    const refs = new Set<string>()
    const paragraphs: string[] = []
    const tables: string[][][] = []
    for (const block of chapter.blocks ?? []) {
      if (block.caption) paragraphs.push(block.caption)
      if (!block.html) continue
      const parsed = parse(block.html)
      parsed.querySelectorAll('script,style').forEach(element => element.remove())
      for (const link of parsed.querySelectorAll('a[href^="#ex-"]')) refs.add(link.getAttribute('href')!.slice(4))
      for (const table of parsed.querySelectorAll('table')) {
        const rows = [...table.rows].map(row => [...row.cells].map(cleanText))
        if (rows.length) tables.push(rows)
        table.remove()
      }
      for (const paragraph of parsed.querySelectorAll('p, li, blockquote')) {
        if (cleanText(paragraph)) paragraphs.push(cleanText(paragraph))
      }
      if (block.type === 'paragraph' && !parsed.querySelector('p, li, blockquote') && cleanText(parsed.body)) paragraphs.push(cleanText(parsed.body))
    }
    return { id: chapter.id, title: chapter.title, text: cleanText(parse(chapter.lede ?? '').body), refs: [...refs], paragraphs, tables }
  })
  return { chapters, sources: report.refs ?? [] }
}
