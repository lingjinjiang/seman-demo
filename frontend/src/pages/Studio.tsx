import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  Branch,
  Commit,
  Release,
  Project,
  ProjectVersion,
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
    items: [{ key: "overview", label: "工作台", icon: "▦" }]
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>(
    () => localStorage.getItem("ossie.project") || ""
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

  // Loading projects also fixes up the selection: keep the remembered one if it
  // still exists, otherwise fall back to the most recently updated project, so the
  // modeling pages are never dead on arrival.
  const loadProjects = useCallback(async (targetTenant: string) => {
    try {
      const rows = await api.listProjects(targetTenant);
      setProjects(rows);
      setProjectId((current) =>
        rows.some((r) => r.id === current) ? current : rows[0]?.id ?? ""
      );
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadProjectData = useCallback(async (targetProject: string) => {
    if (!targetProject) {
      setWorking(null);
      setBranches([]);
      setCommits([]);
      setReleases([]);
      return;
    }
    try {
      const [w, b, c, rel] = await Promise.all([
        api.getWorking(targetProject),
        api.listBranches(targetProject),
        api.listCommits(targetProject),
        api.listReleases(targetProject)
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
    loadProjects(tenant);
  }, [tenant, loadProjects]);

  useEffect(() => {
    if (projectId) localStorage.setItem("ossie.project", projectId);
    loadProjectData(projectId);
  }, [projectId, loadProjectData]);

  const refreshProject = useCallback(async () => {
    await Promise.all([loadProjectData(projectId), loadProjects(tenant)]);
  }, [projectId, tenant, loadProjectData, loadProjects]);

  const tenantName = useMemo(
    () => tenants.find((t) => t.id === tenant)?.name || tenant,
    [tenants, tenant]
  );

  const version: ProjectVersion | null = useMemo(() => {
    if (!working) return null;
    return {
      projectId: working.project.id,
      working,
      branches,
      commits,
      releases
    };
  }, [working, branches, commits, releases]);

  const projectScoped = page === "ontology" || page === "semantic";
  const errorCount = working
    ? working.issues.filter((i) => i.level === "error").length
    : 0;
  const warnCount = working ? working.issues.length - errorCount : 0;

  // Never make a nav click a no-op: with no project yet, send the user
  // straight into the creation flow instead of showing a dead page.
  const go = (key: PageKey) => {
    const needsProject = key === "ontology" || key === "semantic";
    if (needsProject && projects.length === 0) {
      setPage("overview");
      setCreateRequest((n) => n + 1);
      return;
    }
    setPage(key);
  };

  const renderPage = () => {
    if (projectScoped && !version) {
      return (
        <div className="panel panel-pad">
          <div className="empty">
            {projects.length === 0
              ? "当前租户还没有项目"
              : "正在加载模型…"}
            {projects.length === 0 && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="primary"
                  onClick={() => {
                    setPage("overview");
                    setCreateRequest((n) => n + 1);
                  }}
                >
                  + 新建项目
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
            projects={projects}
            createRequest={createRequest}
            refresh={() => loadProjects(tenant)}
            onOpen={(id) => {
              setProjectId(id);
              setPage("ontology");
            }}
            onManageTenants={() => setPage("settings")}
            onOpenDataSources={() => setPage("dataSources")}
          />
        );
      case "ontology":
        return <OntologyPage version={version!} refresh={refreshProject} />;
      case "semantic":
        return (
          <SemanticPage
            version={version!}
            tenant={tenant}
            refresh={refreshProject}
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
              {/* Modeling pages are project-scoped; say so instead of letting a
                  click land somewhere unexpected. */}
              {group.group === "建模" && projects.length === 0 && (
                <div className="nav-hint">先创建一个项目</div>
              )}
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
            项目
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.length === 0 && <option value="">（暂无）</option>}
              {projects.map((r) => (
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
