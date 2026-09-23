import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Branch, Commit, Repo, Tenant, WorkingView } from "../types";
import { DataSourcesPage } from "./DataSourcesPage";
import { OntologyPage } from "./OntologyPage";
import { OverviewPage } from "./OverviewPage";
import { SemanticPage } from "./SemanticPage";
import { SettingsPage } from "./SettingsPage";
import { VersionControlPage } from "./VersionControlPage";

type PageKey =
  | "overview"
  | "ontology"
  | "semantic"
  | "version"
  | "dataSources"
  | "settings";

const NAV: { group: string; items: { key: PageKey; label: string; icon: string }[] }[] = [
  {
    group: "工作区",
    items: [{ key: "overview", label: "项目概览", icon: "▦" }]
  },
  {
    group: "建模",
    items: [
      { key: "ontology", label: "本体", icon: "◈" },
      { key: "semantic", label: "语义模型", icon: "▤" },
      { key: "version", label: "版本控制", icon: "⎇" }
    ]
  },
  {
    group: "平台",
    items: [
      { key: "dataSources", label: "数据源", icon: "⛁" },
      { key: "settings", label: "设置", icon: "⚙" }
    ]
  }
];

export function Studio() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenant, setTenant] = useState(
    () => localStorage.getItem("ossie.tenant") || "default"
  );
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repoId, setRepoId] = useState<string>(
    () => localStorage.getItem("ossie.repo") || ""
  );
  const [page, setPage] = useState<PageKey>("overview");

  const [working, setWorking] = useState<WorkingView | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Skip the very first run so a remembered repository survives a page reload.
  const tenantInitialized = useRef(false);

  const loadTenants = useCallback(async () => {
    try {
      setTenants(await api.listTenants());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadRepos = useCallback(async (targetTenant: string) => {
    try {
      setRepos(await api.listRepos(targetTenant));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadRepoData = useCallback(async (targetRepo: string) => {
    if (!targetRepo) {
      setWorking(null);
      setBranches([]);
      setCommits([]);
      return;
    }
    try {
      const [w, b, c] = await Promise.all([
        api.getWorking(targetRepo),
        api.listBranches(targetRepo),
        api.listCommits(targetRepo)
      ]);
      setWorking(w);
      setBranches(b);
      setCommits(c);
      setError(null);
    } catch (e: any) {
      setWorking(null);
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    localStorage.setItem("ossie.tenant", tenant);
    loadRepos(tenant);
    if (tenantInitialized.current) {
      // Switching tenants invalidates the active repository.
      setRepoId("");
      localStorage.removeItem("ossie.repo");
    } else {
      tenantInitialized.current = true;
    }
  }, [tenant, loadRepos]);

  useEffect(() => {
    if (repoId) localStorage.setItem("ossie.repo", repoId);
    loadRepoData(repoId);
  }, [repoId, loadRepoData]);

  // Drop the active repo if it does not belong to the current tenant.
  useEffect(() => {
    if (repoId && repos.length && !repos.some((r) => r.id === repoId)) {
      setRepoId("");
    }
  }, [repos, repoId]);

  const refreshRepo = useCallback(async () => {
    await Promise.all([loadRepoData(repoId), loadRepos(tenant)]);
  }, [repoId, tenant, loadRepoData, loadRepos]);

  const refreshTenants = useCallback(async () => {
    await loadTenants();
  }, [loadTenants]);

  const tenantName = useMemo(
    () => tenants.find((t) => t.id === tenant)?.name || tenant,
    [tenants, tenant]
  );

  const currentRepo = repos.find((r) => r.id === repoId);
  const repoScoped = page === "ontology" || page === "semantic" || page === "version";

  const errorCount = working
    ? working.issues.filter((i) => i.level === "error").length
    : 0;
  const warnCount = working ? working.issues.length - errorCount : 0;

  const go = (key: PageKey) => {
    if ((key === "ontology" || key === "semantic" || key === "version") && !repoId) {
      setPage("overview");
      return;
    }
    setPage(key);
  };

  const renderPage = () => {
    if (repoScoped && (!repoId || !working)) {
      return (
        <div className="panel panel-pad">
          <div className="empty">
            {repos.length === 0
              ? "当前租户还没有模型仓库，请先在「项目概览」创建"
              : "请先在上方选择一个模型仓库"}
          </div>
        </div>
      );
    }
    switch (page) {
      case "overview":
        return (
          <OverviewPage
            tenant={tenant}
            tenantName={tenantName}
            repos={repos}
            refresh={() => loadRepos(tenant)}
            onOpen={(id) => {
              setRepoId(id);
              setPage("ontology");
            }}
          />
        );
      case "ontology":
        return (
          <OntologyPage repoId={repoId} working={working!} refresh={refreshRepo} />
        );
      case "semantic":
        return (
          <SemanticPage
            repoId={repoId}
            tenant={tenant}
            working={working!}
            refresh={refreshRepo}
          />
        );
      case "version":
        return (
          <VersionControlPage
            repoId={repoId}
            working={working!}
            branches={branches}
            commits={commits}
            refresh={refreshRepo}
          />
        );
      case "dataSources":
        return <DataSourcesPage tenant={tenant} />;
      case "settings":
        return (
          <SettingsPage
            tenant={tenant}
            tenants={tenants}
            refreshTenants={refreshTenants}
            onSwitchTenant={(id) => setTenant(id)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo">O</div>
          <div>
            <div className="brand-name">Ossie Studio</div>
            <div className="brand-sub">Apache Ossie 建模平台</div>
          </div>
        </div>

        <div className="sidebar-scroll">
          {NAV.map((group) => (
            <div key={group.group}>
              <div className="nav-group-title">{group.group}</div>
              {group.items.map((item) => (
                <div
                  key={item.key}
                  className={`nav-item ${page === item.key ? "active" : ""}`}
                  onClick={() => go(item.key)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.key === "ontology" && working && (
                    <span className="nav-badge">
                      {working.artifacts.filter((a) => a.kind === "concept").length}
                    </span>
                  )}
                  {item.key === "semantic" && working && (
                    <span className="nav-badge">
                      {
                        working.artifacts.filter((a) => a.kind === "dataset")
                          .length
                      }
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          OSSIE 0.2.0.dev0 · 仅 PostgreSQL 数据源
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="field">
            租户
            <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            模型仓库
            <select
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
            >
              <option value="">未选择</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {working && (
            <span className="badge">⎇ {working.branch.name}</span>
          )}
          {working && (
            <span className={`badge ${errorCount ? "err" : warnCount ? "warn" : "ok"}`}>
              {errorCount
                ? `${errorCount} 错误`
                : warnCount
                  ? `${warnCount} 警告`
                  : "校验通过"}
            </span>
          )}
          <span className="spacer" />
          {currentRepo && (
            <span className="muted" style={{ fontSize: 12 }}>
              更新于 {new Date(currentRepo.updatedAt).toLocaleString()}
            </span>
          )}
        </header>

        <div className="content">
          {error && (
            <div className="error-text" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
