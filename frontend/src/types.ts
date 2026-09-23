export interface Repo {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  headBranchId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Tenant {
  id: string;
  name: string;
  description?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DataSource {
  id: string;
  tenantId: string;
  name: string;
  kind: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string | null;
  sslmode: string;
  defaultSchema: string;
  description?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DataSourceInput {
  name: string;
  kind: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  sslmode: string;
  defaultSchema: string;
  description?: string;
}

export interface SettingsView {
  tenantId: string;
  values: Record<string, string>;
}

/** A commit published to an environment — the only thing consumers read. */
export interface Release {
  id: string;
  repoId: string;
  environment: string;
  commitId: string;
  message?: string | null;
  author: string;
  seq: number;
  createdAt: number;
}

/** Everything the version bar and history need for one repository. */
export interface RepoVersion {
  repoId: string;
  working: WorkingView;
  branches: Branch[];
  commits: Commit[];
  releases: Release[];
}

export interface Branch {
  id: string;
  repoId: string;
  name: string;
  headCommitId?: string | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Commit {
  id: string;
  repoId: string;
  message: string;
  author: string;
  parentCommitId?: string | null;
  parent2CommitId?: string | null;
  createdAt: number;
  branches: string[];
  tree: Record<string, any>;
}

export interface Artifact {
  kind: string;
  key: string;
  body: any;
}

export interface Issue {
  level: "error" | "warning";
  path: string;
  message: string;
}

export interface WorkingView {
  repo: Repo;
  branch: Branch;
  baseCommitId?: string | null;
  artifacts: Artifact[];
  issues: Issue[];
}

export interface Change {
  key: string;
  status: "added" | "removed" | "modified";
  before?: any;
  after?: any;
  unified: string;
}

export interface DiffView {
  from: string;
  to: string;
  changes: Change[];
}

export interface MergeOutcome {
  merged: boolean;
  commitId?: string | null;
  message?: string | null;
  conflicts: string[];
}

export interface DeployView {
  applied: boolean;
  statements: number;
  sql: string;
}
