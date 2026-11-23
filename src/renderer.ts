import { BaseEdge, CanvasEvent, EdgeEvent, ExtensionCategory, Graph, NodeEvent, Rect, register } from '@antv/g6'
import type { BaseEdgeStyleProps, GraphData } from '@antv/g6'
import type { Edits, FlowView, Point } from './case'
import { NODE_HEIGHT, NODE_WIDTH, type Drawing, type Route } from './layout'

export class BaseFlowNode extends Rect {}
class AddressNode extends BaseFlowNode {}
class EntityNode extends BaseFlowNode {}

interface FlowStyle extends BaseEdgeStyleProps { route: Route }

class TransactionEdge extends BaseEdge {
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
          labelText: [node.name.slice(0, 22), short, details].join('\n'),
          labelPlacement: 'center', labelFill: '#e1eeed', labelFontSize: 12, labelLineHeight: 21,
          labelWordWrap: true, labelMaxWidth: 200, cursor: 'grab',
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
