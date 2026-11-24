export interface AgentWorkspaceExtensions {
  uploadAttachments(input: { caseId: string; files: File[] }): Promise<{ id: string; name: string; mediaType: string }[]>
  createSession(input: { caseId: string }): Promise<{ id: string }>
  searchSessions(input: { caseId: string; query: string }): Promise<{ id: string; title: string; updatedAt: string }[]>
}

export function enableAgentWidgetDrag(widget: HTMLElement, titlebar: HTMLElement, grip: HTMLElement,
  toggle: HTMLButtonElement, workspace: HTMLElement, stage: HTMLElement) {
  const margin = 8
  let position: { right: number; bottom: number } | undefined
  let drag: {
    surface: HTMLElement; pointer: number; startX: number; startY: number; right: number; bottom: number; moved: boolean
  } | undefined
  let suppressToggleClick = false

  function place(right: number, bottom: number) {
    position = {
      right: Math.max(margin, Math.min(right, workspace.clientWidth - widget.offsetWidth - margin)),
      bottom: Math.max(margin, Math.min(bottom, workspace.clientHeight - widget.offsetHeight - margin)),
    }
    widget.style.right = position.right + 'px'
    widget.style.bottom = position.bottom + 'px'
  }

  function currentPosition() {
    const space = workspace.getBoundingClientRect()
    const bounds = widget.getBoundingClientRect()
    return { right: space.right - bounds.right, bottom: space.bottom - bounds.bottom }
  }

  function dock() {
    const space = workspace.getBoundingClientRect()
    const graph = stage.getBoundingClientRect()
    const right = Math.min(space.right - graph.right + 16, space.width - widget.offsetWidth - margin)
    widget.style.right = Math.max(margin, right) + 'px'
  }

  for (const surface of [titlebar, toggle]) {
    surface.onpointerdown = event => {
      if (event.button !== 0 || drag || (surface === titlebar && (event.target as Element).closest('button'))) return
      if (surface === toggle) suppressToggleClick = false
      drag = {
        surface, pointer: event.pointerId, startX: event.clientX, startY: event.clientY,
        ...currentPosition(), moved: false,
      }
      surface.setPointerCapture(event.pointerId)
      if (surface === titlebar) event.preventDefault()
    }
    surface.onpointermove = event => {
      if (drag?.pointer !== event.pointerId || drag.surface !== surface) return
      const horizontal = event.clientX - drag.startX
      const vertical = event.clientY - drag.startY
      if (!drag.moved && Math.hypot(horizontal, vertical) < 5) return
      drag.moved = true
      widget.classList.add('dragging')
      place(drag.right - horizontal, drag.bottom - vertical)
    }
    const finish = (event: PointerEvent) => {
      if (drag?.pointer !== event.pointerId || drag.surface !== surface) return
      if (surface === toggle) suppressToggleClick = drag.moved
      drag = undefined
      widget.classList.remove('dragging')
      if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
    }
    surface.onpointerup = surface.onpointercancel = surface.onlostpointercapture = finish
  }

  toggle.addEventListener('click', event => {
    if (!suppressToggleClick || event.detail === 0) return
    suppressToggleClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)

  const arrows = new Map([['ArrowLeft', [16, 0]], ['ArrowRight', [-16, 0]], ['ArrowUp', [0, 16]], ['ArrowDown', [0, -16]]])
  grip.onkeydown = toggle.onkeydown = event => {
    const step = arrows.get(event.key)
    if (!step) return
    event.preventDefault()
    const current = currentPosition()
    place(current.right + step[0], current.bottom + step[1])
  }

  const observer = new ResizeObserver(() => {
    if (!widget.offsetWidth || !workspace.clientWidth) return
    if (position) place(position.right, position.bottom)
    else dock()
  })
  observer.observe(workspace)
  observer.observe(stage)
  observer.observe(widget)
}
