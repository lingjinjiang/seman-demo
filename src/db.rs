use anyhow::Result;
use sqlx::any::AnyPoolOptions;
use sqlx::AnyPool;

/// Schema uses only types understood by both SQLite and PostgreSQL
/// (TEXT / INTEGER / BOOLEAN), so a single DDL works on either backend.
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS repos (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    description    TEXT,
    head_branch_id TEXT,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
    id              TEXT PRIMARY KEY,
    repo_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    head_commit_id  TEXT,
    is_default      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE (repo_id, name)
);

CREATE TABLE IF NOT EXISTS commits (
    id               TEXT PRIMARY KEY,
    repo_id          TEXT NOT NULL,
    branch_id        TEXT,
    message          TEXT NOT NULL,
    author           TEXT NOT NULL,
    parent_commit_id TEXT,
    parent2_commit_id TEXT,
    tree_json        TEXT NOT NULL,
    created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS working_trees (
    repo_id        TEXT NOT NULL,
    branch_id      TEXT NOT NULL,
    base_commit_id TEXT,
    tree_json      TEXT NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (repo_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits (repo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_branches_repo ON branches (repo_id);
"#;

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
    for stmt in SCHEMA_SQL.split(';') {
        let stmt = stmt.trim();
        if stmt.is_empty() {
            continue;
        }
        sqlx::query(stmt).execute(pool).await?;
    }
    Ok(())
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
