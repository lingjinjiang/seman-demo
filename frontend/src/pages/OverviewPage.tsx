import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/ui";
import type { Project } from "../types";

// The landing surface: tenant + project management, entered through tiles.
// Modeling pages (Ontology / Semantic) are project-scoped, so the project is chosen
// here rather than by hunting through a top-bar dropdown.

type ProjectStats = { concepts: number; datasets: number; metrics: number };

/** Tile stats are a nicety, not a requirement: load them progressively and
 *  tolerate failures / slow projects. */
const STATS_LIMIT = 12;

export function OverviewPage({
  tenant,
  tenantName,
  projects,
  createRequest,
  refresh,
  onOpen,
  onManageTenants,
  onOpenDataSources
}: {
  tenant: string;
  tenantName: string;
  projects: Project[];
  /** Incremented by the shell when the user heads to a modeling page with no
   *  project yet — turns that click into the creation flow. */
  createRequest?: number;
  refresh: () => Promise<void>;
  onOpen: (projectId: string) => void;
  onManageTenants: () => void;
  onOpenDataSources: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, ProjectStats>>({});
  const [dataSourceCount, setDataSourceCount] = useState<number | null>(null);
  const [hasRelease, setHasRelease] = useState(false);

  useEffect(() => {
    if (createRequest && createRequest > 0) setOpen(true);
  }, [createRequest]);

  useEffect(() => {
    let cancelled = false;
    api
      .listDataSources(tenant)
      .then((rows) => !cancelled && setDataSourceCount(rows.length))
      .catch(() => !cancelled && setDataSourceCount(null));
    return () => {
      cancelled = true;
    };
  }, [tenant]);

  // Publishing is the last step of the first-run path; checking the few most
  // recent projects is enough to drive the checklist.
  useEffect(() => {
    const targets = projects.slice(0, 3);
    if (targets.length === 0) {
      setHasRelease(false);
      return;
    }
    let cancelled = false;
    Promise.allSettled(targets.map((p) => api.listReleases(p.id))).then((rs) => {
      if (cancelled) return;
      setHasRelease(
        rs.some((r) => r.status === "fulfilled" && r.value.length > 0)
      );
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    const targets = projects.slice(0, STATS_LIMIT);
    if (targets.length === 0) {
      setStats({});
      return;
    }
    Promise.allSettled(
      targets.map(async (r) => {
        const w = await api.getWorking(r.id);
        return [
          r.id,
          {
            concepts: w.artifacts.filter((a) => a.kind === "concept").length,
            datasets: w.artifacts.filter((a) => a.kind === "dataset").length,
            metrics: w.artifacts.filter((a) => a.kind === "metric").length
          }
        ] as const;
      })
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, ProjectStats> = {};
      for (const r of results) {
        if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
      }
      setStats(next);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject(
        name.trim(),
        description.trim() || undefined,
        tenant
      );
      setName("");
      setDescription("");
      setOpen(false);
      await refresh();
      onOpen(project.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (project: Project) => {
    if (!confirm(`删除项目 ${project.name}？该操作不可恢复。`)) return;
    try {
      await api.deleteProject(project.id);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const hasArtifacts = Object.values(stats).some(
    (s) => s.concepts + s.datasets + s.metrics > 0
  );

  // First-run path: a brand-new environment should not require guessing what to
  // do next. Ordered by the dependency chain (source → project → model → release).
  const steps = [
    {
      key: "datasource",
      title: "配置数据源",
      desc: "用于把语义层部署到 PostgreSQL。选做——不配也可以先建模。",
      done: (dataSourceCount ?? 0) > 0,
      action: "去配置",
      onAction: onOpenDataSources
    },
    {
      key: "project",
      title: "创建第一个项目",
      desc: "一个项目 = 一份 OSSIE 文档 = 一个语义模型，也是版本与发布的边界。",
      done: projects.length > 0,
      action: "创建项目",
      onAction: () => setOpen(true)
    },
    {
      key: "model",
      title: "在项目里建模",
      desc: "先在本体里建概念与关系，再到语义模型里建数据集、关系与度量。",
      done: hasArtifacts,
      action: "进入项目",
      onAction: () => projects[0] && onOpen(projects[0].id),
      needsProject: true
    },
    {
      key: "release",
      title: "提交并发布",
      desc: "提交留存版本；发布决定消费方（问数 / BI / API）能读到哪一版。",
      done: hasRelease,
      action: "打开项目",
      onAction: () => projects[0] && onOpen(projects[0].id),
      needsProject: true
    }
  ];
  const allDone = steps.every((s) => s.done);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader
        title="工作台"
        subtitle={
          <>
            当前租户 <strong>{tenantName}</strong>（{tenant}）· {projects.length} 个项目 ·
            点击磁贴进入
          </>
        }
        actions={
          <>
            <button onClick={onManageTenants}>管理租户</button>
            <button className="primary" onClick={() => setOpen(true)}>
              + 新建项目
            </button>
          </>
        }
      />

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {!allDone && (
        <div className="panel panel-pad" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="panel-title" style={{ margin: 0 }}>
              开始使用
            </div>
            <span className="badge">
              {doneCount}/{steps.length}
            </span>
            <span className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>
              从全新环境开始的推荐路径
            </span>
          </div>
          <div className="steps">
            {steps.map((s, i) => (
              <div key={s.key} className={`step ${s.done ? "done" : ""}`}>
                <div className="step-mark">{s.done ? "✓" : i + 1}</div>
                <div className="step-body">
                  <div className="step-title">{s.title}</div>
                  <div className="step-desc">{s.desc}</div>
                </div>
                {!s.done && (
                  <button
                    className="sm"
                    disabled={s.needsProject && projects.length === 0}
                    onClick={s.onAction}
                  >
                    {s.action}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length === 0 && (
        <div className="panel panel-pad" style={{ marginBottom: 16 }}>
          <div className="empty" style={{ padding: 20 }}>
            这个租户下还没有项目，从上面第 2 步开始即可。
          </div>
        </div>
      )}

      <div className="tile-grid">
        {projects.map((r) => {
          const s = stats[r.id];
          return (
            <div key={r.id} className="tile" onClick={() => onOpen(r.id)}>
              <div className="tile-head">
                <span className="tile-name">{r.name}</span>
              </div>
              <div className="tile-desc">{r.description || "（无描述）"}</div>
              <div className="tile-stats">
                <span>
                  概念 <strong>{s ? s.concepts : "—"}</strong>
                </span>
                <span>
                  数据集 <strong>{s ? s.datasets : "—"}</strong>
                </span>
                <span>
                  度量 <strong>{s ? s.metrics : "—"}</strong>
                </span>
              </div>
              <div className="tile-foot">
                <span className="muted">
                  {new Date(r.updatedAt).toLocaleString()}
                </span>
                <span className="spacer" />
                <button
                  className="sm danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(r);
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          );
        })}

        <div className="tile tile-add" onClick={() => setOpen(true)}>
          <div className="tile-add-mark">＋</div>
          <div>新建项目</div>
        </div>
      </div>

      {projects.length > STATS_LIMIT && (
        <div className="hint">
          仅前 {STATS_LIMIT} 个项目展示统计；全部 {projects.length} 个项目都可正常进入。
        </div>
      )}

      {open && (
        <Modal title="新建项目" onClose={() => setOpen(false)}>
          <div className="form">
            <label>
              名称
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="retail_analytics"
              />
            </label>
            <label>
              描述
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="hint">
              项目将创建在租户 {tenantName} 下，默认分支 main。
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button onClick={() => setOpen(false)}>取消</button>
              <button
                className="primary"
                disabled={busy || !name.trim()}
                onClick={create}
              >
                创建
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
