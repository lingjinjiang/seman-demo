import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/ui";
import type { Repo } from "../types";

// The landing surface: tenant + repository management, entered through tiles.
// Modeling pages (Ontology / Semantic) are repo-scoped, so the repo is chosen
// here rather than by hunting through a top-bar dropdown.

type RepoStats = { concepts: number; datasets: number; metrics: number };

/** Tile stats are a nicety, not a requirement: load them progressively and
 *  tolerate failures / slow repos. */
const STATS_LIMIT = 12;

export function OverviewPage({
  tenant,
  tenantName,
  repos,
  createRequest,
  refresh,
  onOpen,
  onManageTenants
}: {
  tenant: string;
  tenantName: string;
  repos: Repo[];
  /** Incremented by the shell when the user heads to a modeling page with no
   *  repository yet — turns that click into the creation flow. */
  createRequest?: number;
  refresh: () => Promise<void>;
  onOpen: (repoId: string) => void;
  onManageTenants: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, RepoStats>>({});

  useEffect(() => {
    if (createRequest && createRequest > 0) setOpen(true);
  }, [createRequest]);

  useEffect(() => {
    let cancelled = false;
    const targets = repos.slice(0, STATS_LIMIT);
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
      const next: Record<string, RepoStats> = {};
      for (const r of results) {
        if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
      }
      setStats(next);
    });
    return () => {
      cancelled = true;
    };
  }, [repos]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const repo = await api.createRepo(
        name.trim(),
        description.trim() || undefined,
        tenant
      );
      setName("");
      setDescription("");
      setOpen(false);
      await refresh();
      onOpen(repo.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (repo: Repo) => {
    if (!confirm(`删除模型仓库 ${repo.name}？该操作不可恢复。`)) return;
    try {
      await api.deleteRepo(repo.id);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <PageHeader
        title="工作台"
        subtitle={
          <>
            当前租户 <strong>{tenantName}</strong>（{tenant}）· {repos.length} 个模型仓库 ·
            点击磁贴进入
          </>
        }
        actions={
          <>
            <button onClick={onManageTenants}>管理租户</button>
            <button className="primary" onClick={() => setOpen(true)}>
              + 新建模型仓库
            </button>
          </>
        }
      />

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {repos.length === 0 && (
        <div className="panel panel-pad" style={{ marginBottom: 16 }}>
          <div className="empty" style={{ padding: 20 }}>
            这个租户下还没有模型仓库。
            <div className="hint">
              一份文档 = 一个语义模型；仓库是本体与语义模型的版本与发布边界。
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => setOpen(true)}>
                + 新建模型仓库
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tile-grid">
        {repos.map((r) => {
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
          <div>新建模型仓库</div>
        </div>
      </div>

      {repos.length > STATS_LIMIT && (
        <div className="hint">
          仅前 {STATS_LIMIT} 个仓库展示统计；全部 {repos.length} 个仓库都可正常进入。
        </div>
      )}

      {open && (
        <Modal title="新建模型仓库" onClose={() => setOpen(false)}>
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
              仓库将创建在租户 {tenantName} 下，默认分支 main。
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
