import { useMemo, useState } from "react";
import { api } from "../api";
import {
  DatasetForm,
  MetricForm,
  SemanticRelForm
} from "../components/forms";
import type { Issue, WorkingView } from "../types";

export function SemanticTab({
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
  const [schema, setSchema] = useState("public");
  const [connUrl, setConnUrl] = useState("");
  const [sql, setSql] = useState<string | null>(null);
  const [deployMsg, setDeployMsg] = useState<string | null>(null);

  const datasets = useMemo(
    () => working.artifacts.filter((a) => a.kind === "dataset"),
    [working]
  );
  const srels = useMemo(
    () => working.artifacts.filter((a) => a.kind === "semantic_relationship"),
    [working]
  );
  const metrics = useMemo(
    () => working.artifacts.filter((a) => a.kind === "metric"),
    [working]
  );

  const artifact = selected
    ? working.artifacts.find(
        (a) => a.kind === selected.kind && a.key === selected.key
      )
    : undefined;
  const datasetNames = datasets.map((d) => d.key);

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

  const preview = async () => {
    setBusy(true);
    setError(null);
    setDeployMsg(null);
    try {
      const d = await api.semanticPreview(repoId, schema || "public");
      setSql(d.sql);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deploy = async () => {
    setBusy(true);
    setError(null);
    setDeployMsg(null);
    try {
      const d = await api.semanticDeploy(repoId, connUrl, schema || "public");
      setSql(d.sql);
      setDeployMsg(`部署成功：${d.statements} 条语句已应用到 PostgreSQL`);
    } catch (e: any) {
      setError(e.message);
      setSaveIssues(e.issues || []);
    } finally {
      setBusy(false);
    }
  };

  const errCount = working.issues.filter((i) => i.level === "error").length;
  const warnCount = working.issues.filter((i) => i.level === "warning").length;
  const formKey = selected ? `${selected.kind}:${selected.key}` : "none";

  return (
    <div className="grid-3">
      <div className="panel list-panel">
        <div className="muted" style={{ marginBottom: 6 }}>
          数据集（{datasets.length}）
        </div>
        {datasets.map((d) => (
          <div
            key={d.key}
            className={`list-item ${
              selected?.kind === "dataset" && selected.key === d.key ? "selected" : ""
            }`}
            onClick={() => setSelected({ kind: "dataset", key: d.key })}
          >
            <div>{d.key}</div>
            <div className="sub">
              {d.body.fields?.length || 0} 个字段
              {d.body.source ? ` · ${d.body.source}` : ""}
            </div>
          </div>
        ))}
        <button
          style={{ marginTop: 8, width: "100%" }}
          onClick={() => setSelected({ kind: "dataset", key: `dataset_${datasets.length + 1}` })}
        >
          + 新建数据集
        </button>

        <div className="muted" style={{ margin: "12px 0 6px" }}>
          关系（{srels.length}）
        </div>
        {srels.map((r) => (
          <div
            key={r.key}
            className={`list-item ${
              selected?.kind === "semantic_relationship" && selected.key === r.key
                ? "selected"
                : ""
            }`}
            onClick={() =>
              setSelected({ kind: "semantic_relationship", key: r.key })
            }
          >
            <div>{r.key}</div>
            <div className="sub">
              {r.body.from} → {r.body.to} (
              {(r.body.from_columns || []).join(",")} = {(r.body.to_columns || []).join(",")})
            </div>
          </div>
        ))}
        <button
          style={{ marginTop: 8, width: "100%" }}
          onClick={() =>
            setSelected({
              kind: "semantic_relationship",
              key: `rel_${srels.length + 1}`
            })
          }
        >
          + 新建关系
        </button>

        <div className="muted" style={{ margin: "12px 0 6px" }}>
          度量（{metrics.length}）
        </div>
        {metrics.map((m) => (
          <div
            key={m.key}
            className={`list-item ${
              selected?.kind === "metric" && selected.key === m.key ? "selected" : ""
            }`}
            onClick={() => setSelected({ kind: "metric", key: m.key })}
          >
            <div>{m.key}</div>
            <div className="sub">
              {m.body.expression?.dialects?.[0]?.expression || "无表达式"}
            </div>
          </div>
        ))}
        <button
          style={{ marginTop: 8, width: "100%" }}
          onClick={() => setSelected({ kind: "metric", key: `metric_${metrics.length + 1}` })}
        >
          + 新建度量
        </button>
      </div>

      <div className="panel" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <span className={`badge ${errCount ? "err" : "ok"}`}>{errCount} 错误</span>
          <span className={`badge ${warnCount ? "warn" : "ok"}`}>{warnCount} 警告</span>
        </div>
        {!selected && <div className="empty">选择左侧对象进行编辑，或配置右侧语义层部署</div>}
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
              {selected.kind === "dataset" && (
                <DatasetForm
                  key={formKey}
                  body={artifact?.body || {}}
                  busy={busy}
                  onSave={(key, body) => save("dataset", key, body)}
                  onDelete={() => remove("dataset", selected.key)}
                />
              )}
              {selected.kind === "semantic_relationship" && (
                <SemanticRelForm
                  key={formKey}
                  body={artifact?.body || {}}
                  datasets={datasetNames}
                  busy={busy}
                  onSave={(key, body) => save("semantic_relationship", key, body)}
                  onDelete={() => remove("semantic_relationship", selected.key)}
                />
              )}
              {selected.kind === "metric" && (
                <MetricForm
                  key={formKey}
                  body={artifact?.body || {}}
                  busy={busy}
                  onSave={(key, body) => save("metric", key, body)}
                  onDelete={() => remove("metric", selected.key)}
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}>
        <div style={{ fontWeight: 600 }}>部署语义层到 PostgreSQL</div>
        <div className="hint">
          按 Ossie semantic 规范生成 DDL：每个 dataset 一张表（主键/唯一键/外键），
          度量写入 ossie_metrics，模型快照写入 ossie_model。
        </div>
        <label>
          schema
          <input value={schema} onChange={(e) => setSchema(e.target.value)} className="mono" />
        </label>
        <label>
          PostgreSQL 连接串
          <input
            value={connUrl}
            onChange={(e) => setConnUrl(e.target.value)}
            placeholder="postgres://user:pass@host:5432/dbname"
            className="mono"
          />
        </label>
        <div className="row">
          <button onClick={preview} disabled={busy}>
            预览 DDL
          </button>
          <button
            className="primary"
            onClick={deploy}
            disabled={busy || !connUrl.trim()}
          >
            部署
          </button>
        </div>
        {deployMsg && <div className="warn-text">{deployMsg}</div>}
        {error && <div className="error-text">{error}</div>}
        {sql && (
          <>
            <div className="muted">生成的 SQL（{sql.split(";").filter((s) => s.trim()).length} 条语句）</div>
            <pre className="sql-view">{sql}</pre>
          </>
        )}
      </div>
    </div>
  );
}
