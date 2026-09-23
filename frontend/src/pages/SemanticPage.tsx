import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  DatasetForm,
  MetricForm,
  SemanticRelForm
} from "../components/forms";
import { Modal } from "../components/Modal";
import { DataTable, PageHeader, Tabs, type Column } from "../components/ui";
import type { Artifact, DataSource, Issue, WorkingView } from "../types";

type TabKey = "datasets" | "relationships" | "metrics" | "ddl" | "raw";

const KINDS: Record<string, string> = {
  datasets: "dataset",
  relationships: "semantic_relationship",
  metrics: "metric"
};

export function SemanticPage({
  repoId,
  tenant,
  working,
  refresh
}: {
  repoId: string;
  tenant: string;
  working: WorkingView;
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<TabKey>("datasets");
  const [editing, setEditing] = useState<{ kind: string; key: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sources, setSources] = useState<DataSource[]>([]);
  const [schema, setSchema] = useState("public");
  const [sourceId, setSourceId] = useState("");
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
      .then((rows) => {
        setSources(rows);
        setSourceId((current) => current || rows[0]?.id || "");
      })
      .catch(() => setSources([]));
  }, [tenant]);

  useEffect(() => {
    if (tab !== "raw") return;
    let cancelled = false;
    api
      .exportYaml(repoId)
      .then((text) => !cancelled && setRaw(text))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab, repoId, working]);

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
      await api.upsertArtifact(repoId, kind, key, body);
      await refresh();
      setEditing(null);
    } catch (e: any) {
      setError(e.message);
      setIssues(e.issues || []);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (kind: string, key: string) => {
    if (!confirm(`删除 ${kind}:${key}？`)) return;
    setBusy(true);
    try {
      await api.deleteArtifact(repoId, kind, key);
      await refresh();
      setEditing(null);
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
      const out = await api.semanticPreview(repoId, schema);
      setDdl(out.sql);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deploy = async () => {
    if (!sourceId) {
      setError("请先在「数据源」页面注册一个 PostgreSQL 数据源");
      return;
    }
    if (!confirm(`将语义层部署到所选数据源的 schema「${schema}」？`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const out = await api.semanticDeployToSource(repoId, sourceId, schema);
      setDdl(out.sql);
      setNotice(`部署完成，执行 ${out.statements} 条语句`);
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
            onClick={() => remove("dataset", d.key)}
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
            onClick={() => remove("semantic_relationship", r.key)}
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
            onClick={() => remove("metric", m.key)}
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
          <div className="panel panel-pad">
            <div className="panel-title">生成与部署</div>
            <div className="split">
              <label>
                目标 schema
                <input value={schema} onChange={(e) => setSchema(e.target.value)} />
              </label>
              <label>
                目标数据源（PostgreSQL）
                <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                  <option value="">未选择</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}（{s.host}:{s.port}/{s.database}）
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={previewDdl} disabled={busy}>
                生成 DDL 预览
              </button>
              <button className="primary" onClick={deploy} disabled={busy}>
                部署到数据源
              </button>
              {sources.length === 0 && (
                <span className="hint" style={{ margin: 0 }}>
                  尚无数据源，请先在「数据源」页面注册
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
                onDelete={artifact ? () => remove("dataset", editing.key) : undefined}
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
                    ? () => remove("semantic_relationship", editing.key)
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
                onDelete={artifact ? () => remove("metric", editing.key) : undefined}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
