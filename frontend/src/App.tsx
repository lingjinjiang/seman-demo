import { useEffect, useState } from "react";
import { api } from "./api";
import type { Repo } from "./types";
import { Studio } from "./pages/Studio";

export default function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [openRepo, setOpenRepo] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setRepos(await api.listRepos());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    try {
      const repo = await api.createRepo(name.trim());
      setName("");
      setOpenRepo(repo.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (openRepo) {
    return (
      <Studio
        repoId={openRepo}
        onBack={() => {
          setOpenRepo(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <span className="title">Ossie Studio</span>
        <span className="muted">Apache Ossie 建模平台</span>
        <span className="spacer" />
      </div>
      <div className="content" style={{ padding: 16, overflow: "auto" }}>
        {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
        <div className="panel" style={{ maxWidth: 720, marginBottom: 16 }}>
          <div className="form">
            <label>
              新建模型仓库
              <input
                placeholder="仓库名称，例如 retail_analytics"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </label>
            <div>
              <button className="primary" onClick={create} disabled={!name.trim()}>
                创建
              </button>
            </div>
          </div>
        </div>

        <div className="panel" style={{ maxWidth: 720 }}>
          <div className="muted" style={{ marginBottom: 8 }}>
            已有仓库（{repos.length}）
          </div>
          {repos.length === 0 && (
            <div className="empty">还没有仓库，先创建一个吧</div>
          )}
          {repos.map((r) => (
            <div
              key={r.id}
              className="list-item"
              style={{ display: "flex", alignItems: "center", gap: 10 }}
              onClick={() => setOpenRepo(r.id)}
            >
              <div style={{ flex: 1 }}>
                <div>{r.name}</div>
                <div className="sub">
                  {r.description || "无描述"} · 更新于{" "}
                  {new Date(r.updatedAt).toLocaleString()}
                </div>
              </div>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`删除仓库 ${r.name}？该操作不可恢复。`)) {
                    await api.deleteRepo(r.id);
                    refresh();
                  }
                }}
                className="danger"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
