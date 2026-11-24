import { BaseEdge, CanvasEvent, EdgeEvent, ExtensionCategory, Graph, NodeEvent, Rect, register } from '@antv/g6'
import type { BaseEdgeStyleProps, GraphData, RectStyleProps } from '@antv/g6'
import { flattenPath } from './geometry'
import { compactQuantity, type NodeAsset } from './node-summary'
import type { Edits, FlowView, Point } from './case'
import { NODE_HEIGHT, NODE_WIDTH, type Drawing, type Route } from './layout'
import { addressAccent, addressIcon } from './address-icons'

const rendered = new WeakMap<Graph, Map<string, BaseFlowNode | TransactionEdge>>()

function remember(graph: Graph, element: BaseFlowNode | TransactionEdge) {
  if (!import.meta.env.DEV) return
  const elements = rendered.get(graph) ?? new Map()
  elements.set(element.id, element)
  rendered.set(graph, elements)
}

interface FlowNodeStyle extends RectStyleProps {
  title: string
  address: string
  roleName: string
  roleImage?: string
  note: string
  figures: string[]
  accent: string
  collapsedIn: boolean
  collapsedOut: boolean
}

export class BaseFlowNode extends Rect {
  render(...args: Parameters<Rect['render']>) {
    super.render(...args)
    remember(this.context.graph, this)
  }

  protected drawLabelShape(attributes: Required<FlowNodeStyle>, container: NonNullable<Parameters<Rect['render']>[1]>) {
    const { title, address, roleName, roleImage, note, figures, accent, collapsedIn, collapsedOut } = attributes
    const text = (key: string, value: string, x: number, y: number, fill: string, fontSize = 10, more = {}) =>
      this.upsert(key, 'text', { x, y, text: value, fill, fontFamily: 'Inter, sans-serif',
        fontSize, textBaseline: 'middle', pointerEvents: 'none', ...more }, container)
    this.upsert('role-icon', 'rect', { x: -101, y: -35, width: 25, height: 25, radius: 6,
      fill: accent, opacity: roleImage ? .35 : .9, pointerEvents: 'none' }, container)
    this.upsert('role-image', 'image', roleImage ? {
      src: roleImage, x: -98.5, y: -32.5, width: 20, height: 20, pointerEvents: 'none',
    } : false, container)
    if (!roleImage) text('role-glyph', this.glyph, -88.5, -22.5, '#10151e', 14, { textAlign: 'center', fontWeight: 700 })
    text('title', title, -69, -24, '#edf2ff', 15, { fontWeight: 650 })
    text('role', roleName, -69, -9, '#b4c0da', 10)
    text('address', address, -101, 35, '#b1bfdb', 11, { fontFamily: 'monospace' })
    text('note', note, -101, 12, '#edcf9a', 9)
    this.upsert('figure-panel', 'rect', { x: 34, y: -13, width: 69, height: 39, radius: 4,
      fill: '#0b1320', opacity: .48, pointerEvents: 'none' }, container)
    figures.forEach((figure, index) => text('figure-' + index, figure, 39, -4 + index * 11, '#e0eaff', 9))
    for (const [direction, x, collapsed] of [['in', -NODE_WIDTH / 2, collapsedIn], ['out', NODE_WIDTH / 2, collapsedOut]] as const) {
      this.upsert('branch-' + direction, 'circle', { cx: x, cy: 0, r: 8, fill: '#171e2c',
        stroke: accent, lineWidth: 1, cursor: 'pointer' }, container)
      text('branch-sign-' + direction, collapsed ? '+' : '−', x, 0, '#eef3ff', 10, { textAlign: 'center' })
    }
  }

  protected glyph = '◇'
}
class AddressNode extends BaseFlowNode {}
class EntityNode extends BaseFlowNode { protected glyph = '≋' }

interface FlowStyle extends BaseEdgeStyleProps { route: Route }

class TransactionEdge extends BaseEdge {
  render(...args: Parameters<BaseEdge['render']>) {
    super.render(...args)
    remember(this.context.graph, this)
  }

  protected getKeyPath(attributes: Required<FlowStyle>) {
    return attributes.route.path
  }

  protected getLabelStyle(attributes: Required<FlowStyle>) {
    const style = super.getLabelStyle(attributes)
    if (!style) return false
    const [x, y] = attributes.route.label
    return { ...style, x, y, transform: [], textAlign: 'center' as const, textBaseline: 'middle' as const }
  }
}

register(ExtensionCategory.NODE, 'flow-address', AddressNode)
register(ExtensionCategory.NODE, 'flow-entity', EntityNode)
register(ExtensionCategory.EDGE, 'transaction-path', TransactionEdge)

export function renderedSnapshot(graph: Graph, view: FlowView, name: string) {
  const elements = rendered.get(graph)
  if (!elements) throw new Error('No rendered snapshot available')
  const boxFor = (id: string, key: string) => {
    const shape = elements.get(id)?.getShape(key)
    if (!shape) return
    const { min, max } = shape.getBounds()
    return [min[0], min[1], max[0] - min[0], max[1] - min[1]]
  }
  return {
    geometry: 'rendered', view: name, tolerance: .5,
    nodes: view.nodes.map(node => ({ id: node.id, box: boxFor(node.id, 'key'),
      hasIcon: !!elements.get(node.id)?.getShape('role-image') })),
    edges: view.edges.map(edge => {
      const key = elements.get(edge.id)?.getShape('key')
      if (!key) throw new Error('Transaction edge was not rendered ' + edge.id)
      const path = key.attributes.d as Route['path']
      const points = flattenPath(path)
      return { id: edge.id, source: edge.source, target: edge.target, points,
        data: { amount: edge.amount, asset: edge.asset, events: edge.events.map(item => [item.id, item.rawAmount, item.evidence]) } }
    }),
    labels: view.edges.flatMap(edge => {
      const box = boxFor(edge.id, 'label')
      return box ? [{ id: 'label:' + edge.id, edge: edge.id, box }] : []
    }),
  }
}

export type Selection = { type: 'node' | 'edge'; id: string }

export function makeGraph(container: HTMLElement, select: (item?: Selection) => void,
  move: (id: string, point: Point) => void, selected: () => Selection | undefined,
  toggleBranch: (id: string, direction: 'in' | 'out') => void) {
  const graph = new Graph({
    container, padding: 56, animation: false, zoomRange: [0.008, 3],
    behaviors: [
      'drag-canvas', 'zoom-canvas',
      { type: 'drag-element', key: 'move', enable: (event: { targetType: string; target: { id: string } }) =>
        event.targetType === 'node' && selected()?.id === event.target.id },
    ],
    node: { state: { selected: { stroke: '#6bf1cc', lineWidth: 3 } } },
    edge: { state: { selected: { stroke: '#f4cb7e', endArrowFill: '#f4cb7e', lineWidth: 3 } } },
  })
  graph.on(NodeEvent.CLICK, event => {
    if (!('target' in event && event.target && 'id' in event.target)) return
    const id = String(event.target.id)
    const shape = 'originalTarget' in event ? event.originalTarget.className : ''
    if (shape === 'branch-in' || shape === 'branch-out') {
      toggleBranch(id, shape === 'branch-in' ? 'in' : 'out')
    } else {
      select({ type: 'node', id })
    }
  })
  graph.on(EdgeEvent.CLICK, event => { if ('target' in event && event.target && 'id' in event.target) select({ type: 'edge', id: String(event.target.id) }) })
  graph.on(CanvasEvent.CLICK, () => select())
  graph.on(NodeEvent.DRAG_END, event => {
    if (!('target' in event && event.target && 'id' in event.target) || selected()?.id !== event.target.id) return
    const [x, y] = graph.getElementPosition(String(event.target.id))
    move(String(event.target.id), [x, y])
  })
  return graph
}

function cardFill(accent: string): string {
  const tint = [1, 3, 5].map((index, channel) =>
    Math.round(Number.parseInt(accent.slice(index, index + 2), 16) * .18 + [21, 28, 43][channel] * .82))
  return `rgb(${tint.join(',')})`
}

function truncate(text: string, length: number) {
  const chars = Array.from(text)
  return chars.length > length ? chars.slice(0, length - 1).join('') + '…' : text
}

export type EdgeLabels = 'auto' | 'on' | 'off'

export function graphData(view: FlowView, drawing: Drawing, edits: Edits, assets: Map<string, NodeAsset[]>,
  hidden: Set<string>, selected?: Selection, labels: EdgeLabels = 'auto'): GraphData {
  const showAllLabels = labels === 'on' || labels === 'auto' && view.edges.length < 190
  return {
    nodes: view.nodes.map(node => {
      const [x, y] = drawing.positions[node.id]
      const asset = assets.get(node.id)?.[0]
      const figures = asset ? [
        'In ' + compactQuantity(asset.incoming),
        'Out ' + compactQuantity(asset.outgoing),
        asset.balances.length ? compactQuantity(asset.balances) + (asset.prices.length ? ' / $' + compactQuantity(asset.prices) : '') : 'Bal –',
      ] : ['In –', 'Out –', 'Bal –']
      const accent = addressAccent(node.color)
      const short = node.address.length > 24 ? node.address.slice(0, 12) + '…' + node.address.slice(-7) : node.address
      const note = edits.notes[node.id] ?? ''
      return {
        id: node.id, type: node.members ? 'flow-entity' : 'flow-address', states: selected?.id === node.id ? ['selected'] : [],
        style: {
          x, y, size: [NODE_WIDTH, NODE_HEIGHT], radius: 10,
          fill: cardFill(accent), stroke: accent, strokeOpacity: .64, lineWidth: 1.4,
          title: truncate(node.name, 19), address: short,
          roleImage: addressIcon(node),
          roleName: truncate([node.role ?? 'Address', asset?.symbol].filter(Boolean).join(' · '), 26),
          note: note ? truncate(note, 22) : '', figures: figures.map(item => truncate(item, 14)), accent,
          collapsedIn: hidden.has(node.id + ':in'), collapsedOut: hidden.has(node.id + ':out'), cursor: 'grab',
        },
      }
    }),
    edges: view.edges.map(edge => {
      const route = drawing.routes[edge.id]
      const first = edge.events[0]
      const last = edge.events.at(-1)
      const time = first ? first.time.slice(0, first === last ? 19 : 10).replace('T', ' ') : ''
      const period = first !== last && last ? time + ' → ' + last.time.slice(0, 10) : time
      const color = edge.asset === 'ETH' ? '#76a6f8' : edge.events.length ? '#66cbb6' : '#baba83'
      return {
        id: edge.id, type: 'transaction-path', source: edge.source, target: edge.target, states: selected?.id === edge.id ? ['selected'] : [],
        style: {
          route, loop: false, stroke: color, lineWidth: 1.55, increasedLineWidthForHitTesting: 9,
          lineDash: edge.events.length ? undefined : [6, 5], endArrow: true, endArrowType: 'triangle',
          endArrowFill: color, endArrowSize: 10, cursor: 'pointer', labelAutoRotate: false,
          labelText: (showAllLabels && drawing.labels.has(edge.id)) || (labels !== 'off' && selected?.id === edge.id)
            ? (first ? [period + ' UTC', edge.amount + ' ' + edge.asset,
              ...(edge.events.length > 1 ? [edge.events.length + ' transfers'] : [])].join('  ·  ') : edits.notes[edge.id] ?? edge.note)
              + (edge.events.length && edits.notes[edge.id] ? '  ·  ' + truncate(edits.notes[edge.id], 24) : '')
            : undefined,
          labelFontSize: 10, labelFill: '#d7e5ef', labelBackground: true, labelBackgroundFill: '#111d26',
          labelPadding: [3, 4], labelBackgroundRadius: 3,
        },
      }
    }),
  }
}
