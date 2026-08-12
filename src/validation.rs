use crate::model::*;
use serde_json::Value;
use std::collections::HashSet;

pub fn validate_snapshot(snapshot: &Snapshot) -> Vec<Issue> {
    let mut issues = Vec::new();
    for (key, body) in snapshot {
        let Some((kind, name)) = split_artifact_key(key) else {
            issues.push(Issue::error(key, "invalid artifact key"));
            continue;
        };
        if !body.is_object() {
            issues.push(Issue::error(key, "artifact body must be a JSON object"));
            continue;
        }
        match kind {
            KIND_CONCEPT => validate_concept(name, body, snapshot, &mut issues),
            KIND_ONTOLOGY_REL => validate_ontology_relationship(name, body, snapshot, &mut issues),
            KIND_DATASET => validate_dataset(name, body, snapshot, &mut issues),
            KIND_SEMANTIC_REL => validate_semantic_relationship(name, body, snapshot, &mut issues),
            KIND_METRIC => validate_metric(name, body, snapshot, &mut issues),
            _ => {}
        }
    }
    issues
}

pub fn has_errors(issues: &[Issue]) -> bool {
    issues.iter().any(|i| i.level == "error")
}

fn concept_exists(snapshot: &Snapshot, name: &str) -> bool {
    BUILTIN_CONCEPTS.contains(&name) || snapshot.contains_key(&artifact_key(KIND_CONCEPT, name))
}

fn str_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn validate_expression(path: &str, value: &Value, issues: &mut Vec<Issue>) {
    let Some(dialects) = value.get("dialects").and_then(|v| v.as_array()) else {
        issues.push(Issue::error(
            format!("{path}.expression.dialects"),
            "expression.dialects must be a non-empty array",
        ));
        return;
    };
    if dialects.is_empty() {
        issues.push(Issue::error(
            format!("{path}.expression.dialects"),
            "expression.dialects must not be empty",
        ));
    }
    for (i, d) in dialects.iter().enumerate() {
        let p = format!("{path}.expression.dialects[{i}]");
        let Some(dialect) = d.get("dialect").and_then(|v| v.as_str()) else {
            issues.push(Issue::error(&p, "dialect is required"));
            continue;
        };
        if !DIALECTS.contains(&dialect) {
            issues.push(Issue::error(
                &p,
                format!(
                    "unknown dialect `{dialect}`; expected one of {:?}",
                    DIALECTS
                ),
            ));
        }
        let expr = d.get("expression").and_then(|v| v.as_str());
        if expr.is_none() || expr.unwrap().trim().is_empty() {
            issues.push(Issue::error(&p, "expression string is required"));
        }
    }
}

fn validate_datatype(path: &str, value: &Value, issues: &mut Vec<Issue>) {
    if let Some(dt) = value.as_str() {
        if !DATA_TYPES.contains(&dt) {
            issues.push(Issue::error(
                path,
                format!("unknown datatype `{dt}`; expected one of {:?}", DATA_TYPES),
            ));
        }
    } else if !value.is_null() {
        issues.push(Issue::error(path, "datatype must be a string"));
    }
}

fn validate_ai_context(path: &str, value: &Value, issues: &mut Vec<Issue>) {
    if !value.is_string() && !value.is_object() && !value.is_null() {
        issues.push(Issue::warning(
            path,
            "ai_context should be a string or object",
        ));
    }
}

fn validate_concept(name: &str, body: &Value, snapshot: &Snapshot, issues: &mut Vec<Issue>) {
    let path = format!("ontology.concepts.{name}");
    if let Some(bn) = body.get("name").and_then(|v| v.as_str()) {
        if bn != name {
            issues.push(Issue::warning(
                &path,
                format!("body.name `{bn}` differs from artifact key `{name}`"),
            ));
        }
    }
    let Some(ctype) = body.get("type").and_then(|v| v.as_str()) else {
        issues.push(Issue::error(&path, "type is required (EntityType | ValueType)"));
        return;
    };
    if !CONCEPT_TYPES.contains(&ctype) {
        issues.push(Issue::error(
            &path,
            format!("unknown concept type `{ctype}`; expected {:?}", CONCEPT_TYPES),
        ));
    }

    let extends = body
        .get("extends")
        .map(|v| str_list(v))
        .unwrap_or_default();
    let mut visited: HashSet<String> = HashSet::new();
    let mut ok_supertype = false;
    for sup in &extends {
        if !concept_exists(snapshot, sup) {
            issues.push(Issue::error(
                format!("{path}.extends"),
                format!("supertype `{sup}` does not exist"),
            ));
        }
        if BUILTIN_CONCEPTS.contains(&sup.as_str()) && sup != "Any" {
            ok_supertype = true;
        }
    }
    // Detect extends cycles and resolve transitive supertypes.
    let mut stack: Vec<String> = extends.clone();
    while let Some(cur) = stack.pop() {
        if !visited.insert(cur.clone()) {
            issues.push(Issue::error(
                format!("{path}.extends"),
                format!("extends cycle detected at `{cur}`"),
            ));
            continue;
        }
        if BUILTIN_CONCEPTS.contains(&cur.as_str()) && cur != "Any" {
            ok_supertype = true;
            continue;
        }
        if let Some(parent_body) = snapshot.get(&artifact_key(KIND_CONCEPT, &cur)) {
            for sup in str_list(parent_body.get("extends").unwrap_or(&Value::Null)) {
                stack.push(sup);
            }
        }
    }
    if ctype == "ValueType" && !ok_supertype {
        issues.push(Issue::error(
            &path,
            "value type must (transitively) extend one of Boolean, Date, DateTime, Decimal, Float, Integer or String",
        ));
    }
    if ctype == "EntityType" && extends.iter().any(|e| BUILTIN_CONCEPTS.contains(&e.as_str()) && e != "Any") {
        issues.push(Issue::error(
            &path,
            "entity type concepts can only extend other entity type concepts",
        ));
    }

    for (field, label) in [
        ("derived_by", "derived_by"),
        ("requires", "requires"),
    ] {
        if let Some(v) = body.get(field) {
            if let Some(arr) = v.as_array() {
                for (i, e) in arr.iter().enumerate() {
                    if !e.is_string() {
                        issues.push(Issue::error(
                            format!("{path}.{label}[{i}]"),
                            "expression must be a string",
                        ));
                    }
                }
            } else {
                issues.push(Issue::error(format!("{path}.{label}"), "must be an array"));
            }
        }
    }

    if let Some(id_by) = body.get("identify_by") {
        for r in str_list(id_by) {
            let rel_key = artifact_key(KIND_ONTOLOGY_REL, &format!("{name}.{r}"));
            if !snapshot.contains_key(&rel_key) {
                issues.push(Issue::error(
                    format!("{path}.identify_by"),
                    format!("identifying relationship `{name}.{r}` does not exist"),
                ));
            }
        }
    }

    if let Some(ai) = body.get("ai_context") {
        validate_ai_context(&format!("{path}.ai_context"), ai, issues);
    }
    if let Some(rels) = body.get("relationships") {
        issues.push(Issue::warning(
            &path,
            "relationships are managed as separate ontology_relationship artifacts; nested `relationships` in a concept body is ignored on export",
        ));
        let _ = rels;
    }
}

fn validate_ontology_relationship(
    name: &str,
    body: &Value,
    snapshot: &Snapshot,
    issues: &mut Vec<Issue>,
) {
    let Some((owner, rel_name)) = name.split_once('.') else {
        issues.push(Issue::error(
            name,
            "ontology relationship key must be `<Concept>.<relationship>`",
        ));
        return;
    };
    let path = format!("ontology.relationships.{name}");
    if !concept_exists(snapshot, owner) {
        issues.push(Issue::error(
            &path,
            format!("owner concept `{owner}` does not exist"),
        ));
    }
    if let Some(bn) = body.get("name").and_then(|v| v.as_str()) {
        if bn != rel_name {
            issues.push(Issue::warning(
                &path,
                format!("body.name `{bn}` differs from relationship key `{rel_name}`"),
            ));
        }
    }

    let verbalizes = body.get("verbalizes").and_then(|v| v.as_array());
    match verbalizes {
        Some(arr) if !arr.is_empty() && arr.iter().all(|v| v.is_string()) => {}
        _ => issues.push(Issue::error(
            &path,
            "verbalizes is required and must be a non-empty array of strings",
        )),
    }

    if let Some(m) = body.get("multiplicity").and_then(|v| v.as_str()) {
        if !MULTIPLICITIES.contains(&m) {
            issues.push(Issue::error(
                format!("{path}.multiplicity"),
                format!("unknown multiplicity `{m}`; expected {:?}", MULTIPLICITIES),
            ));
        }
    }

    let mut seen_concepts: Vec<(String, Option<String>)> = vec![(owner.to_string(), None)];
    if let Some(roles) = body.get("roles").and_then(|v| v.as_array()) {
        for (i, role) in roles.iter().enumerate() {
            let rp = format!("{path}.roles[{i}]");
            let Some(concept) = role.get("concept").and_then(|v| v.as_str()) else {
                issues.push(Issue::error(&rp, "role.concept is required"));
                continue;
            };
            if !concept_exists(snapshot, concept) {
                issues.push(Issue::error(
                    &rp,
                    format!("role concept `{concept}` does not exist"),
                ));
            }
            let rname = role.get("name").and_then(|v| v.as_str()).map(String::from);
            seen_concepts.push((concept.to_string(), rname));
        }
    }
    // Disambiguate roles that share a concept: each must have a unique explicit name.
    let mut counts: std::collections::HashMap<&str, usize> = Default::default();
    for (c, _) in &seen_concepts {
        *counts.entry(c.as_str()).or_insert(0) += 1;
    }
    let mut used_names: HashSet<String> = HashSet::new();
    for (i, (c, rname)) in seen_concepts.iter().enumerate() {
        if counts.get(c.as_str()).copied().unwrap_or(0) > 1 && rname.is_none() {
            issues.push(Issue::error(
                &path,
                format!(
                    "concept `{c}` plays multiple roles; role at position {i} needs a distinguishing name"
                ),
            ));
        }
        if let Some(rn) = rname {
            if !used_names.insert(rn.clone()) {
                issues.push(Issue::error(
                    &path,
                    format!("duplicate role name `{rn}`"),
                ));
            }
        }
    }

    for (field, label) in [("derived_by", "derived_by"), ("requires", "requires")] {
        if let Some(v) = body.get(field) {
            if let Some(arr) = v.as_array() {
                for (i, e) in arr.iter().enumerate() {
                    if !e.is_string() {
                        issues.push(Issue::error(
                            format!("{path}.{label}[{i}]"),
                            "expression must be a string",
                        ));
                    }
                }
            } else {
                issues.push(Issue::error(format!("{path}.{label}"), "must be an array"));
            }
        }
    }
    if let Some(ai) = body.get("ai_context") {
        validate_ai_context(&format!("{path}.ai_context"), ai, issues);
    }
}

fn validate_dataset(name: &str, body: &Value, snapshot: &Snapshot, issues: &mut Vec<Issue>) {
    let path = format!("semantic.datasets.{name}");
    if let Some(bn) = body.get("name").and_then(|v| v.as_str()) {
        if bn != name {
            issues.push(Issue::warning(
                &path,
                format!("body.name `{bn}` differs from artifact key `{name}`"),
            ));
        }
    }
    if body.get("source").is_none() {
        issues.push(Issue::warning(
            &path,
            "source is recommended (physical table/view reference)",
        ));
    }

    let mut field_names: Vec<String> = Vec::new();
    if let Some(fields) = body.get("fields").and_then(|v| v.as_array()) {
        for (i, f) in fields.iter().enumerate() {
            let fp = format!("{path}.fields[{i}]");
            let Some(fname) = f.get("name").and_then(|v| v.as_str()) else {
                issues.push(Issue::error(&fp, "field name is required"));
                continue;
            };
            if field_names.contains(&fname.to_string()) {
                issues.push(Issue::error(
                    &fp,
                    format!("duplicate field name `{fname}`"),
                ));
            }
            field_names.push(fname.to_string());
            if let Some(expr) = f.get("expression") {
                validate_expression(&fp, expr, issues);
            }
            if let Some(dt) = f.get("datatype") {
                validate_datatype(&format!("{fp}.datatype"), dt, issues);
            }
            if let Some(dim) = f.get("dimension") {
                if let Some(is_time) = dim.get("is_time") {
                    if !is_time.is_boolean() {
                        issues.push(Issue::error(
                            format!("{fp}.dimension.is_time"),
                            "is_time must be a boolean",
                        ));
                    }
                }
            }
            if let Some(ai) = f.get("ai_context") {
                validate_ai_context(&format!("{fp}.ai_context"), ai, issues);
            }
        }
    } else {
        issues.push(Issue::warning(&path, "dataset has no fields"));
    }

    for (i, pk) in body
        .get("primary_key")
        .map(|v| str_list(v))
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        if !field_names.iter().any(|f| f == pk) {
            issues.push(Issue::warning(
                format!("{path}.primary_key[{i}]"),
                format!("primary key column `{pk}` is not declared as a field"),
            ));
        }
    }
    if let Some(unique_keys) = body.get("unique_keys").and_then(|v| v.as_array()) {
        for (i, uk) in unique_keys.iter().enumerate() {
            let cols = str_list(uk);
            if cols.is_empty() {
                issues.push(Issue::error(
                    format!("{path}.unique_keys[{i}]"),
                    "unique key must contain at least one column",
                ));
            }
            for c in cols {
                if !field_names.iter().any(|f| f == &c) {
                    issues.push(Issue::warning(
                        format!("{path}.unique_keys[{i}]"),
                        format!("unique key column `{c}` is not declared as a field"),
                    ));
                }
            }
        }
    }
    if let Some(ai) = body.get("ai_context") {
        validate_ai_context(&format!("{path}.ai_context"), ai, issues);
    }
    let _ = snapshot;
}

fn validate_semantic_relationship(
    name: &str,
    body: &Value,
    snapshot: &Snapshot,
    issues: &mut Vec<Issue>,
) {
    let path = format!("semantic.relationships.{name}");
    if let Some(bn) = body.get("name").and_then(|v| v.as_str()) {
        if bn != name {
            issues.push(Issue::warning(
                &path,
                format!("body.name `{bn}` differs from artifact key `{name}`"),
            ));
        }
    }
    let from = body.get("from").and_then(|v| v.as_str());
    let to = body.get("to").and_then(|v| v.as_str());
    for (label, c) in [("from", from), ("to", to)] {
        if let Some(c) = c {
            if !snapshot.contains_key(&artifact_key(KIND_DATASET, c)) {
                issues.push(Issue::error(
                    format!("{path}.{label}"),
                    format!("dataset `{c}` does not exist"),
                ));
            }
        } else {
            issues.push(Issue::error(format!("{path}.{label}"), "is required"));
        }
    }
    let from_cols = body.get("from_columns").map(|v| str_list(v));
    let to_cols = body.get("to_columns").map(|v| str_list(v));
    match (&from_cols, &to_cols) {
        (Some(f), Some(t)) => {
            if f.is_empty() {
                issues.push(Issue::error(&path, "from_columns must not be empty"));
            }
            if t.is_empty() {
                issues.push(Issue::error(&path, "to_columns must not be empty"));
            }
            if f.len() != t.len() {
                issues.push(Issue::error(
                    &path,
                    "from_columns and to_columns must have the same length",
                ));
            }
        }
        _ => {
            issues.push(Issue::error(
                &path,
                "from_columns and to_columns are required",
            ));
        }
    }
    if let (Some(f), Some(ds)) = (from_cols, from.and_then(|c| snapshot.get(&artifact_key(KIND_DATASET, c))))
    {
        let names = dataset_field_names(ds);
        for c in &f {
            if !names.contains(c) {
                issues.push(Issue::warning(
                    format!("{path}.from_columns"),
                    format!("column `{c}` is not declared in dataset `{}`", from.unwrap_or_default()),
                ));
            }
        }
    }
    if let (Some(t), Some(ds)) = (to_cols, to.and_then(|c| snapshot.get(&artifact_key(KIND_DATASET, c))))
    {
        let names = dataset_field_names(ds);
        for c in &t {
            if !names.contains(c) {
                issues.push(Issue::warning(
                    format!("{path}.to_columns"),
                    format!("column `{c}` is not declared in dataset `{}`", to.unwrap_or_default()),
                ));
            }
        }
    }
    if let Some(ai) = body.get("ai_context") {
        validate_ai_context(&format!("{path}.ai_context"), ai, issues);
    }
}

fn dataset_field_names(ds: &Value) -> Vec<String> {
    ds.get("fields")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|f| f.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn validate_metric(name: &str, body: &Value, _snapshot: &Snapshot, issues: &mut Vec<Issue>) {
    let path = format!("semantic.metrics.{name}");
    if let Some(bn) = body.get("name").and_then(|v| v.as_str()) {
        if bn != name {
            issues.push(Issue::warning(
                &path,
                format!("body.name `{bn}` differs from artifact key `{name}`"),
            ));
        }
    }
    match body.get("expression") {
        Some(expr) => validate_expression(&path, expr, issues),
        None => issues.push(Issue::error(&path, "expression is required")),
    }
    if let Some(dt) = body.get("datatype") {
        validate_datatype(&format!("{path}.datatype"), dt, issues);
    }
    if let Some(ai) = body.get("ai_context") {
        validate_ai_context(&format!("{path}.ai_context"), ai, issues);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn concept_validation_catches_bad_type() {
        let mut snap = Snapshot::new();
        snap.insert(
            artifact_key(KIND_CONCEPT, "Person"),
            json!({"name": "Person", "type": "EntityType"}),
        );
        snap.insert(
            artifact_key(KIND_CONCEPT, "Bad"),
            json!({"name": "Bad", "type": "WrongType"}),
        );
        let issues = validate_snapshot(&snap);
        assert!(has_errors(&issues));
        assert!(issues.iter().any(|i| i.message.contains("WrongType")));
    }

    #[test]
    fn value_type_must_extend_builtin() {
        let mut snap = Snapshot::new();
        snap.insert(
            artifact_key(KIND_CONCEPT, "SSN"),
            json!({"name": "SSN", "type": "ValueType"}),
        );
        let issues = validate_snapshot(&snap);
        assert!(has_errors(&issues));
    }

    #[test]
    fn relationship_references_missing_concept() {
        let mut snap = Snapshot::new();
        snap.insert(
            artifact_key(KIND_CONCEPT, "Person"),
            json!({"name": "Person", "type": "EntityType"}),
        );
        snap.insert(
            artifact_key(KIND_ONTOLOGY_REL, "Person.earns"),
            json!({
                "name": "earns",
                "roles": [{"concept": "Salary"}],
                "verbalizes": ["{Person} earns {Salary}"]
            }),
        );
        let issues = validate_snapshot(&snap);
        assert!(has_errors(&issues));
        assert!(issues.iter().any(|i| i.message.contains("Salary")));
    }
}
