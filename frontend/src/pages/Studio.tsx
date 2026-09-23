import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  Branch,
  Commit,
  Release,
  Repo,
  RepoVersion,
  Tenant,
  WorkingView
} from "../types";
import { DataSourcesPage } from "./DataSourcesPage";
import { OntologyPage } from "./OntologyPage";
import { OverviewPage } from "./OverviewPage";
import { SemanticPage } from "./SemanticPage";
import { SettingsPage } from "./SettingsPage";

type PageKey = "overview" | "ontology" | "semantic" | "dataSources" | "settings";

// Version control is deliberately absent: it is a capability embedded in the
// Ontology and Semantic pages, not a destination of its own (design-ouline §1.5).
const NAV: { group: string; items: { key: PageKey; label: string; icon: string }[] }[] = [
  {
    group: "工作区",
    items: [{ key: "overview", label: "项目概览", icon: "▦" }]
  },
  {
    group: "建模",
    items: [
      { key: "ontology", label: "本体", icon: "◈" },
      { key: "semantic", label: "语义模型", icon: "▤" }
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
  const [createRequest, setCreateRequest] = useState(0);

  const [working, setWorking] = useState<WorkingView | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    try {
      setTenants(await api.listTenants());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // Loading repos also fixes up the selection: keep the remembered one if it
  // still exists, otherwise fall back to the most recently updated repo, so the
  // modeling pages are never dead on arrival.
  const loadRepos = useCallback(async (targetTenant: string) => {
    try {
      const rows = await api.listRepos(targetTenant);
      setRepos(rows);
      setRepoId((current) =>
        rows.some((r) => r.id === current) ? current : rows[0]?.id ?? ""
      );
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadRepoData = useCallback(async (targetRepo: string) => {
    if (!targetRepo) {
      setWorking(null);
      setBranches([]);
      setCommits([]);
      setReleases([]);
      return;
    }
    try {
      const [w, b, c, rel] = await Promise.all([
        api.getWorking(targetRepo),
        api.listBranches(targetRepo),
        api.listCommits(targetRepo),
        api.listReleases(targetRepo)
      ]);
      setWorking(w);
      setBranches(b);
      setCommits(c);
      setReleases(rel);
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
  }, [tenant, loadRepos]);

  useEffect(() => {
    if (repoId) localStorage.setItem("ossie.repo", repoId);
    loadRepoData(repoId);
  }, [repoId, loadRepoData]);

  const refreshRepo = useCallback(async () => {
    await Promise.all([loadRepoData(repoId), loadRepos(tenant)]);
  }, [repoId, tenant, loadRepoData, loadRepos]);

  const tenantName = useMemo(
    () => tenants.find((t) => t.id === tenant)?.name || tenant,
    [tenants, tenant]
  );

  const version: RepoVersion | null = useMemo(() => {
    if (!working) return null;
    return {
      repoId: working.repo.id,
      working,
      branches,
      commits,
      releases
    };
  }, [working, branches, commits, releases]);

  const repoScoped = page === "ontology" || page === "semantic";
  const errorCount = working
    ? working.issues.filter((i) => i.level === "error").length
    : 0;
  const warnCount = working ? working.issues.length - errorCount : 0;

  // Never make a nav click a no-op: with no repository yet, send the user
  // straight into the creation flow instead of showing a dead page.
  const go = (key: PageKey) => {
    const needsRepo = key === "ontology" || key === "semantic";
    if (needsRepo && repos.length === 0) {
      setPage("overview");
      setCreateRequest((n) => n + 1);
      return;
    }
    setPage(key);
  };

  const renderPage = () => {
    if (repoScoped && !version) {
      return (
        <div className="panel panel-pad">
          <div className="empty">
            {repos.length === 0
              ? "当前租户还没有模型仓库"
              : "正在加载模型…"}
            {repos.length === 0 && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="primary"
                  onClick={() => {
                    setPage("overview");
                    setCreateRequest((n) => n + 1);
                  }}
                >
                  + 新建模型仓库
                </button>
              </div>
            )}
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
            createRequest={createRequest}
            refresh={() => loadRepos(tenant)}
            onOpen={(id) => {
              setRepoId(id);
              setPage("ontology");
            }}
          />
        );
      case "ontology":
        return <OntologyPage version={version!} refresh={refreshRepo} />;
      case "semantic":
        return (
          <SemanticPage
            version={version!}
            tenant={tenant}
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
            refreshTenants={loadTenants}
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
                  {item.key === "ontology" && version && (
                    <span className="nav-badge">
                      {
                        version.working.artifacts.filter(
                          (a) => a.kind === "concept"
                        ).length
                      }
                    </span>
                  )}
                  {item.key === "semantic" && version && (
                    <span className="nav-badge">
                      {
                        version.working.artifacts.filter(
                          (a) => a.kind === "dataset"
                        ).length
                      }
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Tenant is a low-frequency switch, so it lives at the bottom of the
            rail rather than occupying prime space in the top bar (§1.6). */}
        <div className="sidebar-footer">
          <label className="sidebar-tenant">
            租户
            <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div className="muted" style={{ marginTop: 6 }}>
            OSSIE 0.2.0.dev0 · 仅 PostgreSQL 数据源
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="field">
            模型仓库
            <select value={repoId} onChange={(e) => setRepoId(e.target.value)}>
              {repos.length === 0 && <option value="">（暂无）</option>}
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
            <span
              className={`badge ${errorCount ? "err" : warnCount ? "warn" : "ok"}`}
            >
              {errorCount
                ? `${errorCount} 错误`
                : warnCount
                  ? `${warnCount} 警告`
                  : "校验通过"}
            </span>
          )}
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 12 }}>
            租户 {tenantName}
          </span>
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
