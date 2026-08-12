import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Branch, Commit, Issue, WorkingView } from "../types";
import { GitTab } from "./GitTab";
import { OntologyTab } from "./OntologyTab";
import { SemanticTab } from "./SemanticTab";

type Tab = "ontology" | "semantic" | "git";

export function Studio({
  repoId,
  onBack
}: {
  repoId: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("ontology");
  const [working, setWorking] = useState<WorkingView | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [author, setAuthor] = useState(
    () => localStorage.getItem("ossie.author") || "developer"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [w, b, c] = await Promise.all([
        api.getWorking(repoId),
        api.listBranches(repoId),
        api.listCommits(repoId)
      ]);
      setWorking(w);
      setBranches(b);
      setCommits(c);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [repoId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const commit = async () => {
    if (!commitMsg.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      localStorage.setItem("ossie.author", author);
      await api.createCommit(repoId, commitMsg.trim(), author || "anonymous");
      setCommitMsg("");
      setNotice("已提交");
      await refresh();
    } catch (e: any) {
      setError(e.message);
      if (e.issues?.length) {
        setNotice(
          "校验失败：" +
            e.issues
              .filter((i: Issue) => i.level === "error")
              .map((i: Issue) => i.message)
              .join("；")
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const switchBranch = async (branchId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.checkoutBranch(repoId, branchId);
      await refresh();
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
    setError(null);
    try {
      await api.createBranch(repoId, name.trim());
      await refresh();
      setNotice(`分支 ${name.trim()} 已创建`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const exportYaml = async () => {
    try {
      const text = await api.exportYaml(repoId);
      const blob = new Blob([text], { type: "application/x-yaml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${working?.repo.name || "model"}.ossie.yaml`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const importFile = async (file: File) => {
    const format = file.name.endsWith(".json") ? "json" : "yaml";
    const content = await file.text();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const out = await api.importDoc(repoId, format, content);
      setNotice(
        `已导入 ${out.imported} 个工件` +
          (out.issues.length ? `（${out.issues.filter((i) => i.level === "error").length} 个错误，${out.issues.filter((i) => i.level === "warning").length} 个警告）` : "")
      );
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!working) {
    return (
      <div className="app">
        <div className="topbar">
          <button onClick={onBack}>← 返回</button>
          <span className="title">加载中…</span>
          {error && <span className="error-text">{error}</span>}
        </div>
      </div>
    );
  }

  const errCount = working.issues.filter((i) => i.level === "error").length;

  return (
    <div className="app">
      <div className="topbar" style={{ flexWrap: "wrap" }}>
        <button onClick={onBack}>← 仓库</button>
        <span className="title">{working.repo.name}</span>
        <span className={`badge ${errCount ? "err" : "ok"}`}>
          {errCount ? `${errCount} 错误` : "校验通过"}
        </span>
        <select
          value={working.branch.id}
          onChange={(e) => switchBranch(e.target.value)}
          disabled={busy}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.isDefault ? " (main)" : ""}
            </option>
          ))}
        </select>
        <button onClick={newBranch} disabled={busy}>
          + 分支
        </button>
        <span className="spacer" />
        <input
          placeholder="提交说明"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          style={{ width: 260 }}
        />
        <input
          placeholder="作者"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          style={{ width: 110 }}
          title="提交作者"
        />
        <button className="primary" onClick={commit} disabled={busy || !commitMsg.trim()}>
          提交
        </button>
        <button onClick={exportYaml} title="导出 Ossie YAML">
          导出
        </button>
        <button onClick={() => fileRef.current?.click()}>导入</button>
        <input
          ref={fileRef}
          type="file"
          accept=".yaml,.yml,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <div className="error-text" style={{ padding: "6px 16px" }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="warn-text" style={{ padding: "6px 16px" }}>
          {notice}
        </div>
      )}
      <div className="tabs">
        <button className={tab === "ontology" ? "active" : ""} onClick={() => setTab("ontology")}>
          Ontology 建模
        </button>
        <button className={tab === "semantic" ? "active" : ""} onClick={() => setTab("semantic")}>
          Semantic 语义层
        </button>
        <button className={tab === "git" ? "active" : ""} onClick={() => setTab("git")}>
          Git 版本控制
        </button>
      </div>
      <div className="content">
        {tab === "ontology" && (
          <OntologyTab repoId={repoId} working={working} refresh={refresh} />
        )}
        {tab === "semantic" && (
          <SemanticTab repoId={repoId} working={working} refresh={refresh} />
        )}
        {tab === "git" && (
          <GitTab repoId={repoId} branches={branches} commits={commits} refresh={refresh} />
        )}
      </div>
    </div>
  );
}
