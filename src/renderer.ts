import { BaseEdge, CanvasEvent, EdgeEvent, ExtensionCategory, Graph, NodeEvent, Rect, register } from '@antv/g6'
import type { BaseEdgeStyleProps, GraphData, RectStyleProps } from '@antv/g6'
import { flattenPath } from './geometry'
import { SUMMARY_WIDTH, SUMMARY_HEIGHT, transactionSummary, type SummaryPosition } from './transaction-summaries'
import { compactQuantity, type NodeAsset } from './node-summary'
import type { Edits, FlowEdge, FlowNode, FlowView, Point } from './case'
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
  muted: boolean
}

export class BaseFlowNode extends Rect {
  render(...args: Parameters<Rect['render']>) {
    super.render(...args)
    remember(this.context.graph, this)
  }

  protected drawLabelShape(attributes: Required<FlowNodeStyle>, container: NonNullable<Parameters<Rect['render']>[1]>) {
    const { title, address, roleName, roleImage, note, figures, accent, collapsedIn, collapsedOut, muted } = attributes
    const opacity = muted ? .3 : 1
    const text = (key: string, value: string, x: number, y: number, fill: string, fontSize = 10, more = {}) =>
      this.upsert(key, 'text', { x, y, text: value, fill, fontFamily: 'Inter, sans-serif',
        fontSize, opacity, textBaseline: 'middle', pointerEvents: 'none', ...more }, container)
    const left = -NODE_WIDTH / 2 + 14
    this.upsert('role-icon', 'rect', { x: left, y: -49, width: 26, height: 26, radius: 6,
      fill: accent, opacity: opacity * (roleImage ? .35 : .9), pointerEvents: 'none' }, container)
    this.upsert('role-image', 'image', roleImage ? {
      src: roleImage, x: left + 3, y: -46, width: 20, height: 20, opacity, pointerEvents: 'none',
    } : false, container)
    if (!roleImage) text('role-glyph', this.glyph, left + 13, -36, '#10151e', 14, { textAlign: 'center', fontWeight: 700 })
    text('title', title, left + 35, -43, '#edf2ff', 15, { fontWeight: 650, wordWrap: true, wordWrapWidth: 198, maxLines: 1, textOverflow: 'ellipsis' })
    text('role', roleName, left + 35, -25, '#b4c0da', 10, { wordWrap: true, wordWrapWidth: 198, maxLines: 1, textOverflow: 'ellipsis' })
    text('note', note, left, -8, '#edcf9a', 11, {
      textBaseline: 'top', wordWrap: true, wordWrapWidth: 166, maxLines: 3, lineHeight: 13, textOverflow: 'ellipsis',
    })
    this.upsert('figure-panel', 'rect', { x: 32, y: -13, width: 114, height: 43, radius: 5,
      fill: '#0b1320', opacity: .72 * opacity, pointerEvents: 'none' }, container)
    figures.forEach((figure, index) => text('figure-' + index, figure, 39, -3 + index * 12, '#e0eaff', 10, {
      wordWrap: true, wordWrapWidth: 102, maxLines: 1, textOverflow: 'ellipsis',
    }))
    this.upsert('address-background', 'rect', { x: left, y: 35, width: NODE_WIDTH - 28, height: 22, radius: 4,
      fill: '#142033', opacity: .65 * opacity, pointerEvents: 'none' }, container)
    text('address', address, left + 5, 46, '#d0dcf1',
      Math.min(11, 280 / (Math.max(1, Array.from(address).length) * .61)), { fontFamily: 'monospace' })
    this.upsert('edit-node', 'rect', { x: 105, y: -50, width: 41, height: 21, radius: 5,
      fill: '#253650', stroke: '#62799c', opacity, cursor: 'pointer' }, container)
    text('edit-caption', 'Edit', 125.5, -39.5, '#e3ecfc', 10, { textAlign: 'center' })
    for (const [direction, x, collapsed] of [['in', -NODE_WIDTH / 2, collapsedIn], ['out', NODE_WIDTH / 2, collapsedOut]] as const) {
      this.upsert('branch-' + direction, 'circle', { cx: x, cy: 0, r: 8, fill: '#171e2c',
        stroke: accent, lineWidth: 1, opacity, cursor: 'pointer' }, container)
      text('branch-sign-' + direction, collapsed ? '+' : '−', x, 0, '#eef3ff', 10, { textAlign: 'center' })
    }
  }

  protected glyph = '◇'
}
class AddressNode extends BaseFlowNode {}
class EntityNode extends BaseFlowNode { protected glyph = '≋' }

interface FlowStyle extends BaseEdgeStyleProps { route: Route; summary?: SummaryPosition }

class TransactionEdge extends BaseEdge {
  render(...args: Parameters<BaseEdge['render']>) {
    super.render(...args)
    const [attributes = this.attributes, container = this] = args
    const summary = (attributes as FlowStyle).summary
    this.upsert('summary-leader', 'path', summary?.callout ? {
      d: [['M', ...summary.anchor], ['L', ...summary.point]], stroke: '#7e9db9',
      opacity: .68, lineDash: [3, 3], lineWidth: 1, pointerEvents: 'none', zIndex: -1,
    } : false, container)
    remember(this.context.graph, this)
  }

  protected getKeyPath(attributes: Required<FlowStyle>) {
    return attributes.route.path
  }

  protected getLabelStyle(attributes: Required<FlowStyle>) {
    const style = super.getLabelStyle(attributes)
    if (!style) return false
    const [x, y] = attributes.summary?.point ?? attributes.route.label
    return { ...style, x, y, transform: [], textAlign: 'center' as const, textBaseline: 'middle' as const,
      wordWrap: true, wordWrapWidth: SUMMARY_WIDTH - 12, maxLines: 1, textOverflow: 'ellipsis',
      backgroundWidth: SUMMARY_WIDTH, backgroundHeight: SUMMARY_HEIGHT }
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
      hasIcon: !!elements.get(node.id)?.getShape('role-image'),
      card: { note: boxFor(node.id, 'note'), ledger: boxFor(node.id, 'figure-panel'), address: boxFor(node.id, 'address'),
        addressText: elements.get(node.id)?.getShape('address')?.attributes.text } })),
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
  toggleBranch: (id: string, direction: 'in' | 'out') => void, editNode: (id: string) => void) {
  const graph = new Graph({
    container, padding: 56, animation: false, zoomRange: [0.008, 3],
    behaviors: [
      'drag-canvas', 'zoom-canvas',
      { type: 'drag-element', key: 'move', enable: (event: { targetType: string; target: { id: string } }) =>
        event.targetType === 'node' && selected()?.id === event.target.id },
    ],
    node: { state: {
      selected: ({ style }) => ({ stroke: style?.stroke, strokeOpacity: 1, lineWidth: 3, halo: true, haloStroke: '#a8c1ff' }),
      related: ({ style }) => ({ stroke: style?.stroke, strokeOpacity: 1, lineWidth: 2 }),
    } },
    edge: { state: {
      selected: ({ style }) => ({ stroke: style?.stroke, endArrowFill: style?.endArrowFill, lineWidth: 3.5, halo: true, haloStroke: '#f4cb7e' }),
      related: ({ style }) => ({ stroke: style?.stroke, endArrowFill: style?.endArrowFill, lineWidth: 2.7 }),
    } },
  })
  graph.on(NodeEvent.CLICK, event => {
    if (!('target' in event && event.target && 'id' in event.target)) return
    const id = String(event.target.id)
    const shape = 'originalTarget' in event ? event.originalTarget.className : ''
    if (shape === 'edit-node' || shape === 'edit-caption') {
      editNode(id)
    } else if (shape === 'branch-in' || shape === 'branch-out') {
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

export function nodeColorStyle(accent: string) {
  return { fill: cardFill(accent), stroke: accent, accent }
}

export function edgeColorStyle(color: string) {
  return { stroke: color, endArrowFill: color }
}

function truncate(text: string, length: number) {
  const chars = Array.from(text)
  return chars.length > length ? chars.slice(0, length - 1).join('') + '…' : text
}

const assetColors = new Map([
  ['ETH', '#84b1ff'], ['USDT', '#6ce3ca'], ['USDC', '#8ee3ff'], ['LINK', '#a4a5ff'], ['DAI', '#ffd078'],
])
const otherColors = ['#b4d7ec', '#f0a7b4', '#b4dec2', '#cab4ea', '#ecc2a2', '#c5cc91', '#a6c5df', '#c5bbc8']

function edgeColor(asset?: string, assetId = '') {
  if (!asset) return '#baba83'
  const base = assetColors.get(asset.toUpperCase())
  if (base) return base
  const hash = Array.from(assetId || asset).reduce((value, char) => Math.imul(value, 31) + char.charCodeAt(0) | 0, 0)
  return otherColors[(hash >>> 0) % otherColors.length]
}

export function displayColor(edits: Edits, type: 'node', item: FlowNode): string
export function displayColor(edits: Edits, type: 'edge', item: FlowEdge): string
export function displayColor(edits: Edits, type: Selection['type'], item: FlowNode | FlowEdge): string {
  const custom = (type === 'node' ? edits.nodeColors : edits.edgeColors)?.[item.id]
  if (custom && /^#[a-f\d]{6}$/i.test(custom)) return custom
  return 'events' in item ? edgeColor(item.asset, item.events[0]?.assetId) : addressAccent(item.color)
}

export function graphData(view: FlowView, drawing: Drawing, edits: Edits, assets: Map<string, NodeAsset[]>,
  hidden: Set<string>, selected?: Selection, boxed = new Set<string>(), pairFocused = false): GraphData {
  const primary = new Set(boxed)
  if (selected?.type === 'node') primary.add(selected.id)
  const relatedNodes = new Set(primary)
  const relatedEdges = new Set<string>()
  for (const edge of view.edges) {
    if (!primary.has(edge.source) && !primary.has(edge.target) &&
      !(selected?.type === 'edge' && selected.id === edge.id)) continue
    relatedEdges.add(edge.id)
    relatedNodes.add(edge.source)
    relatedNodes.add(edge.target)
  }
  const focusing = !pairFocused && !!(primary.size || selected)
  return {
    nodes: view.nodes.map(node => {
      const [x, y] = drawing.positions[node.id]
      const asset = assets.get(node.id)?.[0]
      const figures = asset ? [
        'In ' + compactQuantity(asset.incoming),
        'Out ' + compactQuantity(asset.outgoing),
        asset.balances.length ? compactQuantity(asset.balances) + (asset.prices.length ? ' / $' + compactQuantity(asset.prices) : '') : 'Bal –',
      ] : ['In –', 'Out –', 'Bal –']
      const accent = displayColor(edits, 'node', node)
      const note = edits.notes[node.id] ?? ''
      const muted = focusing && !relatedNodes.has(node.id)
      return {
        id: node.id, type: node.members ? 'flow-entity' : 'flow-address',
        states: primary.has(node.id) ? ['selected'] : relatedNodes.has(node.id) ? ['related'] : [],
        style: {
          x, y, size: [NODE_WIDTH, NODE_HEIGHT], radius: 10,
          ...nodeColorStyle(accent), fillOpacity: muted ? .45 : 1, strokeOpacity: muted ? .22 : .64, lineWidth: 1.4,
          title: node.name, address: node.address,
          roleImage: addressIcon(node),
          roleName: [node.role ?? 'Address', asset?.symbol].filter(Boolean).join(' · '),
          note: truncate(note, 125), figures, muted,
          collapsedIn: hidden.has(node.id + ':in'), collapsedOut: hidden.has(node.id + ':out'), cursor: 'grab',
        },
      }
    }),
    edges: view.edges.map(edge => {
      const route = drawing.routes[edge.id]
      const first = edge.events[0]
      const color = displayColor(edits, 'edge', edge)
      const related = relatedEdges.has(edge.id)
      const parallel = route.parallel
      const summary = drawing.summaries[edge.id]
      return {
        id: edge.id, type: 'transaction-path', source: edge.source, target: edge.target,
        states: selected?.id === edge.id ? ['selected'] : related ? ['related'] : [],
        style: {
          route, summary, loop: false, ...edgeColorStyle(color), opacity: focusing && !related ? .19 : 1,
          lineWidth: parallel ? 1.45 : 1.55, increasedLineWidthForHitTesting: parallel?.compact ? 3 : parallel ? 5 : 9,
          lineDash: edge.events.length ? undefined : [6, 5], endArrow: true, endArrowType: 'triangle',
          endArrowSize: parallel ? 6 : 10, cursor: 'pointer', labelAutoRotate: false,
          labelText: first ? transactionSummary(edge) : undefined,
          labelFontSize: 10, labelFill: '#d7e5ef', labelBackground: true, labelBackgroundFill: '#111d26',
          labelPadding: [3, 4], labelBackgroundRadius: 3,
        },
      }
    }),
  }
}
