import type {
  Artifact,
  Branch,
  Change,
  Commit,
  DeployView,
  DiffView,
  Issue,
  MergeOutcome,
  Repo,
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
  listRepos: () => request<Repo[]>("/api/repos"),
  createRepo: (name: string, description?: string) =>
    request<Repo>("/api/repos", {
      method: "POST",
      body: JSON.stringify({ name, description })
    }),
  getRepo: (repoId: string) => request<Repo>(`/api/repos/${repoId}`),
  deleteRepo: (repoId: string) =>
    request<{ deleted: boolean }>(`/api/repos/${repoId}`, { method: "DELETE" }),

  getWorking: (repoId: string) =>
    request<WorkingView>(`/api/repos/${repoId}/working`),

  listBranches: (repoId: string) =>
    request<Branch[]>(`/api/repos/${repoId}/branches`),
  createBranch: (repoId: string, name: string, from?: string) =>
    request<Branch>(`/api/repos/${repoId}/branches`, {
      method: "POST",
      body: JSON.stringify({ name, from })
    }),
  checkoutBranch: (repoId: string, branchId: string) =>
    request<any>(`/api/repos/${repoId}/branches/${branchId}/checkout`, {
      method: "POST",
      body: "{}"
    }),
  deleteBranch: (repoId: string, branchId: string) =>
    request<{ deleted: boolean }>(
      `/api/repos/${repoId}/branches/${branchId}`,
      { method: "DELETE" }
    ),

  upsertArtifact: (repoId: string, kind: string, key: string, body: any) =>
    request<Artifact>(`/api/repos/${repoId}/artifacts`, {
      method: "POST",
      body: JSON.stringify({ kind, key, body })
    }),
  deleteArtifact: (repoId: string, kind: string, key: string) =>
    request<{ deleted: boolean }>(
      `/api/repos/${repoId}/artifacts/${kind}/${encodeURIComponent(key)}`,
      { method: "DELETE" }
    ),

  createCommit: (repoId: string, message: string, author: string) =>
    request<Commit>(`/api/repos/${repoId}/commits`, {
      method: "POST",
      body: JSON.stringify({ message, author })
    }),
  listCommits: (repoId: string) =>
    request<Commit[]>(`/api/repos/${repoId}/commits`),
  reset: (repoId: string, commitId: string) =>
    request<Commit>(`/api/repos/${repoId}/reset`, {
      method: "POST",
      body: JSON.stringify({ commitId })
    }),
  merge: (repoId: string, from: string, message: string, author: string) =>
    request<MergeOutcome>(`/api/repos/${repoId}/merge`, {
      method: "POST",
      body: JSON.stringify({ from, message, author })
    }),
  diff: (repoId: string, from: string, to: string) =>
    request<DiffView>(
      `/api/repos/${repoId}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    ),
  changes: (repoId: string) =>
    request<DiffView>(
      `/api/repos/${repoId}/diff?from=head&to=working`
    ).then((d) => d.changes),

  validate: (repoId: string) =>
    request<{ valid: boolean; issues: Issue[] }>(
      `/api/repos/${repoId}/validate`
    ),
  exportYaml: async (repoId: string) => {
    const res = await fetch(`/api/repos/${repoId}/export?format=yaml`);
    if (!res.ok) throw new Error(await res.text());
    return await res.text();
  },
  importDoc: (repoId: string, format: string, content: string) =>
    request<{ imported: number; issues: Issue[] }>(
      `/api/repos/${repoId}/import`,
      {
        method: "POST",
        body: JSON.stringify({ format, content })
      }
    ),

  semanticPreview: (repoId: string, schema: string) =>
    request<{ sql: string; statements: string[] }>(
      `/api/repos/${repoId}/semantic/preview?schema=${encodeURIComponent(schema)}`
    ),
  semanticDeploy: (
    repoId: string,
    connectionUrl: string,
    schema: string
  ) =>
    request<DeployView>(`/api/repos/${repoId}/semantic/deploy`, {
      method: "POST",
      body: JSON.stringify({ connectionUrl, schema })
    })
};
