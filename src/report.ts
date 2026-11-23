import type { CaseData, Chapter, Draft, Edits, Transfer } from './case'

export interface Conclusion {
  revision: number
  text: string
  refs: string[]
  history: { revision: number; text: string; refs: string[]; publishedAt: string }[]
}

export function indexEvidence(data: CaseData) {
  const byId = new Map(data.transfers.map(event => [event.id, event]))
  const byExhibit = new Map<string, Transfer | undefined>()
  for (const event of data.transfers) {
    if (event.evidence) byExhibit.set(event.evidence, byExhibit.has(event.evidence) ? undefined : event)
  }
  return {
    get: (ref: string) => byId.get(ref) ?? byExhibit.get(ref),
    timeline: [...data.transfers].sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.id.localeCompare(b.id)),
  }
}

export function validateDraft(draft: Draft, data: CaseData, edits: Edits): Draft {
  const text = draft.text.trim()
  if (!text) throw new Error('请输入草稿内容')
  const references = indexEvidence(data)
  const objects = new Set([...data.addresses.map(item => item.id), ...edits.entities.map(item => item.id)])
  const refs = [...new Set(draft.refs.map(ref => ref.trim()).filter(Boolean))]
  for (const ref of refs) if (!references.get(ref) && !objects.has(ref)) throw new Error('找不到引用 ' + ref)
  if (draft.chapter && !data.chapters?.some(chapter => chapter.id === draft.chapter)) throw new Error('找不到目标章节')
  return { ...draft, text, refs }
}

export function conclusionFor(chapter: Chapter | undefined, edits: Edits): Conclusion {
  return (chapter && edits.conclusions?.[chapter.id]) || { revision: 0, text: chapter?.text ?? '', refs: chapter?.refs ?? [], history: [] }
}

export function publishConclusion(edits: Edits, draft: Draft, data: CaseData, expected: number, publishedAt: string) {
  const checked = validateDraft(draft, data, edits)
  const chapter = data.chapters?.find(item => item.id === checked.chapter)
  if (!chapter) throw new Error('请选择目标章节')
  const current = conclusionFor(chapter, edits)
  if (current.revision !== expected) throw new Error('报告结论已更新，请重新预览')
  edits.conclusions = Object.assign({}, edits.conclusions, {
    [chapter.id]: {
      revision: current.revision + 1,
      text: checked.text,
      refs: checked.refs,
      history: [...current.history, { revision: current.revision, text: current.text, refs: current.refs, publishedAt }],
    },
  })
}
