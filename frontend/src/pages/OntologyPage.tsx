import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ConceptForm, OntologyRelForm } from "../components/forms";
import { Modal } from "../components/Modal";
import { OntologyGraph } from "../components/OntologyGraph";
import { DataTable, PageHeader, Tabs, type Column } from "../components/ui";
import { VersionBar } from "../components/VersionBar";
import type { Artifact, Issue, ProjectVersion } from "../types";

// Information architecture follows the ontology spec
// (../ossie/ontology/ontology.md): an ontology groups *each relationship under
// the concept that plays its first role*. Relationships are therefore not a
// peer of concepts — they are a property of the concept that declares them, and
// are only ever managed from inside a concept.

type TabKey = "concepts" | "graph" | "raw";

/** A relationship row: either a saved artifact or one staged while creating a
 *  concept (whose key does not exist yet). */
type RelRow = { id: string; body: any; draftIndex?: number };

function rolesOf(body: any): { concept: string; name?: string }[] {
  return Array.isArray(body.roles) ? body.roles : [];
}

function arityLabel(body: any): string {
  const n = 1 + rolesOf(body).length;
  return n === 1 ? "一元" : n === 2 ? "二元" : `${n} 元`;
}

/** Everything that would break if `key` disappeared — surfaced before deleting
 *  so the modeler is not surprised by dangling references. */
function referencesTo(kind: string, key: string, artifacts: Artifact[]): string[] {
  const out: string[] = [];
  const concepts = artifacts.filter((a) => a.kind === "concept");
  const rels = artifacts.filter((a) => a.kind === "ontology_relationship");

  if (kind === "concept") {
    const own = rels.filter((r) => r.key.startsWith(`${key}.`));
    if (own.length) {
      out.push(
        `该概念自己声明的关系 ${own.map((r) => r.key).join("、")} 将失去所属概念`
      );
    }
    for (const r of rels) {
      if (r.key.startsWith(`${key}.`)) continue;
      if (rolesOf(r.body).some((x) => x.concept === key)) {
        out.push(`关系 ${r.key} 把 ${key} 作为角色`);
      }
    }
    for (const c of concepts) {
      const ext = Array.isArray(c.body.extends) ? c.body.extends : [];
      if (ext.includes(key)) out.push(`概念 ${c.key} 继承自 ${key}`);
    }
  } else {
    const [owner, relName] = key.split(".");
    const ownerConcept = concepts.find((c) => c.key === owner);
    const identifyBy = Array.isArray(ownerConcept?.body.identify_by)
      ? ownerConcept!.body.identify_by
      : [];
    if (identifyBy.includes(relName)) {
      out.push(`${owner} 的标识关系（identify_by）引用了它`);
    }
    for (const a of artifacts) {
      const text = JSON.stringify({
        requires: a.body.requires,
        derived_by: a.body.derived_by
      });
      if (text.includes(key)) {
        out.push(`${a.kind} ${a.key} 的 requires / derived_by 里提到了 ${key}`);
      }
    }
  }
  return Array.from(new Set(out));
}

/** The concept's own relationships — rendered *above* the save button so the
 *  declaring concept and its relationships read as one unit. */
function RelSection({
  rows,
  conceptTypes,
  busy,
  title,
  hint,
  onAdd,
  onEdit,
  onRemove
}: {
  rows: RelRow[];
  conceptTypes: Record<string, string>;
  busy: boolean;
  title: string;
  hint?: string;
  onAdd: () => void;
  onEdit: (row: RelRow) => void;
  onRemove: (row: RelRow) => void;
}) {
  const columns: Column<RelRow>[] = [
    {
      key: "name",
      header: "关系名",
      render: (r) => <span className="cell-primary">{r.body.name || "（未命名）"}</span>
    },
    {
      key: "arity",
      header: "元数",
      width: "80px",
      render: (r) => arityLabel(r.body)
    },
    {
      key: "roles",
      header: "角色",
      render: (r) => {
        const roles = rolesOf(r.body);
        if (!roles.length) return <span className="badge">一元事实</span>;
        return (
          <span className="mono">
            {roles
              .map((x) => {
                const t = conceptTypes[x.concept];
                const suffix = t === "EntityType" ? "实体" : t === "ValueType" ? "值类型" : "";
                return `${x.name ? `${x.concept}(${x.name})` : x.concept}${
                  suffix ? `·${suffix}` : ""
                }`;
              })
              .join(" → ")}
          </span>
        );
      }
    },
    {
      key: "multiplicity",
      header: "多重性",
      width: "120px",
      render: (r) =>
        r.body.multiplicity ? (
          <span className="badge accent">{r.body.multiplicity}</span>
        ) : (
          <span className="muted">未约束</span>
        )
    },
    {
      key: "actions",
      header: "",
      width: "110px",
      align: "right",
      render: (r) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          <button className="sm" onClick={() => onEdit(r)}>
            编辑
          </button>{" "}
          <button className="sm danger" disabled={busy} onClick={() => onRemove(r)}>
            移除
          </button>
        </span>
      )
    }
  ];

  return (
    <div className="rel-section">
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="panel-title" style={{ margin: 0 }}>
          {title}
        </div>
        <span className="spacer" />
        <button className="sm" onClick={onAdd} disabled={busy}>
          + 新建关系
        </button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => onEdit(r)}
        empty="该概念还没有声明关系"
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function OntologyPage({
  version,
  refresh
}: {
  version: ProjectVersion;
  refresh: () => Promise<void>;
}) {
  const { projectId, working } = version;
  const [tab, setTab] = useState<TabKey>("concepts");
  // The concept whose detail (definition + its relationships) is open. The
  // empty string means "a concept being created".
  const [conceptKey, setConceptKey] = useState<string | null>(null);
  // Relationships staged while the concept itself is not saved yet.
  const [draftRels, setDraftRels] = useState<any[]>([]);
  // -1 = new draft; >= 0 = editing an existing draft.
  type RelEdit =
    | { mode: "persist"; creating: boolean; key: string }
    | { mode: "draft"; index: number };
  const [relEdit, setRelEdit] = useState<RelEdit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: string; key: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [raw, setRaw] = useState<string>("");
  const [rawError, setRawError] = useState<string | null>(null);

  const concepts = useMemo(
    () => working.artifacts.filter((a) => a.kind === "concept"),
    [working]
  );
  const rels = useMemo(
    () => working.artifacts.filter((a) => a.kind === "ontology_relationship"),
    [working]
  );
  const conceptNames = concepts.map((c) => c.key);
  const conceptTypes = useMemo(
    () => Object.fromEntries(concepts.map((c) => [c.key, c.body.type])),
    [concepts]
  );

  const ontologyIssues = working.issues.filter((i) => i.path.startsWith("ontology"));
  const errors = ontologyIssues.filter((i) => i.level === "error").length;
  const warnings = ontologyIssues.length - errors;

  const isNewConcept = conceptKey === "";
  const conceptArtifact = conceptKey
    ? working.artifacts.find((a) => a.kind === "concept" && a.key === conceptKey)
    : undefined;

  const ownedRels = useMemo(() => {
    if (!conceptKey || !conceptArtifact) return [] as RelRow[];
    return rels
      .filter((r) => r.key.startsWith(`${conceptKey}.`))
      .map((r) => ({ id: r.key, body: r.body }));
  }, [rels, conceptKey, conceptArtifact]);

  const relArtifact =
    relEdit?.mode === "persist" && !relEdit.creating
      ? working.artifacts.find(
          (a) => a.kind === "ontology_relationship" && a.key === relEdit.key
        )
      : undefined;

  useEffect(() => {
    if (tab !== "raw") return;
    let cancelled = false;
    setRawError(null);
    api
      .exportYaml(projectId)
      .then((text) => !cancelled && setRaw(text))
      .catch((e: any) => !cancelled && setRawError(e.message));
    return () => {
      cancelled = true;
    };
  }, [tab, projectId, working]);

  const resetMessages = () => {
    setError(null);
    setIssues([]);
  };

  const closeConcept = () => {
    setConceptKey(null);
    setRelEdit(null);
    setDraftRels([]);
    resetMessages();
  };

  const openConcept = (key: string) => {
    resetMessages();
    setRelEdit(null);
    setDraftRels([]);
    setConceptKey(key);
  };

  const openRelEditor = (key: string) => {
    resetMessages();
    setRelEdit({
      mode: "persist",
      creating: !working.artifacts.some(
        (a) => a.kind === "ontology_relationship" && a.key === key
      ),
      key
    });
  };

  const saveConcept = async (key: string, body: any) => {
    const renaming = !isNewConcept && !!conceptKey && key !== conceptKey;
    if (renaming && ownedRels.length > 0) {
      const ok = confirm(
        `重命名概念不会自动迁移它声明的 ${ownedRels.length} 条关系（关系标识为 \`概念.关系名\`）。\n` +
          `继续保存会留下待迁移的关系，建议先改名再重建关系。确定继续？`
      );
      if (!ok) return;
    }
    setBusy(true);
    resetMessages();
    try {
      await api.upsertArtifact(projectId, "concept", key, body);
      // A concept created together with its relationships: commit the staged
      // ones now that the declaring concept has a name (spec: relationship is
      // identified by `Concept.relationship`).
      if (isNewConcept) {
        for (const rel of draftRels) {
          if (!rel.name) continue;
          await api.upsertArtifact(
            projectId,
            "ontology_relationship",
            `${key}.${rel.name}`,
            rel
          );
        }
      }
      await refresh();
      closeConcept();
    } catch (e: any) {
      setError(e.message);
      setIssues(e.issues || []);
    } finally {
      setBusy(false);
    }
  };

  const saveRel = async (key: string, body: any) => {
    if (relEdit?.mode === "draft") {
      setDraftRels((current) => {
        const next = [...current];
        if (relEdit.index < 0) next.push(body);
        else next[relEdit.index] = body;
        return next;
      });
      setRelEdit(null);
      return;
    }
    setBusy(true);
    resetMessages();
    try {
      await api.upsertArtifact(projectId, "ontology_relationship", key, body);
      await refresh();
      setRelEdit(null);
    } catch (e: any) {
      setError(e.message);
      setIssues(e.issues || []);
    } finally {
      setBusy(false);
    }
  };

  const performDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    resetMessages();
    try {
      await api.deleteArtifact(projectId, deleteTarget.kind, deleteTarget.key);
      await refresh();
      if (deleteTarget.kind === "concept") closeConcept();
      else setRelEdit(null);
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const conceptColumns: Column<Artifact>[] = [
    {
      key: "name",
      header: "概念",
      render: (c) => (
        <span className="cell-primary">
          {c.key}
          {Array.isArray(c.body.identify_by) && c.body.identify_by.length > 0 && (
            <span className="key-badge" title="已声明标识关系">
              🔑
            </span>
          )}
        </span>
      )
    },
    {
      key: "type",
      header: "类型",
      width: "110px",
      render: (c) =>
        c.body.type === "EntityType" ? (
          <span className="badge accent" title="EntityType">
            实体
          </span>
        ) : (
          <span className="badge" title="ValueType">
            值类型
          </span>
        )
    },
    {
      key: "rels",
      header: "关系",
      width: "90px",
      render: (c) => {
        const n = rels.filter((r) => r.key.startsWith(`${c.key}.`)).length;
        return n ? (
          <span className="badge accent">{n}</span>
        ) : (
          <span className="muted">—</span>
        );
      }
    },
    {
      key: "extends",
      header: <span title="extends：继承的父概念">继承</span>,
      render: (c) =>
        c.body.extends?.length ? (
          <span className="mono">{c.body.extends.join(", ")}</span>
        ) : (
          <span className="muted">
            {c.body.type === "EntityType" ? "Any（隐式）" : "—"}
          </span>
        )
    },
    {
      key: "identify_by",
      header: (
        <span title="identify_by：唯一引用该实体所使用的关系">标识关系</span>
      ),
      width: "150px",
      render: (c) =>
        Array.isArray(c.body.identify_by) && c.body.identify_by.length ? (
          <span className="mono">{c.body.identify_by.join(", ")}</span>
        ) : (
          <span className="muted">—</span>
        )
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      align: "right",
      render: () => <span className="muted sub">详情 ›</span>
    }
  ];

  const deleteRefs = deleteTarget
    ? referencesTo(deleteTarget.kind, deleteTarget.key, working.artifacts)
    : [];

  return (
    <>
      <PageHeader
        title="本体"
        subtitle={
          <>
            {concepts.length} 个概念 · 关系归属于声明它的概念
            {ontologyIssues.length > 0 && (
              <>
                {" · "}
                {errors > 0 && <span className="error-text">{errors} 错误</span>}
                {errors > 0 && warnings > 0 && " / "}
                {warnings > 0 && <span className="warn-text">{warnings} 警告</span>}
              </>
            )}
          </>
        }
        actions={
          <button className="primary" onClick={() => openConcept("")}>
            + 新建概念
          </button>
        }
      />

      {/* Version is a capability of the model, not a separate destination. */}
      <VersionBar
        projectId={projectId}
        working={working}
        branches={version.branches}
        commits={version.commits}
        releases={version.releases}
        refresh={refresh}
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "concepts", label: "概念", count: concepts.length },
          { key: "graph", label: "图谱" },
          { key: "raw", label: "Raw" }
        ]}
      />

      {ontologyIssues.length > 0 && (
        <div className="panel panel-pad" style={{ marginBottom: 16 }}>
          <div className="panel-title">校验问题</div>
          <ul className="issues">
            {ontologyIssues.map((i, idx) => (
              <li key={idx} className={i.level}>
                [{i.level}] {i.path}: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "concepts" && (
        <div className="panel">
          <DataTable
            columns={conceptColumns}
            rows={concepts}
            rowKey={(c) => c.key}
            onRowClick={(c) => openConcept(c.key)}
            empty="还没有概念，先新建一个实体或值类型"
          />
        </div>
      )}

      {tab === "graph" && (
        <OntologyGraph
          artifacts={working.artifacts}
          onSelect={(kind, key) =>
            kind === "concept" ? openConcept(key) : openRelEditor(key)
          }
        />
      )}

      {tab === "raw" && (
        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="panel-title" style={{ margin: 0 }}>
              OSSIE 文档（YAML）
            </div>
            <span className="spacer" />
            <button
              className="sm"
              onClick={() => navigator.clipboard?.writeText(raw)}
              disabled={!raw}
            >
              复制
            </button>
          </div>
          {rawError && <div className="error-text">{rawError}</div>}
          <pre className="code-block">{raw || "加载中…"}</pre>
        </div>
      )}

      {conceptKey !== null && (
        <Modal
          wide
          title={isNewConcept ? "新建概念" : `概念 · ${conceptKey}`}
          onClose={closeConcept}
        >
          {!relEdit && error && <div className="error-text">{error}</div>}
          {!relEdit && issues.length > 0 && (
            <ul className="issues">
              {issues.map((i, idx) => (
                <li key={idx} className={i.level}>
                  [{i.level}] {i.path}: {i.message}
                </li>
              ))}
            </ul>
          )}
          <ConceptForm
            key={isNewConcept ? "concept:new" : `concept:${conceptKey}`}
            body={conceptArtifact?.body || {}}
            busy={busy}
            onSave={saveConcept}
            onDelete={
              isNewConcept
                ? undefined
                : () => setDeleteTarget({ kind: "concept", key: conceptKey })
            }
            onCancel={closeConcept}
            extraSection={
              isNewConcept ? (
                <RelSection
                  title={`该概念的关系（${draftRels.length}）—— 会随概念一起创建`}
                  rows={draftRels.map((body, i) => ({
                    id: `draft-${i}`,
                    body,
                    draftIndex: i
                  }))}
                  conceptTypes={conceptTypes}
                  busy={busy}
                  hint="概念保存后，这些关系会以其名称为前缀创建（关系标识 = 概念.关系名）。"
                  onAdd={() => {
                    resetMessages();
                    setRelEdit({ mode: "draft", index: -1 });
                  }}
                  onEdit={(r) => {
                    resetMessages();
                    setRelEdit({ mode: "draft", index: r.draftIndex! });
                  }}
                  onRemove={(r) =>
                    setDraftRels(draftRels.filter((_, j) => j !== r.draftIndex))
                  }
                />
              ) : (
                <RelSection
                  title={`该概念声明的关系（${ownedRels.length}）`}
                  rows={ownedRels}
                  conceptTypes={conceptTypes}
                  busy={busy}
                  hint="关系归属于「第一角色」所在的概念；换到别的概念声明等于换边，会反转多重性的方向。"
                  onAdd={() =>
                    openRelEditor(`${conceptKey}.new_relationship`)
                  }
                  onEdit={(r) => openRelEditor(r.id)}
                  onRemove={(r) =>
                    setDeleteTarget({
                      kind: "ontology_relationship",
                      key: r.id
                    })
                  }
                />
              )
            }
          />
        </Modal>
      )}

      {relEdit && (
        <Modal
          wide
          title={
            relEdit.mode === "draft"
              ? relEdit.index < 0
                ? "新建关系（随概念一起创建）"
                : "编辑关系（尚未保存）"
              : relEdit.creating
                ? `新建关系 · 声明于 ${relEdit.key.split(".")[0]}`
                : `编辑关系 · ${relEdit.key}`
          }
          onClose={() => setRelEdit(null)}
        >
          {error && <div className="error-text">{error}</div>}
          {issues.length > 0 && (
            <ul className="issues">
              {issues.map((i, idx) => (
                <li key={idx} className={i.level}>
                  [{i.level}] {i.path}: {i.message}
                </li>
              ))}
            </ul>
          )}
          <OntologyRelForm
            key={
              relEdit.mode === "draft"
                ? `draft:${relEdit.index}`
                : `rel:${relEdit.key}`
            }
            body={
              relEdit.mode === "draft"
                ? draftRels[relEdit.index] || { _owner: "" }
                : relArtifact?.body || { _owner: relEdit.key.split(".")[0] }
            }
            concepts={conceptNames}
            conceptTypes={conceptTypes}
            lockOwner={relEdit.mode === "draft" || isNewConcept}
            busy={busy}
            onSave={saveRel}
            onDelete={
              relEdit.mode === "persist" && relArtifact
                ? () =>
                    setDeleteTarget({
                      kind: "ontology_relationship",
                      key: relEdit.key
                    })
                : undefined
            }
            onCancel={() => setRelEdit(null)}
          />
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="确认删除"
          onClose={() => setDeleteTarget(null)}
        >
          <div>
            即将删除{" "}
            <span className="mono">
              {deleteTarget.kind === "concept" ? "概念 " : "关系 "}
              {deleteTarget.key}
            </span>
          </div>
          {deleteRefs.length > 0 ? (
            <>
              <div className="warn-text">
                检测到以下引用，删除后它们会失效：
              </div>
              <ul className="issues">
                {deleteRefs.map((r, i) => (
                  <li key={i} className="warning">
                    {r}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="muted">未检测到其他引用。</div>
          )}
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button onClick={() => setDeleteTarget(null)} disabled={busy}>
              取消
            </button>
            <button className="danger" onClick={performDelete} disabled={busy}>
              仍然删除
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
