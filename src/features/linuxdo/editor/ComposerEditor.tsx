import {
  Bold,
  Code2,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, type KeyboardEvent, type ReactNode } from 'react'

import {
  applyComposerCommand,
  insertComposerBlock,
  insertComposerSnippet,
  insertComposerText,
  type ComposerCommand,
  type ComposerEdit,
  type ComposerSelection,
  type ComposerSnippetContext,
  type ComposerSnippetKind,
} from './model'
import { renderLinuxDoComposerPreview } from './preview'

export interface ComposerEditorHandle {
  insertText: (text: string) => void
  insertBlock: (text: string) => void
  insertSnippet: (kind: ComposerSnippetKind, context?: ComposerSnippetContext) => void
  selection: () => ComposerSelection
  focus: () => void
}

interface ComposerEditorProps {
  value: string
  onChange: (value: string) => void
  preview: boolean
  onPreviewChange: (preview: boolean) => void
  placeholder: string
  uploading: boolean
  uploadLabel: string
  onUpload: () => void
  onOpenInsert: () => void
  onOpenTemplate: () => void
  footer?: ReactNode
}

const TOOLBAR: Array<{ command: ComposerCommand; label: string; icon: typeof Bold }> = [
  { command: 'heading', label: '标题', icon: Heading2 },
  { command: 'bold', label: '粗体', icon: Bold },
  { command: 'italic', label: '斜体', icon: Italic },
  { command: 'strike', label: '删除线', icon: Strikethrough },
  { command: 'link', label: '链接', icon: Link2 },
  { command: 'quote', label: '引用', icon: Quote },
  { command: 'code', label: '行内代码', icon: Code2 },
  { command: 'bullet-list', label: '无序列表', icon: List },
  { command: 'ordered-list', label: '有序列表', icon: ListOrdered },
]

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor({
  value,
  onChange,
  preview,
  onPreviewChange,
  placeholder,
  uploading,
  uploadLabel,
  onUpload,
  onOpenInsert,
  onOpenTemplate,
  footer,
}, forwardedRef) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectionRef = useRef<ComposerSelection>({ start: value.length, end: value.length })
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const lastInputAtRef = useRef(0)

  const selection = () => {
    const textarea = textareaRef.current
    if (textarea) return { start: textarea.selectionStart, end: textarea.selectionEnd }
    return selectionRef.current
  }

  const restoreSelection = (next: ComposerSelection) => {
    selectionRef.current = next
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.start, next.end)
    })
  }

  const commit = (edit: ComposerEdit, record = true) => {
    if (record && edit.value !== value) {
      undoRef.current = [...undoRef.current.slice(-49), value]
      redoRef.current = []
    }
    onChange(edit.value)
    if (preview) onPreviewChange(false)
    restoreSelection(edit.selection)
  }

  useImperativeHandle(forwardedRef, () => ({
    insertText: (text) => commit(insertComposerText(value, selection(), text)),
    insertBlock: (text) => commit(insertComposerBlock(value, selection(), text)),
    insertSnippet: (kind, context) => commit(insertComposerSnippet(value, selection(), kind, context)),
    selection,
    focus: () => textareaRef.current?.focus(),
  }))

  const apply = (command: ComposerCommand) => commit(applyComposerCommand(value, selection(), command))
  const undo = () => {
    const previous = undoRef.current.at(-1)
    if (previous === undefined) return
    undoRef.current = undoRef.current.slice(0, -1)
    redoRef.current = [...redoRef.current.slice(-49), value]
    commit({ value: previous, selection: { start: previous.length, end: previous.length } }, false)
  }
  const redo = () => {
    const next = redoRef.current.at(-1)
    if (next === undefined) return
    redoRef.current = redoRef.current.slice(0, -1)
    undoRef.current = [...undoRef.current.slice(-49), value]
    commit({ value: next, selection: { start: next.length, end: next.length } }, false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (event.shiftKey && key === 'i') {
      event.preventDefault()
      onOpenTemplate()
      return
    }
    if (key === 'b' || key === 'i' || key === 'k') {
      event.preventDefault()
      apply(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'link')
    }
  }

  return (
    <section className="linuxdo-composer-editor flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-haze bg-ink">
      <div className="linuxdo-composer-toolbar flex shrink-0 items-center border-b border-haze/60 px-1.5">
        <div className="linuxdo-composer-toolbar-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5">
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={undo} disabled={!undoRef.current.length} className="linuxdo-composer-tool" aria-label="撤销" title="撤销"><Undo2 size={16} /></button>
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={redo} disabled={!redoRef.current.length} className="linuxdo-composer-tool" aria-label="重做" title="重做"><Redo2 size={16} /></button>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-haze/70" aria-hidden />
          {TOOLBAR.map((item) => {
            const Icon = item.icon
            return <button key={item.command} type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => apply(item.command)} className="linuxdo-composer-tool" aria-label={item.label} title={item.label}><Icon size={16} /></button>
          })}
        </div>
        <span className="mx-1 h-6 w-px shrink-0 bg-haze/70" aria-hidden />
        <div className="flex shrink-0 items-center gap-1 py-1.5">
          <button type="button" onClick={onUpload} disabled={uploading} className="linuxdo-composer-tool" aria-label={uploadLabel} title={uploadLabel}><ImagePlus size={16} /></button>
          <button type="button" onClick={onOpenInsert} className="linuxdo-composer-tool is-accent" aria-label="更多插入功能" title="更多插入功能"><Plus size={17} /></button>
        </div>
      </div>

      <div className="relative min-h-[240px] flex-1">
        {preview ? (
          value.trim() ? (
            <article className="reader-prose linuxdo-post-prose linuxdo-composer-preview absolute inset-0 overflow-y-auto px-4 py-4 text-paper" dangerouslySetInnerHTML={{ __html: renderLinuxDoComposerPreview(value) }} />
          ) : (
            <div className="absolute inset-0 grid place-items-center px-8 text-center text-[12px] text-paper-faint"><span><Eye size={21} className="mx-auto mb-2 opacity-60" />输入正文后可在这里检查排版</span></div>
          )
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              const now = Date.now()
              if (now - lastInputAtRef.current > 700) {
                undoRef.current = [...undoRef.current.slice(-49), value]
                redoRef.current = []
              }
              lastInputAtRef.current = now
              selectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }
              onChange(event.target.value)
            }}
            onSelect={(event) => { selectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd } }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="absolute inset-0 h-full w-full resize-none bg-transparent px-4 py-4 font-body text-[14px] leading-7 text-paper outline-none placeholder:text-paper-faint"
          />
        )}
      </div>

      <footer className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t border-haze/60 px-3 py-1.5">
        <div className="flex items-center rounded-full bg-paper/5 p-0.5">
          <button type="button" onClick={() => onPreviewChange(false)} className={'linuxdo-control rounded-full px-3 py-1.5 text-[10.5px] transition-colors ' + (!preview ? 'bg-cinnabar text-white' : 'text-paper-muted')}>编辑</button>
          <button type="button" onClick={() => onPreviewChange(true)} className={'linuxdo-control inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[10.5px] transition-colors ' + (preview ? 'bg-cinnabar text-white' : 'text-paper-muted')}><Eye size={12} />预览</button>
        </div>
        {footer}
      </footer>
    </section>
  )
})
