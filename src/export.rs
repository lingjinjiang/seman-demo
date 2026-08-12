use crate::model::*;
use anyhow::{bail, Result};
use serde_json::{json, Map, Value};

pub const OSSIE_VERSION: &str = "0.2.0.dev0";

/// Builds a spec-shaped Ossie document from a snapshot:
/// top-level `version`, `name`, optional `ontology` (concepts with nested
/// relationships) and `semantic_model` (datasets / relationships / metrics).
pub fn snapshot_to_doc(snapshot: &Snapshot, name: &str, description: Option<&str>) -> Value {
    let mut ontology: Vec<Value> = Vec::new();
    for (key, body) in snapshot {
        let Some((kind, cname)) = split_artifact_key(key) else {
            continue;
        };
        if kind != KIND_CONCEPT {
            continue;
        }
        let mut comp = body.as_object().cloned().unwrap_or_default();
        comp.remove("relationships");
        comp.remove("name");
        comp.insert("concept".into(), Value::String(cname.to_string()));
        let rels: Vec<Value> = snapshot
            .iter()
            .filter_map(|(rk, rb)| {
                let (k, n) = split_artifact_key(rk)?;
                if k == KIND_ONTOLOGY_REL && n.starts_with(&format!("{cname}.")) {
                    Some(rb.clone())
                } else {
                    None
                }
            })
            .collect();
        if !rels.is_empty() {
            comp.insert("relationships".into(), Value::Array(rels));
        }
        ontology.push(Value::Object(comp));
    }

    let mut datasets = Vec::new();
    let mut semantic_rels = Vec::new();
    let mut metrics = Vec::new();
    for (key, body) in snapshot {
        match split_artifact_key(key) {
            Some((KIND_DATASET, _)) => datasets.push(body.clone()),
            Some((KIND_SEMANTIC_REL, _)) => semantic_rels.push(body.clone()),
            Some((KIND_METRIC, _)) => metrics.push(body.clone()),
            _ => {}
        }
    }

    let mut sm = Map::new();
    sm.insert("name".into(), Value::String(name.to_string()));
    if let Some(d) = description {
        sm.insert("description".into(), Value::String(d.to_string()));
    }
    sm.insert("datasets".into(), Value::Array(datasets));
    sm.insert("relationships".into(), Value::Array(semantic_rels));
    sm.insert("metrics".into(), Value::Array(metrics));
    sm.insert("custom_extensions".into(), Value::Array(vec![]));

    let mut doc = Map::new();
    doc.insert("version".into(), json!(OSSIE_VERSION));
    doc.insert("name".into(), json!(name));
    if let Some(d) = description {
        doc.insert("description".into(), json!(d));
    }
    if !ontology.is_empty() {
        doc.insert("ontology".into(), Value::Array(ontology));
    }
    doc.insert("semantic_model".into(), Value::Array(vec![Value::Object(sm)]));
    Value::Object(doc)
}

/// Inverse of `snapshot_to_doc`: splits nested concepts/relationships and the
/// semantic model back into flat snapshot artifacts.
pub fn doc_to_snapshot(doc: &Value) -> Result<Snapshot> {
    let mut snap = Snapshot::new();

    if let Some(ontology) = doc.get("ontology").and_then(|v| v.as_array()) {
        for comp in ontology {
            let Some(cname) = comp.get("concept").and_then(|v| v.as_str()) else {
                bail!("ontology component missing `concept` name");
            };
            let mut body = comp.clone();
            let rels = body
                .as_object_mut()
                .and_then(|o| o.remove("relationships"));
            if let Some(obj) = body.as_object_mut() {
                if let Some(c) = obj.remove("concept") {
                    obj.insert("name".into(), c);
                }
            }
            snap.insert(artifact_key(KIND_CONCEPT, cname), body);
            if let Some(Value::Array(rels)) = rels {
                for rel in rels {
                    let Some(rname) = rel.get("name").and_then(|v| v.as_str()) else {
                        bail!("relationship inside `{cname}` is missing a name");
                    };
                    snap.insert(
                        artifact_key(KIND_ONTOLOGY_REL, &format!("{cname}.{rname}")),
                        rel,
                    );
                }
            }
        }
    }

    if let Some(models) = doc.get("semantic_model").and_then(|v| v.as_array()) {
        for model in models {
            if let Some(Value::Array(datasets)) = model.get("datasets") {
                for ds in datasets {
                    let Some(dname) = ds.get("name").and_then(|v| v.as_str()) else {
                        bail!("semantic model contains a dataset without a name");
                    };
                    snap.insert(artifact_key(KIND_DATASET, dname), ds.clone());
                }
            }
            if let Some(Value::Array(rels)) = model.get("relationships") {
                for rel in rels {
                    let Some(rname) = rel.get("name").and_then(|v| v.as_str()) else {
                        bail!("semantic model contains a relationship without a name");
                    };
                    snap.insert(artifact_key(KIND_SEMANTIC_REL, rname), rel.clone());
                }
            }
            if let Some(Value::Array(metrics)) = model.get("metrics") {
                for metric in metrics {
                    let Some(mname) = metric.get("name").and_then(|v| v.as_str()) else {
                        bail!("semantic model contains a metric without a name");
                    };
                    snap.insert(artifact_key(KIND_METRIC, mname), metric.clone());
                }
            }
        }
    }
    Ok(snap)
}

pub fn to_yaml(doc: &Value) -> Result<String> {
    Ok(serde_yaml::to_string(doc)?)
}

pub fn to_json(doc: &Value) -> Result<String> {
    Ok(serde_json::to_string_pretty(doc)?)
}

pub fn parse_doc(content: &str, format: &str) -> Result<Value> {
    match format {
        "yaml" | "yml" => Ok(serde_yaml::from_str(content)?),
        "json" => Ok(serde_json::from_str(content)?),
        other => bail!("unsupported format `{other}` (expected yaml or json)"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trip_snapshot_doc_snapshot() {
        let mut snap = Snapshot::new();
        snap.insert(
            artifact_key(KIND_CONCEPT, "Person"),
            json!({"name": "Person", "type": "EntityType", "identify_by": ["nr"]}),
        );
        snap.insert(
            artifact_key(KIND_ONTOLOGY_REL, "Person.nr"),
            json!({
                "name": "nr",
                "roles": [{"concept": "SSN"}],
                "multiplicity": "OneToOne",
                "verbalizes": ["{Person} is identified by {SSN}"]
            }),
        );
        snap.insert(
            artifact_key(KIND_CONCEPT, "SSN"),
            json!({"name": "SSN", "type": "ValueType", "extends": ["String"]}),
        );
        snap.insert(
            artifact_key(KIND_DATASET, "orders"),
            json!({"name": "orders", "source": "sales.orders", "fields": []}),
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
                "expression": {"dialects": [{"dialect": "ANSI_SQL", "expression": "SUM(orders.amount)"}]}
            }),
        );

        let doc = snapshot_to_doc(&snap, "test", None);
        let yaml = to_yaml(&doc).unwrap();
        let reparsed = parse_doc(&yaml, "yaml").unwrap();
        let snap2 = doc_to_snapshot(&reparsed).unwrap();
        assert_eq!(snap, snap2);
    }

    #[test]
    fn bundled_sample_model_imports_and_validates() {
        let content = std::fs::read_to_string("examples/sample_model.yaml")
            .expect("sample model should exist");
        let doc = parse_doc(&content, "yaml").unwrap();
        let snap = doc_to_snapshot(&doc).unwrap();
        let issues = crate::validation::validate_snapshot(&snap);
        assert!(
            !crate::validation::has_errors(&issues),
            "sample model has errors: {issues:?}"
        );
        assert_eq!(snap.len(), 11);
    }
}
