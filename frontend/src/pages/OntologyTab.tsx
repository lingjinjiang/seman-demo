import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from "@xyflow/react";
import { api } from "../api";
import { ConceptForm, OntologyRelForm } from "../components/forms";
import type { Artifact, Issue, WorkingView } from "../types";

type ConceptData = { label: string; kind: string; description?: string };
type RelData = { key: string };
type ConceptNodeType = Node<ConceptData, "concept">;

function ConceptNode({ data }: NodeProps<ConceptNodeType>) {
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div
        className={`concept-node ${data.kind === "EntityType" ? "entity" : "value"}`}
      >
        <div className="cname">{data.label}</div>
        <div className="ctype">{data.kind}</div>
        {data.description && <div className="sub">{data.description}</div>}
      </div>
    </>
  );
}

const nodeTypes = { concept: ConceptNode };

export function OntologyTab({
  repoId,
  working,
  refresh
}: {
  repoId: string;
  working: WorkingView;
  refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<{ kind: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveIssues, setSaveIssues] = useState<Issue[]>([]);

  const concepts = useMemo(
    () => working.artifacts.filter((a) => a.kind === "concept"),
    [working]
  );
  const rels = useMemo(
    () => working.artifacts.filter((a) => a.kind === "ontology_relationship"),
    [working]
  );

  const nodes = useMemo(() => {
    let eRow = 0;
    let vRow = 0;
    return concepts.map((c): ConceptNodeType => {
      const isEntity = c.body.type === "EntityType";
      const x = isEntity ? 30 : 480;
      const y = 20 + (isEntity ? eRow++ : vRow++) * 150;
      return {
        id: `concept:${c.key}`,
        position: { x, y },
        data: {
          label: c.key,
          kind: c.body.type,
          description: c.body.description
        },
        type: "concept"
      };
    });
  }, [concepts]);

  const edges = useMemo(() => {
    const out: Edge<RelData>[] = [];
    for (const r of rels) {
      const owner = r.key.split(".")[0];
      const roles: { concept: string; name?: string }[] = r.body.roles || [];
      if (roles.length === 0) continue;
      roles.forEach((role, i) => {
        if (role.concept === owner) return;
        out.push({
          id: `rel:${r.key}:${i}`,
          source: `concept:${owner}`,
          target: `concept:${role.concept}`,
          label: role.name ? `${r.body.name}·${role.name}` : r.body.name,
          data: { key: r.key },
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "#8b93a7", strokeWidth: 1.5 }
        });
      });
    }
    return out;
  }, [rels]);

  const artifact = selected
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
              <span className="badge">{c.body.type === "EntityType" ? "实体" : "值类型"}</span>
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
              {r.body.roles?.length
                ? `→ ${r.body.roles.map((x: any) => x.concept).join(", ")}`
                : "一元关系"}
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
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onNodeClick={(_, node) => {
            const [, key] = node.id.split(":");
            setSelected({ kind: "concept", key });
          }}
          onEdgeClick={(_, edge) => {
            const key = (edge.data as RelData)?.key;
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
