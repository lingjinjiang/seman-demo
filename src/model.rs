use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Artifact kinds (Ossie spec sections)
// ---------------------------------------------------------------------------

pub const KIND_CONCEPT: &str = "concept";
pub const KIND_ONTOLOGY_REL: &str = "ontology_relationship";
pub const KIND_DATASET: &str = "dataset";
pub const KIND_SEMANTIC_REL: &str = "semantic_relationship";
pub const KIND_METRIC: &str = "metric";

pub const ALL_KINDS: [&str; 5] = [
    KIND_CONCEPT,
    KIND_ONTOLOGY_REL,
    KIND_DATASET,
    KIND_SEMANTIC_REL,
    KIND_METRIC,
];

pub const BUILTIN_CONCEPTS: [&str; 8] = [
    "Any", "Boolean", "Date", "DateTime", "Decimal", "Float", "Integer", "String",
];

pub const CONCEPT_TYPES: [&str; 2] = ["EntityType", "ValueType"];
pub const MULTIPLICITIES: [&str; 2] = ["ManyToOne", "OneToOne"];
pub const DIALECTS: [&str; 7] = [
    "ANSI_SQL",
    "SNOWFLAKE",
    "MDX",
    "TABLEAU",
    "DATABRICKS",
    "MAQL",
    "BIGQUERY",
];
pub const DATA_TYPES: [&str; 10] = [
    "String",
    "Integer",
    "Decimal",
    "Float",
    "Boolean",
    "Date",
    "Time",
    "DateTime",
    "DateTimeTz",
    "Opaque",
];

pub fn artifact_key(kind: &str, key: &str) -> String {
    format!("{kind}:{key}")
}

pub fn split_artifact_key(key: &str) -> Option<(&str, &str)> {
    let (kind, name) = key.split_once(':')?;
    if ALL_KINDS.contains(&kind) {
        Some((kind, name))
    } else {
        None
    }
}

/// Snapshot of a working tree or commit: `kind:key` -> Ossie artifact body.
pub type Snapshot = BTreeMap<String, Value>;

pub fn empty_snapshot() -> Snapshot {
    BTreeMap::new()
}

// ---------------------------------------------------------------------------
// Persistence rows
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RepoRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub head_branch_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRow {
    pub id: String,
    pub repo_id: String,
    pub name: String,
    pub head_commit_id: Option<String>,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl sqlx::FromRow<'_, sqlx::any::AnyRow> for BranchRow {
    fn from_row(row: &sqlx::any::AnyRow) -> sqlx::Result<Self> {
        use sqlx::Row;
        Ok(BranchRow {
            id: row.try_get("id")?,
            repo_id: row.try_get("repo_id")?,
            name: row.try_get("name")?,
            head_commit_id: row.try_get("head_commit_id")?,
            is_default: row.try_get::<i64, _>("is_default")? != 0,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    pub id: String,
    pub repo_id: String,
    pub branch_id: Option<String>,
    pub message: String,
    pub author: String,
    pub parent_commit_id: Option<String>,
    pub parent2_commit_id: Option<String>,
    pub tree_json: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDto {
    pub id: String,
    pub repo_id: String,
    pub message: String,
    pub author: String,
    pub parent_commit_id: Option<String>,
    pub parent2_commit_id: Option<String>,
    pub created_at: i64,
    pub branches: Vec<String>,
    pub tree: Snapshot,
}

impl CommitDto {
    pub fn from_row(row: CommitRow, branches: Vec<String>) -> anyhow::Result<Self> {
        Ok(CommitDto {
            id: row.id,
            repo_id: row.repo_id,
            message: row.message,
            author: row.author,
            parent_commit_id: row.parent_commit_id,
            parent2_commit_id: row.parent2_commit_id,
            created_at: row.created_at,
            branches,
            tree: serde_json::from_str(&row.tree_json)?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDto {
    pub repo: RepoRow,
    pub branch: Option<BranchRow>,
    pub commits: Vec<CommitDto>,
}

// ---------------------------------------------------------------------------
// Validation issue
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub level: String, // "error" | "warning"
    pub path: String,
    pub message: String,
}

impl Issue {
    pub fn error(path: impl Into<String>, message: impl Into<String>) -> Self {
        Issue {
            level: "error".into(),
            path: path.into(),
            message: message.into(),
        }
    }

    pub fn warning(path: impl Into<String>, message: impl Into<String>) -> Self {
        Issue {
            level: "warning".into(),
            path: path.into(),
            message: message.into(),
        }
    }
}
