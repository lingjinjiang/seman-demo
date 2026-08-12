import { useEffect, useState } from "react";
import { api } from "../api";
import type { Branch, Change, Commit, Issue } from "../types";

function fmtTime(ms: number) {
  return new Date(ms).toLocaleString();
}

export function GitTab({
  repoId,
  branches,
  commits,
  refresh
}: {
  repoId: string;
  branches: Branch[];
  commits: Commit[];
  refresh: () => Promise<void>;
}) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<Change[] | null>(null);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeMsg, setMergeMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const showCommit = async (id: string) => {
    setSelectedId(id);
    setCommitDiff(null);
    setError(null);
    const commit = commits.find((c) => c.id === id);
    if (!commit) return;
    if (!commit.parentCommitId) {
      setCommitDiff([]);
      return;
    }
    try {
      const d = await api.diff(repoId, commit.parentCommitId, id);
      setCommitDiff(d.changes);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reset = async (id: string) => {
    if (!confirm("将当前分支硬重置到该提交（工作区会同步为该提交内容）？")) return;
    setBusy(true);
    setError(null);
    try {
      await api.reset(repoId, id);
      setNotice("已重置到 " + id.slice(0, 8));
      await refresh();
      await loadChanges();
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
      const out = await api.merge(repoId, mergeFrom, mergeMsg, "developer");
      if (out.merged) {
        setNotice(`合并完成：${out.message || out.commitId}`);
        setMergeMsg("");
        await refresh();
        await loadChanges();
      } else {
        setError(`合并冲突（${out.conflicts.length} 处）：${out.conflicts.join(", ")}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const selected = commits.find((c) => c.id === selectedId);

  return (
    <div className="grid-3">
      <div className="panel list-panel">
        <div className="muted" style={{ marginBottom: 6 }}>
          未提交的更改（{changes.length}）
        </div>
        {changes.length === 0 && <div className="empty">工作区干净</div>}
        {changes.map((c) => (
          <details key={c.key} style={{ marginBottom: 6 }}>
            <summary>
              <span className={`badge ${c.status === "added" ? "ok" : c.status === "removed" ? "err" : "warn"}`}>
                {c.status}
              </span>{" "}
              {c.key}
            </summary>
            <pre className="diff-line">{c.unified}</pre>
          </details>
        ))}

        <div className="muted" style={{ margin: "12px 0 6px" }}>
          历史（{commits.length}）
        </div>
        {commits.map((c) => (
          <div
            key={c.id}
            className={`list-item ${selectedId === c.id ? "selected" : ""}`}
            onClick={() => showCommit(c.id)}
          >
            <div>
              {c.message}
              {c.branches.length > 0 && (
                <span className="sub"> {c.branches.map((b) => `(${b})`).join(" ")}</span>
              )}
            </div>
            <div className="sub">
              {c.author} · {fmtTime(c.createdAt)} · {c.id.slice(0, 8)}
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}>
        {!selected && <div className="empty">选择左侧历史提交查看差异</div>}
        {selected && (
          <>
            <div style={{ fontWeight: 600 }}>{selected.message}</div>
            <div className="muted">
              {selected.author} · {fmtTime(selected.createdAt)} · {selected.id}
              {selected.parent2CommitId && " · 合并提交"}
            </div>
            {selected.branches.length > 0 && (
              <div>
                {selected.branches.map((b) => (
                  <span key={b} className="badge ok">
                    {b}
                  </span>
                ))}
              </div>
            )}
            <div>
              <button className="danger" onClick={() => reset(selected.id)} disabled={busy}>
                重置到该提交
              </button>
            </div>
            <div className="muted">相对父提交的变更</div>
            {commitDiff && commitDiff.length === 0 && (
              <div className="empty">初始提交（空树）或无可显示差异</div>
            )}
            {commitDiff?.map((c) => (
              <details key={c.key}>
                <summary>
                  <span className={`badge ${c.status === "added" ? "ok" : c.status === "removed" ? "err" : "warn"}`}>
                    {c.status}
                  </span>{" "}
                  {c.key}
                </summary>
                <pre className="diff-line">{c.unified}</pre>
              </details>
            ))}
          </>
        )}
      </div>

      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflow: "auto" }}>
        <div style={{ fontWeight: 600 }}>合并</div>
        <label>
          从分支
          <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
            <option value="">选择分支</option>
            {branches.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          合并说明（可选）
          <input value={mergeMsg} onChange={(e) => setMergeMsg(e.target.value)} />
        </label>
        <div>
          <button className="primary" onClick={merge} disabled={busy || !mergeFrom}>
            合并到当前分支
          </button>
        </div>
        {notice && <div className="warn-text">{notice}</div>}
        {error && <div className="error-text">{error}</div>}
      </div>
    </div>
  );
}
