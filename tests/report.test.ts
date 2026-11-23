import { describe, expect, it } from 'vitest'
import { emptyEdits } from '../src/case'
import { demo } from '../src/demo'
import { conclusionFor, indexEvidence, publishConclusion, validateDraft } from '../src/report'

describe('report evidence and conclusions', () => {
  it('resolves evidence IDs and falls back to the event ID for CSV-only entries', () => {
    const csv = { ...demo.transfers[0], id: 'csv-1', evidence: undefined, sources: ['case-csv'] }
    const data = { ...demo, transfers: [demo.transfers[2], csv, demo.transfers[0]] }
    const index = indexEvidence(data)
    expect(index.get('D-1')).toBe(demo.transfers[0])
    expect(index.get('csv-1')).toBe(csv)
    expect(index.timeline.map(item => item.id)).toEqual(['csv-1', 'demo-0', 'demo-2'])
  })

  it('validates and deduplicates citations before saving a draft', () => {
    const draft = { id: 'draft', text: '  调查草稿 ', chapter: 'entry', refs: ['D-1', ' D-1 ', 'origin'] }
    expect(validateDraft(draft, demo, emptyEdits())).toMatchObject({ text: '调查草稿', refs: ['D-1', 'origin'] })
    expect(() => validateDraft({ ...draft, refs: ['wrong'] }, demo, emptyEdits())).toThrow('找不到引用')
  })

  it('replaces the confirmed conclusion, retains the previous version and rejects stale confirmations', () => {
    const edits = emptyEdits()
    const chapter = demo.chapters![0]
    const draft = { id: 'draft', text: '新结论', chapter: chapter.id, refs: ['D-1'] }
    const at = '2026-11-23T12:00:00Z'
    publishConclusion(edits, draft, demo, 0, at)
    expect(conclusionFor(chapter, edits)).toEqual({
      revision: 1, text: '新结论', refs: ['D-1'],
      history: [{ revision: 0, text: chapter.text, refs: chapter.refs, publishedAt: at }],
    })
    expect(() => publishConclusion(edits, draft, demo, 0, at)).toThrow('重新预览')
    expect(demo.chapters![0].text).toEqual(chapter.text)
  })
})
