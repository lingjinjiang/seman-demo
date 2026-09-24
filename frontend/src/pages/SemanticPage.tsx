import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  DatasetForm,
  MetricForm,
  SemanticRelForm
} from "../components/forms";
import { Modal } from "../components/Modal";
import { DataTable, PageHeader, Tabs, type Column } from "../components/ui";
import { VersionBar } from "../components/VersionBar";
import type {
  Artifact,
  Binding,
  DataSource,
  Issue,
  ProjectVersion
} from "../types";

/** Environments a project can be bound to (mirrors the backend `ENVIRONMENTS`). */
const ENVIRONMENTS = ["dev", "test", "prod"];

type TabKey = "datasets" | "relationships" | "metrics" | "ddl" | "raw";

const KINDS: Record<string, string> = {
  datasets: "dataset",
  relationships: "semantic_relationship",
  metrics: "metric"
};

/** What would break if this artifact disappeared — shown before deleting. */
function referencesTo(kind: string, key: string, artifacts: Artifact[]): string[] {
  const out: string[] = [];
  if (kind === "dataset") {
    for (const r of artifacts.filter((a) => a.kind === "semantic_relationship")) {
      if (r.body.from === key) out.push(`关系 ${r.key} 以它为 from`);
      if (r.body.to === key) out.push(`关系 ${r.key} 以它为 to`);
    }
    for (const m of artifacts.filter((a) => a.kind === "metric")) {
      const text = JSON.stringify(m.body.expression || {});
      if (text.includes(`${key}.`)) {
        out.push(`度量 ${m.key} 的表达式引用了 ${key}.*`);
      }
    }
  }
  return Array.from(new Set(out));
}

export function SemanticPage({
  version,
  tenant,
  refresh
}: {
  version: ProjectVersion;
  tenant: string;
  refresh: () => Promise<void>;
}) {
  const { projectId, working } = version;
  const [tab, setTab] = useState<TabKey>("datasets");
  const [editing, setEditing] = useState<{ kind: string; key: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: string;
    key: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [schema, setSchema] = useState("public");
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [bindingEdit, setBindingEdit] = useState<string | null>(null);
  const [bindingForm, setBindingForm] = useState({
    connectionId: "",
    namespace: ""
  });
  const [deployEnv, setDeployEnv] = useState("dev");
  const [ddl, setDdl] = useState<string>("");
  const [raw, setRaw] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  const datasets = useMemo(
    () => working.artifacts.filter((a) => a.kind === "dataset"),
    [working]
  );
  const rels = useMemo(
    () => working.artifacts.filter((a) => a.kind === "semantic_relationship"),
    [working]
  );
  const metrics = useMemo(
    () => working.artifacts.filter((a) => a.kind === "metric"),
    [working]
  );
  const datasetNames = datasets.map((d) => d.key);

  const semanticIssues = working.issues.filter((i) =>
    i.path.startsWith("semantic")
  );

  useEffect(() => {
    api
      .listDataSources(tenant)
      .then(setSources)
      .catch(() => setSources([]));
  }, [tenant]);

  const loadBindings = useCallback(async () => {
    try {
      setBindings(await api.listBindings(projectId));
    } catch {
      setBindings([]);
    }
  }, [projectId]);

  useEffect(() => {
    loadBindings();
  }, [loadBindings]);

  useEffect(() => {
    if (tab !== "raw") return;
    let cancelled = false;
    api
      .exportYaml(projectId)
      .then((text) => !cancelled && setRaw(text))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab, projectId, working]);

  const openEditor = (kind: string, key: string) => {
    setError(null);
    setIssues([]);
    setEditing({ kind, key });
  };

  const save = async (kind: string, key: string, body: any) => {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      await api.upsertArtifact(projectId, kind, key, body);
      await refresh();
      setEditing(null);
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
    setError(null);
    try {
      await api.deleteArtifact(projectId, deleteTarget.kind, deleteTarget.key);
      await refresh();
      setEditing(null);
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const previewDdl = async () => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const out = await api.semanticPreview(projectId, schema);
      setDdl(out.sql);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const bindingByEnv = useMemo(() => {
    const map: Record<string, Binding> = {};
    for (const b of bindings) map[b.environment] = b;
    return map;
  }, [bindings]);

  const connectionName = (id: string) =>
    sources.find((s) => s.id === id)?.name || id.slice(0, 8);

  const openBindingEditor = (environment: string) => {
    const existing = bindingByEnv[environment];
    setBindingForm({
      connectionId: existing?.connectionId || sources[0]?.id || "",
      namespace: existing?.namespace || ""
    });
    setError(null);
    setBindingEdit(environment);
  };

  const saveBinding = async () => {
    if (!bindingEdit) return;
    if (!bindingForm.connectionId) {
      setError("请先在「数据源」页面注册一个 PostgreSQL 连接");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.putBinding(projectId, bindingEdit, {
        connectionId: bindingForm.connectionId,
        namespace: bindingForm.namespace.trim()
      });
      await loadBindings();
      setBindingEdit(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeBinding = async (environment: string) => {
    if (!confirm(`解除环境 ${environment} 的绑定？`)) return;
    setBusy(true);
    try {
      await api.deleteBinding(projectId, environment);
      await loadBindings();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  /** Deploy through the environment's binding — coordinates and credential come
   *  from the platform, never from the request. */
  const deployByBinding = async (environment: string) => {
    const binding = bindingByEnv[environment];
    if (!binding) {
      setError(`环境 ${environment} 还没有绑定，先配置绑定`);
      return;
    }
    if (
      !confirm(
        `将语义层部署到 ${environment}？\n连接：${connectionName(
          binding.connectionId
        )}\n命名空间：${binding.namespace}`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const out = await api.semanticDeployToBinding(projectId, environment);
      setDdl(out.sql);
      setNotice(`已部署到 ${environment}，执行 ${out.statements} 条语句`);
    } catch (e: any) {
      setError(e.message);
      setIssues(e.issues || []);
    } finally {
      setBusy(false);
    }
  };

  const datasetColumns: Column<Artifact>[] = [
    {
      key: "name",
      header: "数据集",
      render: (d) => <span className="cell-primary">{d.key}</span>
    },
    {
      key: "source",
      header: "source（逻辑名）",
      render: (d) =>
        d.body.source ? (
          <span className="mono">{d.body.source}</span>
        ) : (
          <span className="badge warn">未绑定</span>
        )
    },
    {
      key: "primary_key",
      header: "主键",
      width: "150px",
      render: (d) =>
        Array.isArray(d.body.primary_key) && d.body.primary_key.length ? (
          <span className="mono">{d.body.primary_key.join(", ")}</span>
        ) : (
          <span className="muted">—</span>
        )
    },
    {
      key: "fields",
      header: "字段",
      width: "70px",
      align: "right",
      render: (d) => (Array.isArray(d.body.fields) ? d.body.fields.length : 0)
    },
    {
      key: "description",
      header: "描述",
      render: (d) => <span className="sub">{d.body.description || "—"}</span>
    },
    {
      key: "actions",
      header: "",
      width: "120px",
      align: "right",
      render: (d) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          <button className="sm" onClick={() => openEditor("dataset", d.key)}>
            编辑
          </button>{" "}
          <button
            className="sm danger"
            disabled={busy}
            onClick={() => setDeleteTarget({ kind: "dataset", key: d.key })}
          >
            删除
          </button>
        </span>
      )
    }
  ];

  const relColumns: Column<Artifact>[] = [
    {
      key: "name",
      header: "关系",
      render: (r) => <span className="cell-primary">{r.key}</span>
    },
    { key: "from", header: "from", render: (r) => <span className="mono">{r.body.from}</span> },
    { key: "to", header: "to", render: (r) => <span className="mono">{r.body.to}</span> },
    {
      key: "columns",
      header: "join 条件",
      render: (r) => (
        <span className="mono">
          {[...(r.body.from_columns || [])].join(", ")} ={" "}
          {[...(r.body.to_columns || [])].join(", ")}
        </span>
      )
    },
    {
      key: "actions",
      header: "",
      width: "120px",
      align: "right",
      render: (r) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="sm"
            onClick={() => openEditor("semantic_relationship", r.key)}
          >
            编辑
          </button>{" "}
          <button
            className="sm danger"
            disabled={busy}
            onClick={() => setDeleteTarget({ kind: "semantic_relationship", key: r.key })}
          >
            删除
          </button>
        </span>
      )
    }
  ];

  const metricColumns: Column<Artifact>[] = [
    {
      key: "name",
      header: "度量",
      render: (m) => <span className="cell-primary">{m.key}</span>
    },
    {
      key: "datatype",
      header: "datatype",
      width: "120px",
      render: (m) =>
        m.body.datatype ? (
          <span className="badge">{m.body.datatype}</span>
        ) : (
          <span className="muted">—</span>
        )
    },
    {
      key: "dialects",
      header: "表达式（方言数）",
      width: "140px",
      render: (m) => m.body.expression?.dialects?.length ?? 0
    },
    {
      key: "expression",
      header: "ANSI_SQL 表达式",
      render: (m) => {
        const ansi = m.body.expression?.dialects?.find(
          (d: any) => d.dialect === "ANSI_SQL"
        );
        return (
          <span className="mono sub">
            {ansi?.expression || m.body.expression?.dialects?.[0]?.expression || "—"}
          </span>
        );
      }
    },
    {
      key: "actions",
      header: "",
      width: "120px",
      align: "right",
      render: (m) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          <button className="sm" onClick={() => openEditor("metric", m.key)}>
            编辑
          </button>{" "}
          <button
            className="sm danger"
            disabled={busy}
            onClick={() => setDeleteTarget({ kind: "metric", key: m.key })}
          >
            删除
          </button>
        </span>
      )
    }
  ];

  const artifact = editing
    ? working.artifacts.find(
        (a) => a.kind === editing.kind && a.key === editing.key
      )
    : undefined;

  const newKeyFor = (tabKey: TabKey) => {
    switch (tabKey) {
      case "datasets":
        return `new_dataset_${datasets.length + 1}`;
      case "relationships":
        return `new_relationship_${rels.length + 1}`;
      default:
        return `new_metric_${metrics.length + 1}`;
    }
  };

  const addButton = () => {
    if (tab === "datasets" || tab === "relationships" || tab === "metrics") {
      const label =
        tab === "datasets"
          ? "+ 新建数据集"
          : tab === "relationships"
            ? "+ 新建关系"
            : "+ 新建度量";
      return (
        <button className="primary" onClick={() => openEditor(KINDS[tab], newKeyFor(tab))}>
          {label}
        </button>
      );
    }
    return null;
  };

  return (
    <>
      <PageHeader
        title="语义模型"
        subtitle={
          <>
            {datasets.length} 个数据集 · {rels.length} 个关系 · {metrics.length} 个度量
            {semanticIssues.length > 0 && (
              <span className="muted"> · {semanticIssues.length} 条校验提示</span>
            )}
          </>
        }
        actions={addButton()}
      />

      {/* Same project history as the Ontology page — version spans both
          sections of the document (design-ouline §1.5 规则 1). */}
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
          { key: "datasets", label: "数据集", count: datasets.length },
          { key: "relationships", label: "关系", count: rels.length },
          { key: "metrics", label: "度量", count: metrics.length },
          { key: "ddl", label: "DDL / 部署" },
          { key: "raw", label: "Raw" }
        ]}
      />

      {semanticIssues.length > 0 && (tab === "datasets" || tab === "relationships" || tab === "metrics") && (
        <div className="panel panel-pad" style={{ marginBottom: 16 }}>
          <div className="panel-title">校验问题</div>
          <ul className="issues">
            {semanticIssues.map((i, idx) => (
              <li key={idx} className={i.level}>
                [{i.level}] {i.path}: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "datasets" && (
        <div className="panel">
          <DataTable
            columns={datasetColumns}
            rows={datasets}
            rowKey={(d) => d.key}
            onRowClick={(d) => openEditor("dataset", d.key)}
            empty="还没有数据集；source 只写逻辑名（如 sales.public.orders）"
          />
        </div>
      )}

      {tab === "relationships" && (
        <div className="panel">
          <DataTable
            columns={relColumns}
            rows={rels}
            rowKey={(r) => r.key}
            onRowClick={(r) => openEditor("semantic_relationship", r.key)}
            empty="还没有数据集关系（等值 join，不要求真实外键）"
          />
        </div>
      )}

      {tab === "metrics" && (
        <div className="panel">
          <DataTable
            columns={metricColumns}
            rows={metrics}
            rowKey={(m) => m.key}
            onRowClick={(m) => openEditor("metric", m.key)}
            empty="还没有度量"
          />
        </div>
      )}

      {tab === "ddl" && (
        <div className="stack">
          {/* Binding: the only data-access config that differs per project.
              The connection itself is tenant-level and shared. */}
          <div className="panel panel-pad">
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="panel-title" style={{ margin: 0 }}>
                环境绑定
              </div>
              <span
                className="badge warn"
                title="绑定粒度仍在调整中：凭证尚未独立，逐表覆盖未实现"
              >
                试验性
              </span>
              <span className="spacer" />
              <span className="hint" style={{ margin: 0 }}>
                连接是租户级资产（一份库被多个项目共用）；命名空间按项目区分
              </span>
            </div>
            <DataTable
              columns={[
                {
                  key: "environment",
                  header: "环境",
                  width: "110px",
                  render: (row) => <span className="badge">{row.environment}</span>
                },
                {
                  key: "connection",
                  header: "连接",
                  render: (row) =>
                    row.binding ? (
                      <span className="mono">
                        {connectionName(row.binding.connectionId)}
                      </span>
                    ) : (
                      <span className="muted">未绑定</span>
                    )
                },
                {
                  key: "namespace",
                  header: "命名空间",
                  width: "160px",
                  render: (row) =>
                    row.binding ? (
                      <span className="mono">{row.binding.namespace}</span>
                    ) : (
                      <span className="muted">—</span>
                    )
                },
                {
                  key: "actions",
                  header: "",
                  width: "160px",
                  align: "right",
                  render: (row) => (
                    <span
                      className="cell-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="sm"
                        onClick={() => openBindingEditor(row.environment)}
                      >
                        {row.binding ? "编辑" : "绑定"}
                      </button>{" "}
                      {row.binding && (
                        <button
                          className="sm danger"
                          disabled={busy}
                          onClick={() => removeBinding(row.environment)}
                        >
                          解除
                        </button>
                      )}
                    </span>
                  )
                }
              ]}
              rows={ENVIRONMENTS.map((environment) => ({
                environment,
                binding: bindingByEnv[environment]
              }))}
              rowKey={(row) => row.environment}
            />
          </div>

          <div className="panel panel-pad">
            <div className="panel-title">生成与部署</div>
            <div className="split">
              <label>
                目标环境
                <select
                  value={deployEnv}
                  onChange={(e) => {
                    setDeployEnv(e.target.value);
                    const b = bindingByEnv[e.target.value];
                    if (b) setSchema(b.namespace);
                  }}
                >
                  {ENVIRONMENTS.map((env) => (
                    <option key={env} value={env}>
                      {env}
                      {bindingByEnv[env] ? "" : "（未绑定）"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                该环境的命名空间（来自绑定）
                <input
                  value={bindingByEnv[deployEnv]?.namespace || ""}
                  readOnly
                  placeholder="未绑定"
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={previewDdl} disabled={busy}>
                生成 DDL 预览
              </button>
              <button
                className="primary"
                onClick={() => deployByBinding(deployEnv)}
                disabled={busy || !bindingByEnv[deployEnv]}
              >
                部署到 {deployEnv}
              </button>
              {!bindingByEnv[deployEnv] && (
                <span className="hint" style={{ margin: 0 }}>
                  该环境还没有绑定，先在上面的「环境绑定」里配置
                </span>
              )}
            </div>
            {notice && <div className="ok-text" style={{ marginTop: 8 }}>{notice}</div>}
            {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
          </div>
          <div className="panel panel-pad">
            <div className="panel-title">DDL 预览</div>
            <pre className="sql-view">{ddl || "点击「生成 DDL 预览」"}</pre>
          </div>
        </div>
      )}

      {tab === "raw" && (
        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="panel-title" style={{ margin: 0 }}>
              OSSIE 文档（YAML，含 ontology 与 semantic_model）
            </div>
            <span className="spacer" />
            <button
              className="sm"
              disabled={!raw}
              onClick={() => navigator.clipboard?.writeText(raw)}
            >
              复制
            </button>
          </div>
          <pre className="code-block">{raw || "加载中…"}</pre>
        </div>
      )}

      {editing && (
        <Modal
          wide
          title={
            artifact
              ? `编辑 ${editing.key}`
              : editing.kind === "dataset"
                ? "新建数据集"
                : editing.kind === "semantic_relationship"
                  ? "新建数据集关系"
                  : "新建度量"
          }
          onClose={() => setEditing(null)}
        >
          {error && editing && <div className="error-text">{error}</div>}
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
            {editing.kind === "dataset" && (
              <DatasetForm
                key={`${editing.kind}:${editing.key}`}
                body={artifact?.body || {}}
                busy={busy}
                onSave={(key, body) => save("dataset", key, body)}
                onDelete={artifact ? () => setDeleteTarget({ kind: "dataset", key: editing.key }) : undefined}
                onCancel={() => setEditing(null)}
              />
            )}
            {editing.kind === "semantic_relationship" && (
              <SemanticRelForm
                key={`${editing.kind}:${editing.key}`}
                body={artifact?.body || {}}
                datasets={datasetNames}
                busy={busy}
                onSave={(key, body) => save("semantic_relationship", key, body)}
                onDelete={
                  artifact
                    ? () => setDeleteTarget({ kind: "semantic_relationship", key: editing.key })
                    : undefined
                }
                onCancel={() => setEditing(null)}
              />
            )}
            {editing.kind === "metric" && (
              <MetricForm
                key={`${editing.kind}:${editing.key}`}
                body={artifact?.body || {}}
                busy={busy}
                onSave={(key, body) => save("metric", key, body)}
                onDelete={artifact ? () => setDeleteTarget({ kind: "metric", key: editing.key }) : undefined}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        </Modal>
      )}

      {bindingEdit && (
        <Modal
          title={`环境绑定 · ${bindingEdit}`}
          onClose={() => setBindingEdit(null)}
        >
          <div className="form">
            <div className="hint" style={{ margin: 0 }}>
              连接是租户级资产，一份库可以被多个项目共用；这里只决定
              <strong> 本项目在 {bindingEdit} 环境下用哪个连接、落在哪个命名空间</strong>。
              <br />
              ⚠️ 试验性：凭证目前随连接，逐表覆盖尚未实现。
            </div>
            <label>
              连接（PostgreSQL）
              <select
                value={bindingForm.connectionId}
                onChange={(e) =>
                  setBindingForm({ ...bindingForm, connectionId: e.target.value })
                }
              >
                <option value="">选择连接</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{s.host}:{s.port}/{s.database}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              命名空间（默认 schema）
              <input
                value={bindingForm.namespace}
                placeholder="留空则用连接的默认 schema"
                onChange={(e) =>
                  setBindingForm({ ...bindingForm, namespace: e.target.value })
                }
              />
            </label>
            {sources.length === 0 && (
              <div className="warn-text">
                还没有连接，请先到「数据源」页面注册一个 PostgreSQL 连接。
              </div>
            )}
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button onClick={() => setBindingEdit(null)} disabled={busy}>
                取消
              </button>
              <button
                className="primary"
                onClick={saveBinding}
                disabled={busy || !bindingForm.connectionId}
              >
                保存绑定
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="确认删除" onClose={() => setDeleteTarget(null)}>
          <div>
            即将删除{" "}
            <span className="mono">
              {deleteTarget.kind} {deleteTarget.key}
            </span>
          </div>
          {(() => {
            const refs = referencesTo(
              deleteTarget.kind,
              deleteTarget.key,
              working.artifacts
            );
            if (refs.length === 0) {
              return <div className="muted">未检测到其他引用。</div>;
            }
            return (
              <>
                <div className="warn-text">检测到以下引用，删除后它们会失效：</div>
                <ul className="issues">
                  {refs.map((r, i) => (
                    <li key={i} className="warning">
                      {r}
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
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
