import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ConceptForm, OntologyRelForm } from "../components/forms";
import { Modal } from "../components/Modal";
import { OntologyGraph } from "../components/OntologyGraph";
import { DataTable, PageHeader, Tabs, type Column } from "../components/ui";
import type { Artifact, Issue, WorkingView } from "../types";

// Information architecture follows the ontology spec
// (../ossie/ontology/ontology.md): an ontology groups *each relationship under
// the concept that plays its first role*. Relationships are therefore not a
// peer of concepts — they are a property of the concept that declares them, and
// are only ever managed from inside a concept.

type TabKey = "concepts" | "graph" | "raw";

function rolesOf(body: any): { concept: string; name?: string }[] {
  return Array.isArray(body.roles) ? body.roles : [];
}

function arityLabel(body: any): string {
  const n = 1 + rolesOf(body).length;
  return n === 1 ? "一元" : n === 2 ? "二元" : `${n} 元`;
}

export function OntologyPage({
  repoId,
  working,
  refresh
}: {
  repoId: string;
  working: WorkingView;
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<TabKey>("concepts");
  // The concept whose detail (definition + its relationships) is open.
  const [conceptKey, setConceptKey] = useState<string | null>(null);
  // The relationship being edited; `creating` distinguishes new from existing.
  const [relEdit, setRelEdit] = useState<{ key: string; creating: boolean } | null>(
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

  const ontologyIssues = working.issues.filter((i) =>
    i.path.startsWith("ontology")
  );
  const errors = ontologyIssues.filter((i) => i.level === "error").length;
  const warnings = ontologyIssues.length - errors;

  const conceptArtifact = conceptKey
    ? working.artifacts.find(
        (a) => a.kind === "concept" && a.key === conceptKey
      )
    : undefined;

  // Relationships declared under the open concept — its own property list.
  const ownedRels = useMemo(() => {
    if (!conceptKey || !conceptArtifact) return [];
    return rels.filter((r) => r.key.startsWith(`${conceptKey}.`));
  }, [rels, conceptKey, conceptArtifact]);

  const relArtifact = relEdit
    ? working.artifacts.find(
        (a) => a.kind === "ontology_relationship" && a.key === relEdit.key
      )
    : undefined;

  useEffect(() => {
    if (tab !== "raw") return;
    let cancelled = false;
    setRawError(null);
    api
      .exportYaml(repoId)
      .then((text) => !cancelled && setRaw(text))
      .catch((e: any) => !cancelled && setRawError(e.message));
    return () => {
      cancelled = true;
    };
  }, [tab, repoId, working]);

  const resetMessages = () => {
    setError(null);
    setIssues([]);
  };

  const openConcept = (key: string) => {
    resetMessages();
    setRelEdit(null);
    setConceptKey(key);
  };

  const openRelEditor = (key: string) => {
    resetMessages();
    setRelEdit({ key, creating: !working.artifacts.some(
      (a) => a.kind === "ontology_relationship" && a.key === key
    ) });
  };

  const saveConcept = async (key: string, body: any) => {
    const renaming = !!conceptKey && key !== conceptKey;
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
      await api.upsertArtifact(repoId, "concept", key, body);
      await refresh();
      setConceptKey(key);
    } catch (e: any) {
      setError(e.message);
      setIssues(e.issues || []);
    } finally {
      setBusy(false);
    }
  };

  const saveRel = async (key: string, body: any) => {
    setBusy(true);
    resetMessages();
    try {
      await api.upsertArtifact(repoId, "ontology_relationship", key, body);
      await refresh();
      setRelEdit(null);
    } catch (e: any) {
      setError(e.message);
      setIssues(e.issues || []);
    } finally {
      setBusy(false);
    }
  };

  const deleteArtifact = async (kind: string, key: string) => {
    if (!confirm(`删除 ${kind}:${key}？`)) return;
    setBusy(true);
    resetMessages();
    try {
      await api.deleteArtifact(repoId, kind, key);
      await refresh();
      if (kind === "concept") {
        setConceptKey(null);
      } else {
        setRelEdit(null);
      }
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
            <span className="key-badge" title="identify_by">
              🔑
            </span>
          )}
        </span>
      )
    },
    {
      key: "type",
      header: "类型",
      width: "120px",
      render: (c) =>
        c.body.type === "EntityType" ? (
          <span className="badge accent">EntityType</span>
        ) : (
          <span className="badge">ValueType</span>
        )
    },
    {
      key: "extends",
      header: "继承（extends）",
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
      header: "identify_by",
      width: "140px",
      render: (c) =>
        Array.isArray(c.body.identify_by) && c.body.identify_by.length ? (
          <span className="mono">{c.body.identify_by.join(", ")}</span>
        ) : (
          <span className="muted">—</span>
        )
    },
    {
      key: "rels",
      header: "关系",
      width: "90px",
      align: "right",
      render: (c) => (
        <span className="badge">
          {rels.filter((r) => r.key.startsWith(`${c.key}.`)).length}
        </span>
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

  const relColumns: Column<Artifact>[] = [
    {
      key: "name",
      header: "关系名",
      render: (r) => (
        <span className="cell-primary">{r.key.slice(r.key.indexOf(".") + 1)}</span>
      )
    },
    {
      key: "arity",
      header: "元数",
      width: "80px",
      render: (r) => arityLabel(r.body)
    },
    {
      key: "roles",
      header: "其他角色（#2 …）",
      render: (r) => {
        const roles = rolesOf(r.body);
        if (roles.length === 0) return <span className="badge">一元事实</span>;
        return (
          <span className="mono">
            {roles
              .map((x) => (x.name ? `${x.concept}(${x.name})` : x.concept))
              .join(" → ")}
          </span>
        );
      }
    },
    {
      key: "multiplicity",
      header: "多重性",
      width: "130px",
      render: (r) =>
        r.body.multiplicity ? (
          <span className="badge accent">{r.body.multiplicity}</span>
        ) : (
          <span className="muted">未约束</span>
        )
    },
    {
      key: "verbalizes",
      header: "verbalizes",
      render: (r) => (
        <span className="sub">
          {Array.isArray(r.body.verbalizes) ? r.body.verbalizes[0] : "—"}
        </span>
      )
    },
    {
      key: "actions",
      header: "",
      width: "80px",
      align: "right",
      render: (r) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="sm danger"
            disabled={busy}
            onClick={() => deleteArtifact("ontology_relationship", r.key)}
          >
            删除
          </button>
        </span>
      )
    }
  ];

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
          title={conceptArtifact ? `概念 · ${conceptKey}` : "新建概念"}
          onClose={() => {
            setConceptKey(null);
            setRelEdit(null);
          }}
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
          <div className="form">
            <ConceptForm
              key={`concept:${conceptKey}`}
              body={conceptArtifact?.body || {}}
              busy={busy}
              onSave={saveConcept}
              onDelete={
                conceptArtifact
                  ? () => deleteArtifact("concept", conceptKey)
                  : undefined
              }
              onCancel={() => setConceptKey(null)}
            />
          </div>

          {/* Relationships are a property of the concept, so they live here. */}
          {conceptArtifact && (
            <div className="rel-section">
              <div className="row" style={{ marginBottom: 8 }}>
                <div className="panel-title" style={{ margin: 0 }}>
                  该概念声明的关系（{ownedRels.length}）
                </div>
                <span className="spacer" />
                <button
                  className="sm"
                  onClick={() =>
                    openRelEditor(`${conceptKey}.new_relationship`)
                  }
                >
                  + 新建关系
                </button>
              </div>
              <DataTable
                columns={relColumns}
                rows={ownedRels}
                rowKey={(r) => r.key}
                onRowClick={(r) => openRelEditor(r.key)}
                empty="该概念还没有声明关系"
              />
              <div className="hint">
                关系按 ontology 规范归属于「第一角色」所在的概念；
                换到别的概念声明等于换边，会反转 multiplicity 的方向。
              </div>
            </div>
          )}
        </Modal>
      )}

      {relEdit && (
        <Modal
          wide
          title={
            relEdit.creating
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
          <div className="form">
            <OntologyRelForm
              key={`rel:${relEdit.key}`}
              body={
                relArtifact?.body || { _owner: relEdit.key.split(".")[0] }
              }
              concepts={conceptNames}
              busy={busy}
              onSave={saveRel}
              onDelete={
                relArtifact ? () => deleteArtifact("ontology_relationship", relEdit.key) : undefined
              }
              onCancel={() => setRelEdit(null)}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
