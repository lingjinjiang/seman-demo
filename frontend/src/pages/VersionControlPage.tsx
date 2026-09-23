import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { DataTable, PageHeader, type Column } from "../components/ui";
import type { Branch, Change, Commit, WorkingView } from "../types";

function statusBadge(status: Change["status"]) {
  const cls = status === "added" ? "ok" : status === "removed" ? "err" : "warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function VersionControlPage({
  repoId,
  working,
  branches,
  commits,
  refresh
}: {
  repoId: string;
  working: WorkingView;
  branches: Branch[];
  commits: Commit[];
  refresh: () => Promise<void>;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [message, setMessage] = useState("");
  const [author, setAuthor] = useState(
    () => localStorage.getItem("ossie.author") || "developer"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<{ commit: Commit; changes: Change[] } | null>(
    null
  );
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeMessage, setMergeMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadChanges = async () => {
    try {
      setChanges(await api.changes(repoId));
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    loadChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, commits.length]);

  const commit = async () => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      localStorage.setItem("ossie.author", author);
      await api.createCommit(repoId, message.trim(), author || "anonymous");
      setMessage("");
      setNotice("提交成功");
      await refresh();
      await loadChanges();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openCommit = async (c: Commit) => {
    setError(null);
    if (!c.parentCommitId) {
      setCommitDiff({ commit: c, changes: [] });
      return;
    }
    try {
      const d = await api.diff(repoId, c.parentCommitId, c.id);
      setCommitDiff({ commit: c, changes: d.changes });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reset = async (id: string) => {
    if (!confirm("将当前分支硬重置到该提交（工作区会同步为该提交内容）？")) return;
    setBusy(true);
    try {
      await api.reset(repoId, id);
      setNotice(`已重置到 ${id.slice(0, 8)}`);
      await refresh();
      await loadChanges();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const newBranch = async () => {
    const name = prompt("新分支名（字母/数字/-/_/.）");
    if (!name) return;
    setBusy(true);
    try {
      await api.createBranch(repoId, name.trim());
      setNotice(`分支 ${name.trim()} 已创建`);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const switchBranch = async (b: Branch) => {
    setBusy(true);
    try {
      await api.checkoutBranch(repoId, b.id);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeBranch = async (b: Branch) => {
    if (!confirm(`删除分支 ${b.name}？`)) return;
    setBusy(true);
    try {
      await api.deleteBranch(repoId, b.id);
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
    setNotice(null);
    try {
      const out = await api.merge(repoId, mergeFrom, mergeMessage, author);
      if (out.merged) {
        setNotice(`合并完成：${out.message || out.commitId}`);
        setMergeMessage("");
        await refresh();
        await loadChanges();
      } else {
        setError(`合并冲突（${out.conflicts.length}）：${out.conflicts.join(", ")}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
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

  const doImport = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const content = await file.text();
      const format = file.name.endsWith(".json") ? "json" : "yaml";
      const out = await api.importDoc(repoId, format, content);
      setNotice(
        `已导入 ${out.imported} 个工件${
          out.issues.length ? `（${out.issues.length} 条校验提示）` : ""
        }`
      );
      await refresh();
      await loadChanges();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
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
      render: (b) => <span className="mono sub">{b.headCommitId?.slice(0, 8) || "—"}</span>
    },
    {
      key: "updated",
      header: "更新时间",
      width: "180px",
      render: (b) => new Date(b.updatedAt).toLocaleString()
    },
    {
      key: "actions",
      header: "",
      width: "150px",
      align: "right",
      render: (b) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          {b.id !== working.branch.id && (
            <>
              <button className="sm" disabled={busy} onClick={() => switchBranch(b)}>
                切换
              </button>{" "}
              <button
                className="sm danger"
                disabled={busy || b.isDefault}
                onClick={() => removeBranch(b)}
              >
                删除
              </button>
            </>
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
      width: "150px",
      render: (c) => (
        <span className="sub">{c.branches.join(", ") || "—"}</span>
      )
    },
    { key: "author", header: "作者", width: "120px" },
    {
      key: "createdAt",
      header: "时间",
      width: "180px",
      render: (c) => new Date(c.createdAt).toLocaleString()
    },
    {
      key: "id",
      header: "ID",
      width: "110px",
      render: (c) => <span className="mono sub">{c.id.slice(0, 8)}</span>
    }
  ];

  return (
    <>
      <PageHeader
        title="版本控制"
        subtitle={`当前分支 ${working.branch.name} · ${commits.length} 次提交 · 工作区 ${
          changes.length === 0 ? "干净" : `${changes.length} 处未提交更改`
        }`}
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doImport(f);
              }}
            />
            <button onClick={() => fileRef.current?.click()} disabled={busy}>
              导入
            </button>
            <button onClick={doExport}>导出</button>
            <button onClick={newBranch} disabled={busy}>
              新建分支
            </button>
          </>
        }
      />

      {notice && <div className="ok-text" style={{ marginBottom: 10 }}>{notice}</div>}
      {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="panel panel-pad">
          <div className="panel-title">提交</div>
          <div className="form">
            <label>
              提交说明
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="描述本次建模变更"
              />
            </label>
            <label>
              作者
              <input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
            <div className="row">
              <button
                className="primary"
                onClick={commit}
                disabled={busy || !message.trim()}
              >
                提交
              </button>
              <span className="hint" style={{ margin: 0 }}>
                有校验错误的快照不可提交
              </span>
            </div>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="panel-title">未提交更改（{changes.length}）</div>
          {changes.length === 0 ? (
            <div className="empty">工作区干净</div>
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
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-pad" style={{ paddingBottom: 0 }}>
          <div className="panel-title">分支（{branches.length}）</div>
        </div>
        <DataTable columns={branchColumns} rows={branches} rowKey={(b) => b.id} />
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-pad" style={{ paddingBottom: 0 }}>
          <div className="panel-title">历史（{commits.length}）</div>
        </div>
        <DataTable
          columns={commitColumns}
          rows={commits}
          rowKey={(c) => c.id}
          onRowClick={openCommit}
        />
      </div>

      <div className="panel panel-pad">
        <div className="panel-title">合并</div>
        <div className="split">
          <label>
            从分支
            <select
              value={mergeFrom}
              onChange={(e) => setMergeFrom(e.target.value)}
            >
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
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={merge} disabled={busy || !mergeFrom}>
            合并到当前分支
          </button>
        </div>
      </div>

      {commitDiff && (
        <Modal
          wide
          title={`提交 · ${commitDiff.commit.message}`}
          onClose={() => setCommitDiff(null)}
        >
          <div className="muted">
            {commitDiff.commit.author} ·{" "}
            {new Date(commitDiff.commit.createdAt).toLocaleString()} ·{" "}
            <span className="mono">{commitDiff.commit.id.slice(0, 8)}</span>
          </div>
          <div className="row">
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                reset(commitDiff.commit.id);
                setCommitDiff(null);
              }}
            >
              重置到该提交
            </button>
          </div>
          {commitDiff.changes.length === 0 ? (
            <div className="empty">初始提交（空树）或无可显示差异</div>
          ) : (
            commitDiff.changes.map((c) => (
              <details key={c.key} open>
                <summary>
                  {statusBadge(c.status)} <span className="mono">{c.key}</span>
                </summary>
                <pre className="diff-line">{c.unified}</pre>
              </details>
            ))
          )}
        </Modal>
      )}
    </>
  );
}
