export interface Repo {
  id: string;
  name: string;
  description?: string | null;
  headBranchId?: string | null;
  createdAt: number;
  updatedAt: number;
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
