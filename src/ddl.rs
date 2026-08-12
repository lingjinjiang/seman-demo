use crate::model::*;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct GeneratedDdl {
    pub statements: Vec<String>,
    pub sql: String,
}

fn q(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

fn pg_type(datatype: Option<&str>) -> &'static str {
    match datatype {
        Some("String") => "TEXT",
        Some("Integer") => "BIGINT",
        Some("Decimal") => "NUMERIC",
        Some("Float") => "DOUBLE PRECISION",
        Some("Boolean") => "BOOLEAN",
        Some("Date") => "DATE",
        Some("Time") => "TIME",
        Some("DateTime") => "TIMESTAMP",
        Some("DateTimeTz") => "TIMESTAMPTZ",
        _ => "TEXT",
    }
}

fn field_names(ds: &Value) -> Vec<String> {
    ds.get("fields")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|f| f.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn string_array(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn field_type(ds: &Value, name: &str) -> &'static str {
    if let Some(fields) = ds.get("fields").and_then(|v| v.as_array()) {
        for f in fields {
            if f.get("name").and_then(|n| n.as_str()) == Some(name) {
                return pg_type(f.get("datatype").and_then(|d| d.as_str()));
            }
        }
    }
    "TEXT"
}

/// Generates PostgreSQL DDL that materializes the semantic layer: one table
/// per dataset (columns from fields, primary/unique keys, foreign keys),
/// plus metric definitions and a self-describing model table.
pub fn generate_semantic_ddl(snapshot: &Snapshot, schema: &str) -> GeneratedDdl {
    let schema = if schema.trim().is_empty() {
        "public"
    } else {
        schema.trim()
    };
    let schema_q = q(schema);
    let mut statements = Vec::new();

    let datasets: Vec<(String, Value)> = snapshot
        .iter()
        .filter_map(|(key, body)| {
            let (kind, name) = split_artifact_key(key)?;
            if kind == KIND_DATASET {
                Some((name.to_string(), body.clone()))
            } else {
                None
            }
        })
        .collect();
    let dataset_names: Vec<&str> = datasets.iter().map(|(n, _)| n.as_str()).collect();

    // Collect every column referenced by keys/relationships so the DDL is
    // self-contained even when a model omits a field declaration.
    let mut referenced: std::collections::HashMap<String, Vec<String>> = Default::default();
    for (name, ds) in &datasets {
        let mut cols: Vec<String> = Vec::new();
        if let Some(pk) = ds.get("primary_key") {
            cols.extend(string_array(pk));
        }
        if let Some(uk) = ds.get("unique_keys").and_then(|v| v.as_array()) {
            for k in uk {
                cols.extend(string_array(k));
            }
        }
        referenced.insert(name.clone(), cols);
    }
    for (key, body) in snapshot {
        let Some((kind, _)) = split_artifact_key(key) else {
            continue;
        };
        if kind != KIND_SEMANTIC_REL {
            continue;
        }
        if let Some(from) = body.get("from").and_then(|v| v.as_str()) {
            if let Some(cols) = referenced.get_mut(from) {
                cols.extend(string_array(body.get("from_columns").unwrap_or(&Value::Null)));
            }
        }
        if let Some(to) = body.get("to").and_then(|v| v.as_str()) {
            if let Some(cols) = referenced.get_mut(to) {
                cols.extend(string_array(body.get("to_columns").unwrap_or(&Value::Null)));
            }
        }
    }

    for (name, ds) in &datasets {
        let table = format!("{schema_q}.{}", q(name));
        let mut lines: Vec<String> = Vec::new();
        let mut all_cols = field_names(ds);
        let extra: Vec<String> = referenced
            .get(name)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|c| !all_cols.contains(c))
            .collect();
        all_cols.extend(extra);

        let pk: Vec<String> = ds
            .get("primary_key")
            .map(|v| string_array(v))
            .unwrap_or_default();

        for col in &all_cols {
            let not_null = if pk.contains(col) { " NOT NULL" } else { "" };
            lines.push(format!("    {} {}{}", q(col), field_type(ds, col), not_null));
        }
        if !pk.is_empty() {
            lines.push(format!(
                "    PRIMARY KEY ({})",
                pk.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ")
            ));
        }
        if let Some(unique_keys) = ds.get("unique_keys").and_then(|v| v.as_array()) {
            for uk in unique_keys {
                let cols = string_array(uk);
                if !cols.is_empty() {
                    lines.push(format!(
                        "    UNIQUE ({})",
                        cols.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ")
                    ));
                }
            }
        }
        statements.push(format!(
            "CREATE TABLE IF NOT EXISTS {table} (\n{}\n)",
            lines.join(",\n")
        ));
        if let Some(source) = ds.get("source").and_then(|v| v.as_str()) {
            statements.push(format!(
                "COMMENT ON TABLE {table} IS 'source: {}'",
                source.replace('\'', "''")
            ));
        }
    }

    for (key, body) in snapshot {
        let Some((kind, rel_name)) = split_artifact_key(key) else {
            continue;
        };
        if kind != KIND_SEMANTIC_REL {
            continue;
        }
        let from = body.get("from").and_then(|v| v.as_str());
        let to = body.get("to").and_then(|v| v.as_str());
        let from_cols = body.get("from_columns").map(|v| string_array(v));
        let to_cols = body.get("to_columns").map(|v| string_array(v));
        let (Some(from), Some(to), Some(from_cols), Some(to_cols)) =
            (from, to, from_cols, to_cols)
        else {
            continue;
        };
        if !dataset_names.contains(&from) || !dataset_names.contains(&to) {
            statements.push(format!(
                "-- skipping relationship `{rel_name}`: dataset `{}` or `{to}` is missing",
                if dataset_names.contains(&from) { "present" } else { from }
            ));
            continue;
        }
        if from_cols.is_empty() || from_cols.len() != to_cols.len() {
            continue;
        }
        let fk_name = q(&format!("fk_{rel_name}"));
        let cols = |cs: &[String]| {
            cs.iter()
                .map(|c| q(c))
                .collect::<Vec<_>>()
                .join(", ")
        };
        statements.push(format!(
            "ALTER TABLE {schema_q}.{} ADD CONSTRAINT {fk_name} FOREIGN KEY ({}) REFERENCES {schema_q}.{} ({})",
            q(from),
            cols(&from_cols),
            q(to),
            cols(&to_cols)
        ));
    }

    // Metric definitions: queryable metadata + readable comments.
    let mut metric_comments: Vec<String> = Vec::new();
    let mut metric_rows: Vec<String> = Vec::new();
    for (key, body) in snapshot {
        let Some((kind, mname)) = split_artifact_key(key) else {
            continue;
        };
        if kind != KIND_METRIC {
            continue;
        }
        let datatype = body
            .get("datatype")
            .and_then(|v| v.as_str())
            .unwrap_or("Opaque");
        let exprs: Vec<String> = body
            .get("expression")
            .and_then(|e| e.get("dialects"))
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|d| {
                        let dialect = d.get("dialect")?.as_str()?;
                        let expr = d.get("expression")?.as_str()?;
                        Some(format!("{dialect}: {expr}"))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let expr_text = exprs.join(" | ");
        metric_comments.push(format!("-- Metric {mname} [{datatype}]: {expr_text}"));
        metric_rows.push(format!(
            "({}, {}, {})",
            quote_literal(mname),
            quote_literal(datatype),
            quote_literal(&expr_text)
        ));
    }
    if !metric_rows.is_empty() {
        statements.push(format!(
            "CREATE TABLE IF NOT EXISTS {schema_q}.ossie_metrics (\n    name TEXT PRIMARY KEY,\n    datatype TEXT,\n    expression TEXT\n)"
        ));
        statements.push(format!(
            "INSERT INTO {schema_q}.ossie_metrics (name, datatype, expression) VALUES {}\nON CONFLICT (name) DO UPDATE SET datatype = EXCLUDED.datatype, expression = EXCLUDED.expression",
            metric_rows.join(",\n")
        ));
    }

    // Self-describing model table.
    let model_json = serde_json::to_string(snapshot).unwrap_or_else(|_| "{}".into());
    statements.push(format!(
        "CREATE TABLE IF NOT EXISTS {schema_q}.ossie_model (\n    model_key TEXT PRIMARY KEY,\n    model_json TEXT NOT NULL,\n    updated_at BIGINT NOT NULL\n)"
    ));
    statements.push(format!(
        "INSERT INTO {schema_q}.ossie_model (model_key, model_json, updated_at) VALUES ('ossie-studio', {}, {})\nON CONFLICT (model_key) DO UPDATE SET model_json = EXCLUDED.model_json, updated_at = EXCLUDED.updated_at",
        quote_literal(&model_json),
        crate::vcs::now_millis()
    ));

    let mut sql = statements.join(";\n\n");
    if !metric_comments.is_empty() {
        sql = format!("{}\n\n{}", metric_comments.join("\n"), sql);
    }
    sql.push(';');

    GeneratedDdl { statements, sql }
}

fn quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_snapshot() -> Snapshot {
        let mut snap = Snapshot::new();
        snap.insert(
            artifact_key(KIND_DATASET, "orders"),
            json!({
                "name": "orders",
                "source": "sales.public.orders",
                "primary_key": ["order_id"],
                "fields": [
                    {"name": "order_id", "datatype": "Integer", "expression": {"dialects": [{"dialect": "ANSI_SQL", "expression": "order_id"}]}},
                    {"name": "customer_id", "datatype": "Integer", "expression": {"dialects": [{"dialect": "ANSI_SQL", "expression": "customer_id"}]}},
                    {"name": "amount", "datatype": "Decimal", "expression": {"dialects": [{"dialect": "ANSI_SQL", "expression": "amount"}]}},
                    {"name": "order_date", "datatype": "Date", "dimension": {"is_time": true}, "expression": {"dialects": [{"dialect": "ANSI_SQL", "expression": "order_date"}]}}
                ]
            }),
        );
        snap.insert(
            artifact_key(KIND_DATASET, "customers"),
            json!({
                "name": "customers",
                "source": "sales.public.customers",
                "primary_key": ["id"],
                "fields": [
                    {"name": "id", "datatype": "Integer", "expression": {"dialects": [{"dialect": "ANSI_SQL", "expression": "id"}]}}
                ]
            }),
        );
        snap.insert(
            artifact_key(KIND_SEMANTIC_REL, "orders_to_customers"),
            json!({
                "name": "orders_to_customers",
                "from": "orders",
                "to": "customers",
                "from_columns": ["customer_id"],
                "to_columns": ["id"]
            }),
        );
        snap.insert(
            artifact_key(KIND_METRIC, "total_revenue"),
            json!({
                "name": "total_revenue",
                "datatype": "Decimal",
                "expression": {"dialects": [{"dialect": "ANSI_SQL", "expression": "SUM(orders.amount)"}]}
            }),
        );
        snap
    }

    #[test]
    fn generates_tables_keys_and_metrics() {
        let ddl = generate_semantic_ddl(&sample_snapshot(), "analytics");
        let sql = &ddl.sql;
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS \"analytics\".\"orders\""));
        assert!(sql.contains("PRIMARY KEY (\"order_id\")"));
        assert!(sql.contains("\"amount\" NUMERIC"));
        assert!(sql.contains("\"order_date\" DATE"));
        assert!(sql.contains("ADD CONSTRAINT \"fk_orders_to_customers\" FOREIGN KEY (\"customer_id\") REFERENCES \"analytics\".\"customers\" (\"id\")"));
        assert!(sql.contains("total_revenue"));
        assert!(sql.contains("ossie_metrics"));
        assert!(sql.contains("ossie_model"));
    }

    #[test]
    fn auto_adds_missing_referenced_columns() {
        let mut snap = sample_snapshot();
        snap.insert(
            artifact_key(KIND_DATASET, "order_lines"),
            json!({
                "name": "order_lines",
                "primary_key": ["order_id", "line_no"],
                "fields": [{"name": "line_no", "datatype": "Integer"}]
            }),
        );
        let ddl = generate_semantic_ddl(&snap, "public");
        assert!(ddl.sql.contains("\"order_id\" TEXT NOT NULL"));
    }
}
