import { useMemo, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps
} from "@xyflow/react";
import type { Artifact } from "../types";

// Rendering spec (design-ouline.md §4.1):
//   node = concept (EntityType large/solid, ValueType small/light);
//   edge = binary relationship, owner (role #1) -> other end, labelled by name;
//   multiplicity at the arrow end (ManyToOne -> 1, OneToOne -> 1:1);
//   unary = node badge; n-ary = dashed diamond hub with legs #1..#n and * on the
//   determined role; self-loop labelled with the role name; parallel edges carry
//   the full `Concept.relationship` name; key = identify_by.

type ConceptData = {
  label: string;
  kind: string;
  description?: string;
  identifying: boolean;
  unary: boolean;
};
type ConceptNodeType = Node<ConceptData, "concept">;

type HubData = { label: string; key: string };
type HubNodeType = Node<HubData, "hub">;

type SpecEdgeData = { key: string; name: string; multiplicity?: string };
type SpecEdgeType = Edge<SpecEdgeData, "spec">;

function ConceptNode({ data }: NodeProps<ConceptNodeType>) {
  const isEntity = data.kind === "EntityType";
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div className={`concept-node ${isEntity ? "entity" : "value"}`}>
        <div className="cname">
          {data.label}
          {data.identifying && (
            <span className="key-badge" title="identify_by 标识关系">
              🔑
            </span>
          )}
          {data.unary && (
            <span className="unary-badge" title="一元关系（unary）">
              ⚑
            </span>
          )}
        </div>
        <div className="ctype">{isEntity ? "EntityType" : "ValueType"}</div>
        {data.description && <div className="sub">{data.description}</div>}
      </div>
    </>
  );
}

const HUB_HANDLES = ["top", "left", "bottom", "right"] as const;

function HubNode({ data }: NodeProps<HubNodeType>) {
  return (
    <>
      {HUB_HANDLES.map((id) => (
        <Handle
          key={id}
          id={id}
          type="target"
          position={
            id === "top"
              ? Position.Top
              : id === "left"
                ? Position.Left
                : id === "bottom"
                  ? Position.Bottom
                  : Position.Right
          }
          style={{ opacity: 0 }}
        />
      ))}
      <div className="hub-node" title={`${data.label} — n 元事实·无身份（虚拟实体）`}>
        <div className="hub-inner">
          <div className="cname">{data.label}</div>
          <div className="ctype">n 元事实 · 无身份</div>
        </div>
      </div>
    </>
  );
}

function SpecEdge(props: EdgeProps<SpecEdgeType>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    markerEnd,
    style
  } = props;

  const isSelf =
    Math.abs(sourceX - targetX) < 1 && Math.abs(sourceY - targetY) < 1;

  let path: string;
  let nameX: number;
  let nameY: number;
  let multX: number;
  let multY: number;

  if (isSelf) {
    const r = 54;
    path = `M ${sourceX} ${sourceY - r} C ${sourceX + r * 1.7} ${
      sourceY - r * 1.7
    }, ${sourceX + r * 1.7} ${sourceY + r * 1.7}, ${sourceX} ${sourceY + r}`;
    nameX = sourceX + r * 1.45;
    nameY = sourceY;
    multX = sourceX + r * 0.95;
    multY = sourceY - r * 0.8;
  } else {
    [path, nameX, nameY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition
    });
    multX = sourceX + (targetX - sourceX) * 0.72;
    multY = sourceY + (targetY - sourceY) * 0.72;
  }

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="edge-label"
          style={{
            transform: `translate(-50%, -50%) translate(${nameX}px, ${nameY}px)`
          }}
        >
          {data?.name}
        </div>
        {data?.multiplicity && (
          <div
            className="edge-mult"
            style={{
              transform: `translate(-50%, -50%) translate(${multX}px, ${multY}px)`
            }}
          >
            {data.multiplicity}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { concept: ConceptNode, hub: HubNode };
const edgeTypes = { spec: SpecEdge };

function rolesOf(body: any): { concept: string; name?: string }[] {
  return Array.isArray(body.roles) ? body.roles : [];
}

// ManyToOne -> 1, OneToOne -> 1:1, unconstrained (many-to-many) -> none.
function multiplicityChip(m?: string): string | undefined {
  if (m === "ManyToOne") return "1";
  if (m === "OneToOne") return "1:1";
  return undefined;
}

export function OntologyGraph({
  artifacts,
  onSelect
}: {
  artifacts: Artifact[];
  onSelect: (kind: string, key: string) => void;
}) {
  const [showValueTypes, setShowValueTypes] = useState(true);

  const concepts = useMemo(
    () => artifacts.filter((a) => a.kind === "concept"),
    [artifacts]
  );
  const rels = useMemo(
    () => artifacts.filter((a) => a.kind === "ontology_relationship"),
    [artifacts]
  );

  const { nodes, edges } = useMemo(() => {
    const unaryOwners = new Set<string>();
    for (const r of rels) {
      if (rolesOf(r.body).length === 0) unaryOwners.add(r.key.split(".")[0]);
    }

    const conceptNodes: ConceptNodeType[] = [];
    let entityRow = 0;
    let valueRow = 0;
    for (const c of concepts) {
      const isEntity = c.body.type === "EntityType";
      if (!isEntity && !showValueTypes) continue;
      conceptNodes.push({
        id: `concept:${c.key}`,
        position: {
          x: isEntity ? 40 : 620,
          y: 24 + (isEntity ? entityRow++ : valueRow++) * 140
        },
        data: {
          label: c.key,
          kind: c.body.type,
          description: c.body.description,
          identifying:
            Array.isArray(c.body.identify_by) && c.body.identify_by.length > 0,
          unary: unaryOwners.has(c.key)
        },
        type: "concept"
      });
    }
    const posById = new Map(conceptNodes.map((n) => [n.id, n.position]));

    type BinaryRel = {
      key: string;
      owner: string;
      relName: string;
      target: string;
      roleName?: string;
      multiplicity?: string;
      selfLoop: boolean;
    };
    const binaries: BinaryRel[] = [];
    const naries: {
      key: string;
      owner: string;
      relName: string;
      roles: { concept: string; name?: string }[];
      multiplicity?: string;
    }[] = [];

    for (const r of rels) {
      const [owner, relName] = r.key.split(".");
      const roles = rolesOf(r.body);
      if (roles.length === 1) {
        binaries.push({
          key: r.key,
          owner,
          relName,
          target: roles[0].concept,
          roleName: roles[0].name,
          multiplicity: r.body.multiplicity,
          selfLoop: roles[0].concept === owner
        });
      } else if (roles.length >= 2) {
        naries.push({
          key: r.key,
          owner,
          relName,
          roles,
          multiplicity: r.body.multiplicity
        });
      }
    }

    const pairCount = new Map<string, number>();
    for (const b of binaries) {
      if (b.selfLoop) continue;
      const pid = [b.owner, b.target].sort().join("::");
      pairCount.set(pid, (pairCount.get(pid) || 0) + 1);
    }

    const outEdges: SpecEdgeType[] = [];
    for (const b of binaries) {
      const source = `concept:${b.owner}`;
      const target = `concept:${b.target}`;
      if (!posById.has(source) || !posById.has(target)) continue;
      const parallel =
        (pairCount.get([b.owner, b.target].sort().join("::")) || 0) > 1;
      const label = b.selfLoop
        ? b.roleName || b.relName
        : parallel
          ? `${b.owner}.${b.relName}`
          : b.relName;
      outEdges.push({
        id: `rel:${b.key}`,
        source,
        target,
        type: "spec",
        data: {
          key: b.key,
          name: label,
          multiplicity: multiplicityChip(b.multiplicity)
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b" },
        style: b.selfLoop
          ? { stroke: "#94a3b8", strokeWidth: 1.5, strokeDasharray: "4 4" }
          : { stroke: "#94a3b8", strokeWidth: 1.5 }
      });
    }

    const hubNodes: HubNodeType[] = [];
    for (const n of naries) {
      const legs = [n.owner, ...n.roles.map((r) => r.concept)];
      const points = legs
        .map((c) => posById.get(`concept:${c}`))
        .filter((p): p is { x: number; y: number } => !!p);
      if (points.length === 0) continue;
      const cx = points.reduce((s, p) => s + p.x, 0) / points.length + 110;
      const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
      const hubId = `hub:${n.key}`;
      hubNodes.push({
        id: hubId,
        type: "hub",
        position: { x: cx, y: cy },
        data: { label: n.relName, key: n.key }
      });
      legs.forEach((concept, i) => {
        const source = `concept:${concept}`;
        if (!posById.has(source)) return;
        const determined = i === legs.length - 1 && !!n.multiplicity;
        outEdges.push({
          id: `rel:${n.key}:${i}`,
          source,
          target: hubId,
          targetHandle: HUB_HANDLES[i % HUB_HANDLES.length],
          type: "spec",
          data: {
            key: n.key,
            name: `#${i + 1}${determined ? " ★" : ""}`
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#8b5cf6" },
          style: { stroke: "#a78bfa", strokeWidth: 1.3, strokeDasharray: "4 4" }
        });
      });
    }

    return { nodes: [...conceptNodes, ...hubNodes], edges: outEdges };
  }, [concepts, rels, showValueTypes]);

  return (
    <div className="canvas-wrap">
      <label className="canvas-toggle">
        <input
          type="checkbox"
          checked={showValueTypes}
          onChange={(e) => setShowValueTypes(e.target.checked)}
        />
        显示值类型
      </label>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onNodeClick={(_, node) => {
          if (node.type === "hub") {
            onSelect("ontology_relationship", (node.data as HubData).key);
            return;
          }
          const [, key] = node.id.split(":");
          onSelect("concept", key);
        }}
        onEdgeClick={(_, edge) => {
          const key = (edge.data as SpecEdgeData)?.key;
          if (key) onSelect("ontology_relationship", key);
        }}
      >
        <Background gap={18} color="#e2e8f0" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
