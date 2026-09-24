use anyhow::Result;
use sqlx::any::AnyPoolOptions;
use sqlx::AnyPool;

/// Schema uses only types understood by both SQLite and PostgreSQL
/// (TEXT / INTEGER / BOOLEAN), so a single DDL works on either backend.
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS tenants (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  BIGINT NOT NULL,
    updated_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL DEFAULT 'default',
    name           TEXT NOT NULL,
    description    TEXT,
    head_branch_id TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS branches (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    head_commit_id  TEXT,
    is_default      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS commits (
    id               TEXT PRIMARY KEY,
    project_id       TEXT NOT NULL,
    branch_id        TEXT,
    message          TEXT NOT NULL,
    author           TEXT NOT NULL,
    parent_commit_id TEXT,
    parent2_commit_id TEXT,
    tree_json        TEXT NOT NULL,
    created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS working_trees (
    project_id     TEXT NOT NULL,
    branch_id      TEXT NOT NULL,
    base_commit_id TEXT,
    tree_json      TEXT NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (project_id, branch_id)
);

CREATE TABLE IF NOT EXISTS data_sources (
    id             TEXT PRIMARY KEY,
    tenant_id      TEXT NOT NULL DEFAULT 'default',
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'postgres',
    host           TEXT NOT NULL,
    port           BIGINT NOT NULL DEFAULT 5432,
    database       TEXT NOT NULL,
    username       TEXT NOT NULL,
    password       TEXT,
    sslmode        TEXT NOT NULL DEFAULT 'prefer',
    default_schema TEXT NOT NULL DEFAULT 'public',
    description    TEXT,
    created_at     BIGINT NOT NULL,
    updated_at     BIGINT NOT NULL,
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS settings (
    tenant_id  TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS releases (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    environment TEXT NOT NULL,
    commit_id   TEXT NOT NULL,
    message     TEXT,
    author      TEXT NOT NULL,
    seq         BIGINT NOT NULL DEFAULT 0,
    created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_project ON commits (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_branches_project ON branches (project_id);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects (tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_sources_tenant ON data_sources (tenant_id);
CREATE INDEX IF NOT EXISTS idx_releases_project ON releases (project_id, environment, seq);
"#;

/// Renames applied **before** the schema is (re)created: a database from an
/// earlier release still uses the `projects` naming, and creating an empty
/// `projects` table first would shadow it. Failures are tolerated — on a fresh
/// database these tables simply do not exist yet.
const RENAME_MIGRATIONS: [&str; 5] = [
    "ALTER TABLE repos RENAME TO projects",
    "ALTER TABLE branches RENAME COLUMN repo_id TO project_id",
    "ALTER TABLE commits RENAME COLUMN repo_id TO project_id",
    "ALTER TABLE working_trees RENAME COLUMN repo_id TO project_id",
    "ALTER TABLE releases RENAME COLUMN repo_id TO project_id",
];

/// Columns added after the initial release. `ALTER TABLE ... ADD COLUMN` has no
/// `IF NOT EXISTS` on every backend, so failures are tolerated (they mean the
/// column already exists).
const MIGRATIONS: [&str; 1] = [
    "ALTER TABLE projects ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'",
];

pub async fn connect(url: &str) -> Result<AnyPool> {
    sqlx::any::install_default_drivers();
    // sqlx's SQLite driver does not create missing files by default, so
    // pre-create an empty file when the URL points at a file path.
    if let Some(path) = sqlite_file_path(url) {
        if !std::path::Path::new(&path).exists() {
            std::fs::File::create(&path)?;
        }
    }
    let pool = AnyPoolOptions::new()
        .max_connections(5)
        .connect(url)
        .await?;
    init_schema(&pool).await?;
    Ok(pool)
}

fn sqlite_file_path(url: &str) -> Option<String> {
    if !url.starts_with("sqlite") || url.contains("memory") {
        return None;
    }
    let rest = url
        .strip_prefix("sqlite://")
        .or_else(|| url.strip_prefix("sqlite:"))
        .unwrap_or(url);
    let path = rest.split('?').next().unwrap_or(rest);
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        path.trim_start_matches('/').to_string()
    };
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

pub async fn init_schema(pool: &AnyPool) -> Result<()> {
    for stmt in RENAME_MIGRATIONS {
        if let Err(err) = sqlx::query(stmt).execute(pool).await {
            tracing::debug!("rename migration skipped ({err}): {stmt}");
        }
    }
    for stmt in SCHEMA_SQL.split(';') {
        let stmt = stmt.trim();
        if stmt.is_empty() {
            continue;
        }
        sqlx::query(stmt).execute(pool).await?;
    }
    for stmt in MIGRATIONS {
        // Tolerated failure: the column already exists on an up-to-date schema.
        if let Err(err) = sqlx::query(stmt).execute(pool).await {
            tracing::debug!("migration skipped ({err}): {stmt}");
        }
    }
    ensure_default_tenant(pool).await?;
    Ok(())
}

/// The default tenant keeps single-tenant deployments working unchanged.
async fn ensure_default_tenant(pool: &AnyPool) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    // `INSERT ... WHERE NOT EXISTS` keeps this idempotent on both backends.
    sqlx::query(
        "INSERT INTO tenants (id, name, description, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = ?)",
    )
    .bind(platform_default_tenant())
    .bind("Default")
    .bind("默认租户（单租户部署使用）")
    .bind(now)
    .bind(now)
    .bind(platform_default_tenant())
    .execute(pool)
    .await?;
    Ok(())
}

fn platform_default_tenant() -> &'static str {
    crate::platform::DEFAULT_TENANT
}

pub fn backend_name(url: &str) -> &'static str {
    if url.starts_with("sqlite") {
        "SQLite"
    } else if url.starts_with("postgres") || url.starts_with("postgresql") {
        "PostgreSQL"
    } else {
        "unknown"
    }
}

pub fn is_sqlite(url: &str) -> bool {
    backend_name(url) == "SQLite"
}

pub fn is_postgres(url: &str) -> bool {
    backend_name(url) == "PostgreSQL"
}
