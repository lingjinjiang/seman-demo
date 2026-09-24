import type {
  Artifact,
  Binding,
  Branch,
  Change,
  Commit,
  DataSource,
  DataSourceInput,
  DeployView,
  DiffView,
  Issue,
  MergeOutcome,
  Release,
  Project,
  SettingsView,
  Tenant,
  WorkingView,
} from "./types";

export class ApiError extends Error {
  status: number;
  issues?: Issue[];

  constructor(status: number, message: string, issues?: Issue[]) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options?.headers || {})
    }
  });
  if (!res.ok) {
    let data: any = {};
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, data.error || res.statusText, data.issues);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () =>
    request<{ status: string; spec: string; storage: string }>("/api/health"),

  listProjects: (tenant: string) =>
    request<Project[]>(`/api/projects?tenant=${encodeURIComponent(tenant)}`),
  createProject: (name: string, description: string | undefined, tenant: string) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, description, tenantId: tenant })
    }),
  getProject: (projectId: string) => request<Project>(`/api/projects/${projectId}`),
  deleteProject: (projectId: string) =>
    request<{ deleted: boolean }>(`/api/projects/${projectId}`, { method: "DELETE" }),

  // ---- platform: tenants / data sources / settings ----
  listTenants: () => request<Tenant[]>("/api/tenants"),
  createTenant: (name: string, description?: string) =>
    request<Tenant>("/api/tenants", {
      method: "POST",
      body: JSON.stringify({ name, description })
    }),
  deleteTenant: (tenantId: string) =>
    request<{ deleted: boolean }>(`/api/tenants/${tenantId}`, {
      method: "DELETE"
    }),

  listDataSources: (tenant: string) =>
    request<DataSource[]>(
      `/api/data-sources?tenant=${encodeURIComponent(tenant)}`
    ),
  createDataSource: (tenant: string, input: DataSourceInput) =>
    request<DataSource>(
      `/api/data-sources?tenant=${encodeURIComponent(tenant)}`,
      { method: "POST", body: JSON.stringify(input) }
    ),
  updateDataSource: (id: string, input: DataSourceInput) =>
    request<DataSource>(`/api/data-sources/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    }),
  deleteDataSource: (id: string) =>
    request<{ deleted: boolean }>(`/api/data-sources/${id}`, {
      method: "DELETE"
    }),
  testDataSource: (id: string) =>
    request<{ ok: boolean; message: string }>(
      `/api/data-sources/${id}/test`,
      { method: "POST", body: "{}" }
    ),

  getSettings: (tenant: string) =>
    request<SettingsView>(
      `/api/settings?tenant=${encodeURIComponent(tenant)}`
    ),
  putSettings: (
    tenant: string,
    values: Record<string, string>
  ) =>
    request<SettingsView>(
      `/api/settings?tenant=${encodeURIComponent(tenant)}`,
      { method: "PUT", body: JSON.stringify({ values }) }
    ),

  getWorking: (projectId: string) =>
    request<WorkingView>(`/api/projects/${projectId}/working`),

  listBranches: (projectId: string) =>
    request<Branch[]>(`/api/projects/${projectId}/branches`),
  createBranch: (projectId: string, name: string, from?: string) =>
    request<Branch>(`/api/projects/${projectId}/branches`, {
      method: "POST",
      body: JSON.stringify({ name, from })
    }),
  checkoutBranch: (projectId: string, branchId: string) =>
    request<any>(`/api/projects/${projectId}/branches/${branchId}/checkout`, {
      method: "POST",
      body: "{}"
    }),
  deleteBranch: (projectId: string, branchId: string) =>
    request<{ deleted: boolean }>(
      `/api/projects/${projectId}/branches/${branchId}`,
      { method: "DELETE" }
    ),

  upsertArtifact: (projectId: string, kind: string, key: string, body: any) =>
    request<Artifact>(`/api/projects/${projectId}/artifacts`, {
      method: "POST",
      body: JSON.stringify({ kind, key, body })
    }),
  deleteArtifact: (projectId: string, kind: string, key: string) =>
    request<{ deleted: boolean }>(
      `/api/projects/${projectId}/artifacts/${kind}/${encodeURIComponent(key)}`,
      { method: "DELETE" }
    ),

  createCommit: (projectId: string, message: string, author: string) =>
    request<Commit>(`/api/projects/${projectId}/commits`, {
      method: "POST",
      body: JSON.stringify({ message, author })
    }),
  listCommits: (projectId: string) =>
    request<Commit[]>(`/api/projects/${projectId}/commits`),
  reset: (projectId: string, commitId: string) =>
    request<Commit>(`/api/projects/${projectId}/reset`, {
      method: "POST",
      body: JSON.stringify({ commitId })
    }),
  merge: (projectId: string, from: string, message: string, author: string) =>
    request<MergeOutcome>(`/api/projects/${projectId}/merge`, {
      method: "POST",
      body: JSON.stringify({ from, message, author })
    }),
  diff: (projectId: string, from: string, to: string) =>
    request<DiffView>(
      `/api/projects/${projectId}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),
  changes: (projectId: string) =>
    request<DiffView>(
      `/api/projects/${projectId}/diff?from=head&to=working`
    ).then((d) => d.changes),

  validate: (projectId: string) =>
    request<{ valid: boolean; issues: Issue[] }>(
      `/api/projects/${projectId}/validate`
    ),
  exportYaml: async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/export?format=yaml`);
    if (!res.ok) throw new Error(await res.text());
    return await res.text();
  },
  importDoc: (projectId: string, format: string, content: string) =>
    request<{ imported: number; issues: Issue[] }>(
      `/api/projects/${projectId}/import`,
      {
        method: "POST",
        body: JSON.stringify({ format, content })
      }
    ),

  semanticPreview: (projectId: string, schema: string) =>
    request<{ sql: string; statements: string[] }>(
      `/api/projects/${projectId}/semantic/preview?schema=${encodeURIComponent(schema)}`
    ),
  semanticDeploy: (
    projectId: string,
    connectionUrl: string,
    schema: string
  ) =>
    request<DeployView>(`/api/projects/${projectId}/semantic/deploy`, {
      method: "POST",
      body: JSON.stringify({ connectionUrl, schema })
    }),
  semanticDeployToSource: (
    projectId: string,
    dataSourceId: string,
    schema: string
  ) =>
    request<DeployView>(`/api/projects/${projectId}/semantic/deploy-to-source`, {
      method: "POST",
      body: JSON.stringify({ dataSourceId, schema })
    }),

  // ---- releases: the published, consumer-facing view of a model ----
  // Consumers read `/released`; the working tree and branches stay private to
  // the modeling surface (design-ouline §1.5).
  listReleases: (projectId: string) =>
    request<Release[]>(`/api/projects/${projectId}/releases`),
  createRelease: (
    projectId: string,
    environment: string,
    message: string,
    author: string,
    commitId?: string
  ) =>
    request<Release>(`/api/projects/${projectId}/releases`, {
      method: "POST",
      body: JSON.stringify({ environment, message, author, commitId })
    }),
  deleteRelease: (projectId: string, releaseId: string) =>
    request<{ deleted: boolean }>(
      `/api/projects/${projectId}/releases/${releaseId}`,
      { method: "DELETE" }
    ),
  releasedUrl: (projectId: string, environment: string, format = "yaml") =>
    `/api/projects/${projectId}/released?environment=${encodeURIComponent(
      environment
    )}&format=${format}`,

  // ---- project x environment bindings (experimental, access-control §8) ----
  listBindings: (projectId: string) =>
    request<Binding[]>(`/api/projects/${projectId}/bindings`),
  putBinding: (
    projectId: string,
    environment: string,
    input: { connectionId: string; namespace: string }
  ) =>
    request<Binding>(
      `/api/projects/${projectId}/bindings/${encodeURIComponent(environment)}`,
      { method: "PUT", body: JSON.stringify(input) }
    ),
  deleteBinding: (projectId: string, environment: string) =>
    request<{ deleted: boolean }>(
      `/api/projects/${projectId}/bindings/${encodeURIComponent(environment)}`,
      { method: "DELETE" }
    ),
  semanticDeployToBinding: (projectId: string, environment: string) =>
    request<DeployView>(
      `/api/projects/${projectId}/semantic/deploy-to-binding`,
      { method: "POST", body: JSON.stringify({ environment }) }
    )
};
