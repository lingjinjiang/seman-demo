import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Modal } from "./Modal";
import { DataTable, type Column } from "./ui";
import type { Branch, Change, Commit, Release, WorkingView } from "../types";

// The version capability, embedded in the Ontology and Semantic pages rather
// than living in its own navigation slot (design-ouline §1.5):
//   working tree (draft) → commit → release (commit x environment) → consumers.
// Publishing is the only boundary consumers cross.

const ENVIRONMENTS = ["dev", "test", "prod"] as const;
type Environment = (typeof ENVIRONMENTS)[number];

function statusBadge(status: Change["status"]) {
  const cls = status === "added" ? "ok" : status === "removed" ? "err" : "warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function VersionBar({
  repoId,
  working,
  branches,
  commits,
  releases,
  refresh
}: {
  repoId: string;
  working: WorkingView;
  branches: Branch[];
  commits: Commit[];
  releases: Release[];
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState<null | "commit" | "history" | "publish">(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadChanges = async () => {
    try {
      setChanges(await api.changes(repoId));
    } catch {
      /* surfaced through the page-level error banner */
    }
  };

  useEffect(() => {
    loadChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, commits.length]);

  const latestByEnv = useMemo(() => {
    const map = new Map<string, Release>();
    for (const r of releases) {
      if (!map.has(r.environment)) map.set(r.environment, r);
    }
    return map;
  }, [releases]);

  const head = working.branch.headCommitId;
  const prodRelease = latestByEnv.get("prod");
  const prodBehind = !!prodRelease && prodRelease.commitId !== head;

  const exportYaml = async () => {
    try {
      const text = await api.exportYaml(repoId);
      const blob = new Blob([text], { type: "application/x-yaml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${working.repo.name}.ossie.yaml`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const content = await file.text();
      const format = file.name.endsWith(".json") ? "json" : "yaml";
      const out = await api.importDoc(repoId, format, content);
      setNotice(`已导入 ${out.imported} 个工件`);
      await refresh();
      await loadChanges();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <div className="version-bar">
        <div className="row">
          <span className="muted">分支</span>
          <select
            value={working.branch.id}
            onChange={async (e) => {
              setBusy(true);
              try {
                await api.checkoutBranch(repoId, e.target.value);
                await refresh();
              } catch (err: any) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className={`badge ${changes.length ? "warn" : "ok"}`}>
            {changes.length ? `${changes.length} 处未提交更改` : "工作区干净"}
          </span>
          <span className="spacer" />
          <button className="primary sm" onClick={() => setOpen("commit")}>
            提交
          </button>
          <button className="sm" onClick={() => setOpen("history")}>
            历史
          </button>
          <button className="sm" onClick={() => setOpen("publish")}>
            发布
          </button>
          <button className="sm" onClick={exportYaml}>
            导出
          </button>
          <button
            className="sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".yaml,.yml,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
            }}
          />
        </div>

        <div className="version-release">
          {prodRelease ? (
            <>
              <span className="badge accent">prod</span>
              <span className="mono">{prodRelease.commitId.slice(0, 8)}</span>
              <span className="muted">
                {prodRelease.author} ·{" "}
                {new Date(prodRelease.createdAt).toLocaleString()}
              </span>
              {prodBehind ? (
                <span className="badge warn">有未发布内容</span>
              ) : (
                <span className="badge ok">已是最新</span>
              )}
            </>
          ) : (
            <span className="badge warn">尚未发布到 prod</span>
          )}
          {(["dev", "test"] as Environment[]).map((env) => {
            const r = latestByEnv.get(env);
            if (!r) return null;
            return (
              <span key={env} className="muted">
                {env} @ <span className="mono">{r.commitId.slice(0, 8)}</span>
              </span>
            );
          })}
          <span className="spacer" />
          <span className="hint" style={{ margin: 0 }}>
            消费方只读已发布版本
          </span>
        </div>

        {notice && <div className="ok-text">{notice}</div>}
        {error && <div className="error-text">{error}</div>}
      </div>

      {open === "commit" && (
        <CommitModal
          repoId={repoId}
          changes={changes}
          defaultAuthor={localStorage.getItem("ossie.author") || "developer"}
          onClose={() => setOpen(null)}
          onDone={async () => {
            setOpen(null);
            await refresh();
            await loadChanges();
          }}
        />
      )}

      {open === "publish" && (
        <PublishModal
          repoId={repoId}
          head={head}
          releases={releases}
          defaultAuthor={localStorage.getItem("ossie.author") || "developer"}
          onClose={() => setOpen(null)}
          onDone={async () => {
            setOpen(null);
            await refresh();
          }}
        />
      )}

      {open === "history" && (
        <HistoryModal
          repoId={repoId}
          working={working}
          branches={branches}
          commits={commits}
          releases={releases}
          changes={changes}
          refresh={refresh}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

function CommitModal({
  repoId,
  changes,
  defaultAuthor,
  onClose,
  onDone
}: {
  repoId: string;
  changes: Change[];
  defaultAuthor: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [author, setAuthor] = useState(defaultAuthor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem("ossie.author", author);
      await api.createCommit(repoId, message.trim(), author || "anonymous");
      await onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title="提交到当前分支" onClose={onClose}>
      <div className="form">
        <label>
          提交说明
          <input
            value={message}
            placeholder="描述本次建模变更"
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <label>
          作者
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="panel-title" style={{ marginTop: 6 }}>
          本次将提交的更改（{changes.length}）
        </div>
        {changes.length === 0 ? (
          <div className="empty">工作区干净，没有可提交的更改</div>
        ) : (
          changes.map((c) => (
            <details key={c.key}>
              <summary>
                {statusBadge(c.status)} <span className="mono">{c.key}</span>
              </summary>
              <pre className="diff-line">{c.unified}</pre>
            </details>
          ))
        )}
        <div className="hint">有校验错误的快照不可提交。</div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="primary"
            onClick={submit}
            disabled={busy || !message.trim()}
          >
            提交
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Publish (the dev/prod boundary)
// ---------------------------------------------------------------------------

function PublishModal({
  repoId,
  head,
  releases,
  defaultAuthor,
  onClose,
  onDone
}: {
  repoId: string;
  head?: string | null;
  releases: Release[];
  defaultAuthor: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [environment, setEnvironment] = useState<Environment>("dev");
  const [message, setMessage] = useState("");
  const [author, setAuthor] = useState(defaultAuthor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = releases.find((r) => r.environment === environment);
  const unchanged = !!latest && latest.commitId === head;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem("ossie.author", author);
      await api.createRelease(
        repoId,
        environment,
        message.trim(),
        author || "anonymous"
      );
      await onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="发布模型版本" onClose={onClose}>
      <div className="form">
        <div className="hint" style={{ margin: 0 }}>
          发布把当前分支的最新提交推送到一个环境，成为消费方（问数 / Agent / BI）
          唯一可读的版本。发布是追加式记录，历史不会被改写；回滚 = 重新发布一个历史版本。
        </div>
        <label>
          目标环境
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as Environment)}
          >
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </label>
        <div className="muted">
          当前分支提交：<span className="mono">{head?.slice(0, 8) || "—"}</span>
          {latest && (
            <>
              {" · "}
              {environment} 当前发布：
              <span className="mono"> {latest.commitId.slice(0, 8)}</span>
            </>
          )}
        </div>
        {unchanged && (
          <div className="warn-text">
            该环境已经是指向这个提交，重复发布只会多一条同版本的记录。
          </div>
        )}
        <label>
          发布说明
          <input
            value={message}
            placeholder="例如：v1.2 新增订单域度量"
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <label>
          发布人
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary" onClick={submit} disabled={busy}>
            发布到 {environment}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// History: branches + commits + diff + merge (repository-scoped)
// ---------------------------------------------------------------------------

function HistoryModal({
  repoId,
  working,
  branches,
  commits,
  releases,
  changes,
  refresh,
  onClose
}: {
  repoId: string;
  working: WorkingView;
  branches: Branch[];
  commits: Commit[];
  releases: Release[];
  changes: Change[];
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ commit: Commit; changes: Change[] } | null>(
    null
  );
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeMessage, setMergeMessage] = useState("");

  const openCommit = async (c: Commit) => {
    setError(null);
    if (!c.parentCommitId) {
      setDiff({ commit: c, changes: [] });
      return;
    }
    try {
      const d = await api.diff(repoId, c.parentCommitId, c.id);
      setDiff({ commit: c, changes: d.changes });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const newBranch = async () => {
    const name = prompt("新分支名（字母/数字/-/_/.）");
    if (!name) return;
    setBusy(true);
    try {
      await api.createBranch(repoId, name.trim());
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    if (!mergeFrom) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.merge(repoId, mergeFrom, mergeMessage, "developer");
      if (out.merged) {
        await refresh();
        setMergeMessage("");
      } else {
        setError(`合并冲突（${out.conflicts.length}）：${out.conflicts.join(", ")}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const branchColumns: Column<Branch>[] = [
    {
      key: "name",
      header: "分支",
      render: (b) => (
        <span className="cell-primary">
          {b.name}
          {b.id === working.branch.id && <span className="badge accent">当前</span>}
        </span>
      )
    },
    {
      key: "head",
      header: "HEAD",
      render: (b) => (
        <span className="mono sub">{b.headCommitId?.slice(0, 8) || "—"}</span>
      )
    },
    {
      key: "actions",
      header: "",
      width: "90px",
      align: "right",
      render: (b) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          {b.id !== working.branch.id && !b.isDefault && (
            <button
              className="sm danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`删除分支 ${b.name}？`)) return;
                try {
                  await api.deleteBranch(repoId, b.id);
                  await refresh();
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              删除
            </button>
          )}
        </span>
      )
    }
  ];

  const commitColumns: Column<Commit>[] = [
    {
      key: "message",
      header: "提交说明",
      render: (c) => (
        <span className="cell-primary">
          {c.message}
          {c.parent2CommitId && <span className="badge violet">merge</span>}
        </span>
      )
    },
    {
      key: "branches",
      header: "分支",
      width: "140px",
      render: (c) => <span className="sub">{c.branches.join(", ") || "—"}</span>
    },
    { key: "author", header: "作者", width: "110px" },
    {
      key: "createdAt",
      header: "时间",
      width: "170px",
      render: (c) => new Date(c.createdAt).toLocaleString()
    },
    {
      key: "released",
      header: "已发布",
      width: "130px",
      render: (c) => {
        const envs = releases
          .filter((r) => r.commitId === c.id)
          .map((r) => r.environment);
        return envs.length ? (
          <span className="badge accent">{envs.join(" / ")}</span>
        ) : (
          <span className="muted">—</span>
        );
      }
    }
  ];

  return (
    <>
      <Modal wide title="历史与分支" onClose={onClose}>
        {error && <div className="error-text">{error}</div>}
        {changes.length > 0 && (
          <div className="warn-text">
            当前有 {changes.length} 处未提交更改，尚未进入提交历史。
          </div>
        )}

        <div className="row">
          <div className="panel-title" style={{ margin: 0 }}>
            分支（{branches.length}）
          </div>
          <span className="spacer" />
          <button className="sm" onClick={newBranch} disabled={busy}>
            + 新建分支
          </button>
        </div>
        <DataTable
          columns={branchColumns}
          rows={branches}
          rowKey={(b) => b.id}
        />

        <div className="panel-title" style={{ margin: "14px 0 0" }}>
          提交历史（{commits.length}）
        </div>
        <DataTable
          columns={commitColumns}
          rows={commits}
          rowKey={(c) => c.id}
          onRowClick={openCommit}
        />

        <div className="panel-title" style={{ margin: "14px 0 0" }}>
          合并
        </div>
        <div className="split">
          <label>
            从分支
            <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
              <option value="">选择分支</option>
              {branches
                .filter((b) => b.id !== working.branch.id)
                .map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            合并说明（可选）
            <input
              value={mergeMessage}
              onChange={(e) => setMergeMessage(e.target.value)}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button
            className="primary"
            onClick={merge}
            disabled={busy || !mergeFrom}
          >
            合并到当前分支
          </button>
        </div>

        <div className="panel-title" style={{ margin: "14px 0 0" }}>
          发布记录（{releases.length}）
        </div>
        <DataTable
          columns={[
            {
              key: "environment",
              header: "环境",
              width: "100px",
              render: (r: Release) => <span className="badge accent">{r.environment}</span>
            },
            {
              key: "commit",
              header: "提交",
              width: "110px",
              render: (r: Release) => <span className="mono">{r.commitId.slice(0, 8)}</span>
            },
            {
              key: "message",
              header: "说明",
              render: (r: Release) => <span className="sub">{r.message || "—"}</span>
            },
            { key: "author", header: "发布人", width: "110px" },
            {
              key: "createdAt",
              header: "时间",
              width: "170px",
              render: (r: Release) => new Date(r.createdAt).toLocaleString()
            }
          ]}
          rows={releases}
          rowKey={(r) => r.id}
          empty="还没有发布记录"
        />
      </Modal>

      {diff && (
        <Modal
          wide
          title={`提交 · ${diff.commit.message}`}
          onClose={() => setDiff(null)}
        >
          <div className="muted">
            {diff.commit.author} ·{" "}
            {new Date(diff.commit.createdAt).toLocaleString()} ·{" "}
            <span className="mono">{diff.commit.id.slice(0, 8)}</span>
          </div>
          {diff.changes.length === 0 ? (
            <div className="empty">初始提交（空树）或无可显示差异</div>
          ) : (
            diff.changes.map((c) => (
              <details key={c.key} open>
                <summary>
                  {statusBadge(c.status)} <span className="mono">{c.key}</span>
                </summary>
                <pre className="diff-line">{c.unified}</pre>
              </details>
            ))
          )}
          <div className="modal-actions">
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm("将当前分支硬重置到该提交？")) return;
                setBusy(true);
                try {
                  await api.reset(repoId, diff.commit.id);
                  setDiff(null);
                  await refresh();
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              重置到该提交
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
