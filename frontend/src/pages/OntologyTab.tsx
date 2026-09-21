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
import { api } from "../api";
import { ConceptForm, OntologyRelForm } from "../components/forms";
import type { Artifact, Issue, WorkingView } from "../types";

// ---------------------------------------------------------------------------
// Ontology canvas rendering spec (design-ouline.md §4.1)
//   - node = every concept: EntityType large/solid, ValueType small/light;
//   - edge = binary relationships only, direction owner (role #1) -> other end,
//     label = relationship name;
//   - multiplicity is marked at the arrow end (ManyToOne -> 1, OneToOne -> 1:1,
//     unconstrained -> none);
//   - unary = node badge; n-ary = virtual entity hub (dashed diamond) whose legs
//     are numbered #1..#n with * on the determined role;
//   - self-loop is labelled with the role name; parallel edges carry full names;
//   - key = identify_by.
// ---------------------------------------------------------------------------

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

function arityLabel(body: any): string {
  const n = 1 + rolesOf(body).length;
  return n === 1 ? "一元" : n === 2 ? "二元" : `${n} 元`;
}

// ManyToOne -> 1, OneToOne -> 1:1, unconstrained (many-to-many) -> none.
function multiplicityChip(m?: string): string | undefined {
  if (m === "ManyToOne") return "1";
  if (m === "OneToOne") return "1:1";
  return undefined;
}

export function OntologyTab({
  repoId,
  working,
  refresh
}: {
  repoId: string;
  working: WorkingView;
  refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<{ kind: string; key: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveIssues, setSaveIssues] = useState<Issue[]>([]);
  const [showValueTypes, setShowValueTypes] = useState(true);

  const concepts = useMemo(
    () => working.artifacts.filter((a) => a.kind === "concept"),
    [working]
  );
  const rels = useMemo(
    () => working.artifacts.filter((a) => a.kind === "ontology_relationship"),
    [working]
  );

  const { nodes, edges } = useMemo(() => {
    // Owners that carry at least one unary fact -> node badge.
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
          identifying: Array.isArray(c.body.identify_by) && c.body.identify_by.length > 0,
          unary: unaryOwners.has(c.key)
        },
        type: "concept"
      });
    }
    const posById = new Map(conceptNodes.map((n) => [n.id, n.position]));

    // Classify relationships into unary / binary / n-ary.
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
      // roles.length === 0 -> unary, rendered as a node badge only.
    }

    // Parallel binary edges between the same pair carry their full name.
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
      const parallel = (pairCount.get([b.owner, b.target].sort().join("::")) || 0) > 1;
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
        markerEnd: { type: MarkerType.ArrowClosed },
        style: b.selfLoop
          ? { stroke: "#8b93a7", strokeWidth: 1.5, strokeDasharray: "4 4" }
          : { stroke: "#8b93a7", strokeWidth: 1.5 }
      });
    }

    // n-ary facts become virtual entity hubs with numbered legs.
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
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "#a08ad0", strokeWidth: 1.3, strokeDasharray: "4 4" }
        });
      });
    }

    return { nodes: [...conceptNodes, ...hubNodes], edges: outEdges };
  }, [concepts, rels, showValueTypes]);

  const artifact: Artifact | undefined = selected
    ? working.artifacts.find(
        (a) => a.kind === selected.kind && a.key === selected.key
      )
    : undefined;
  const conceptNames = concepts.map((c) => c.key);

  const save = async (kind: string, key: string, body: any) => {
    setBusy(true);
    setError(null);
    setSaveIssues([]);
    try {
      await api.upsertArtifact(repoId, kind, key, body);
      await refresh();
      setSelected({ kind, key });
    } catch (e: any) {
      setError(e.message);
      setSaveIssues(e.issues || []);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (kind: string, key: string) => {
    if (!confirm(`删除 ${kind}:${key}？`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteArtifact(repoId, kind, key);
      await refresh();
      setSelected(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const formKey = selected ? `${selected.kind}:${selected.key}` : "none";

  return (
    <div className="grid-3">
      <div className="panel list-panel">
        <div className="muted" style={{ marginBottom: 6 }}>
          概念（{concepts.length}）
        </div>
        {concepts.map((c) => (
          <div
            key={c.key}
            className={`list-item ${
              selected?.kind === "concept" && selected.key === c.key ? "selected" : ""
            }`}
            onClick={() => setSelected({ kind: "concept", key: c.key })}
          >
            <div>
              {c.key}{" "}
              <span className="badge">
                {c.body.type === "EntityType" ? "实体" : "值类型"}
              </span>
              {Array.isArray(c.body.identify_by) && c.body.identify_by.length > 0 && (
                <span className="key-badge" title="identify_by">
                  🔑
                </span>
              )}
            </div>
            <div className="sub">
              {c.body.extends?.length ? `extends: ${c.body.extends.join(", ")}` : "extends: Any"}
            </div>
          </div>
        ))}
        <button
          style={{ marginTop: 8, width: "100%" }}
          onClick={() =>
            setSelected({
              kind: "concept",
              key: `new_${concepts.length + 1}`
            })
          }
        >
          + 新建实体/值类型
        </button>

        <div className="muted" style={{ margin: "12px 0 6px" }}>
          关系（{rels.length}）
        </div>
        {rels.map((r) => (
          <div
            key={r.key}
            className={`list-item ${
              selected?.kind === "ontology_relationship" && selected.key === r.key
                ? "selected"
                : ""
            }`}
            onClick={() =>
              setSelected({ kind: "ontology_relationship", key: r.key })
            }
          >
            <div>{r.key}</div>
            <div className="sub">
              {arityLabel(r.body)}
              {rolesOf(r.body).length
                ? ` → ${rolesOf(r.body)
                    .map((x) => x.concept)
                    .join(", ")}`
                : " · 一元事实"}
              {r.body.multiplicity ? ` · ${r.body.multiplicity}` : ""}
            </div>
          </div>
        ))}
        <button
          style={{ marginTop: 8, width: "100%" }}
          onClick={() =>
            setSelected({
              kind: "ontology_relationship",
              key: `${conceptNames[0] || "Person"}.new_relationship`
            })
          }
        >
          + 新建关系
        </button>
      </div>

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
              setSelected({
                kind: "ontology_relationship",
                key: (node.data as HubData).key
              });
              return;
            }
            const [, key] = node.id.split(":");
            setSelected({ kind: "concept", key });
          }}
          onEdgeClick={(_, edge) => {
            const key = (edge.data as SpecEdgeData)?.key;
            if (key) setSelected({ kind: "ontology_relationship", key });
          }}
        >
          <Background gap={18} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      <div className="panel" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!selected && <div className="empty">点击左侧列表或画布中的节点/连线进行编辑</div>}
        {selected && (
          <>
            <div className="muted" style={{ marginBottom: 8 }}>
              编辑：{selected.kind} · {selected.key}
            </div>
            {error && <div className="error-text">{error}</div>}
            {saveIssues.length > 0 && (
              <ul className="issues">
                {saveIssues.map((i, idx) => (
                  <li key={idx} className={i.level}>
                    [{i.level}] {i.path}: {i.message}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {selected.kind === "concept" ? (
                <ConceptForm
                  key={formKey}
                  body={artifact?.body || {}}
                  busy={busy}
                  onSave={(key, body) => save("concept", key, body)}
                  onDelete={() => remove("concept", selected.key)}
                />
              ) : (
                <OntologyRelForm
                  key={formKey}
                  body={
                    artifact?.body || {
                      _owner: selected.key.split(".")[0]
                    }
                  }
                  concepts={conceptNames}
                  busy={busy}
                  onSave={(key, body) => save("ontology_relationship", key, body)}
                  onDelete={() => remove("ontology_relationship", selected.key)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
