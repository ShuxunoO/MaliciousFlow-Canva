import { BaseEdge, CanvasEvent, EdgeEvent, ExtensionCategory, Graph, NodeEvent, Rect, register } from '@antv/g6'
import type { BaseEdgeStyleProps, GraphData, RectStyleProps } from '@antv/g6'
import { flattenPath } from './geometry'
import type { Edits, FlowView, Point } from './case'
import { NODE_HEIGHT, NODE_WIDTH, type Drawing, type Route } from './layout'

const rendered = new WeakMap<Graph, Map<string, BaseFlowNode | TransactionEdge>>()

function remember(graph: Graph, element: BaseFlowNode | TransactionEdge) {
  if (!import.meta.env.DEV) return
  const elements = rendered.get(graph) ?? new Map()
  elements.set(element.id, element)
  rendered.set(graph, elements)
}

interface FlowNodeStyle extends RectStyleProps { title: string; address: string; summary: string; accent: string }

export class BaseFlowNode extends Rect {
  render(...args: Parameters<Rect['render']>) {
    super.render(...args)
    remember(this.context.graph, this)
  }

  protected drawLabelShape(attributes: Required<FlowNodeStyle>, container: NonNullable<Parameters<Rect['render']>[1]>) {
    const { title, address, summary, accent } = attributes
    this.upsert('role-icon', 'circle', { cx: -87, cy: -23, r: 10, fill: accent, opacity: .92 }, container)
    this.upsert('role-glyph', 'text', { x: -87, y: -23, text: this.glyph, fill: '#101d24', fontSize: 11,
      fontWeight: 700, textBaseline: 'middle', textAlign: 'center' }, container)
    this.upsert('title', 'text', { x: -69, y: -22, text: title, fill: '#e9f5f3', fontSize: 15,
      fontWeight: 650, textBaseline: 'middle' }, container)
    this.upsert('address', 'text', { x: -91, y: 5, text: address, fill: '#9cb8be', fontSize: 11,
      fontFamily: 'monospace', textBaseline: 'middle' }, container)
    this.upsert('summary', 'text', { x: -91, y: 28, text: summary, fill: '#add5cf', fontSize: 11, textBaseline: 'middle' }, container)
  }

  protected glyph = '•'
}
class AddressNode extends BaseFlowNode {}
class EntityNode extends BaseFlowNode { protected glyph = '∴' }

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
  if (!elements) throw new Error('没有可导出的渲染快照')
  const boxFor = (id: string, key: string) => {
    const shape = elements.get(id)?.getShape(key)
    if (!shape) return
    const { min, max } = shape.getBounds()
    return [min[0], min[1], max[0] - min[0], max[1] - min[1]]
  }
  return {
    geometry: 'rendered', view: name, tolerance: .5,
    nodes: view.nodes.map(node => ({ id: node.id, box: boxFor(node.id, 'key') })),
    edges: view.edges.map(edge => {
      const key = elements.get(edge.id)?.getShape('key')
      if (!key) throw new Error('交易边未绘制 ' + edge.id)
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
  move: (id: string, point: Point) => void, selected: () => Selection | undefined) {
  const graph = new Graph({
    container, autoResize: true, padding: 56, animation: false, zoomRange: [0.008, 3],
    behaviors: [
      'drag-canvas', 'zoom-canvas',
      { type: 'drag-element', key: 'move', enable: (event: { targetType: string; target: { id: string } }) =>
        event.targetType === 'node' && selected()?.id === event.target.id },
    ],
    node: { state: { selected: { stroke: '#6bf1cc', lineWidth: 3 } } },
    edge: { state: { selected: { stroke: '#f4cb7e', endArrowFill: '#f4cb7e', lineWidth: 3 } } },
  })
  graph.on(NodeEvent.CLICK, event => { if ('target' in event && event.target && 'id' in event.target) select({ type: 'node', id: String(event.target.id) }) })
  graph.on(EdgeEvent.CLICK, event => { if ('target' in event && event.target && 'id' in event.target) select({ type: 'edge', id: String(event.target.id) }) })
  graph.on(CanvasEvent.CLICK, () => select())
  graph.on(NodeEvent.DRAG_END, event => {
    if (!('target' in event && event.target && 'id' in event.target) || selected()?.id !== event.target.id) return
    const [x, y] = graph.getElementPosition(String(event.target.id))
    move(String(event.target.id), [x, y])
  })
  return graph
}

export function graphData(view: FlowView, drawing: Drawing, edits: Edits, selected?: Selection): GraphData {
  const summaries = new Map<string, { incoming: Set<string>; outgoing: Set<string> }>()
  for (const node of view.nodes) summaries.set(node.id, { incoming: new Set(), outgoing: new Set() })
  for (const edge of view.edges) if (edge.asset) {
    summaries.get(edge.source)?.outgoing.add(edge.asset)
    summaries.get(edge.target)?.incoming.add(edge.asset)
  }
  const showAllLabels = view.edges.length < 190
  return {
    nodes: view.nodes.map(node => {
      const [x, y] = drawing.positions[node.id]
      const amounts = summaries.get(node.id)!
      const details = edits.notes[node.id]?.slice(0, 25)
        || ('流入 ' + ([...amounts.incoming].slice(0, 2).join('/') || '—')
          + '  ·  流出 ' + ([...amounts.outgoing].slice(0, 2).join('/') || '—'))
      const short = node.address.length > 24 ? node.address.slice(0, 12) + '…' + node.address.slice(-7) : node.address
      return {
        id: node.id, type: node.members ? 'flow-entity' : 'flow-address', states: selected?.id === node.id ? ['selected'] : [],
        style: {
          x, y, size: [NODE_WIDTH, NODE_HEIGHT], radius: 13, fill: '#172830',
          stroke: node.color && /^#[a-f\d]{6}$/i.test(node.color) ? node.color : '#5c8d89', lineWidth: 1.4,
          title: Array.from(node.name).slice(0, 13).join(''), address: short,
          summary: Array.from(details).slice(0, 25).join(''),
          accent: node.color && /^#[a-f\d]{6}$/i.test(node.color) ? node.color : '#69c8a9', cursor: 'grab',
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
          labelText: (showAllLabels && drawing.labels.has(edge.id)) || selected?.id === edge.id
            ? (first ? [edge.amount + ' ' + edge.asset, edge.events.length + ' 笔', period + ' UTC'].join('  ·  ') : edge.note) : undefined,
          labelFontSize: 10, labelFill: '#d7e5ef', labelBackground: true, labelBackgroundFill: '#111d26',
          labelPadding: [3, 4], labelBackgroundRadius: 3,
        },
      }
    }),
  }
}
