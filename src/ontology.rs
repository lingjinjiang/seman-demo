// Ontology relationship semantics.
//
// Encodes the rules the design outline (docs/design/design-ouline.md §4) lays
// out on top of the Apache Ossie ontology spec (../ossie/ontology/ontology.md):
//
//  - the first role of a relationship is always played by the owner concept;
//    `roles` lists the *additional* roles in order;
//  - `multiplicity` only means something when a relationship has more than one
//    role — `ManyToOne` constrains the last role, `OneToOne` is defined for
//    binary relationships only, and "many-to-many" is expressed by leaving it
//    empty;
//  - unary facts are node badges, n-ary facts are virtual entities (hubs) that
//    may be promoted to real entities or demoted back.
//
// Everything here is a pure function over a Snapshot so the compiler-style
// discipline (ddl.rs, future query.rs) is preserved.

use crate::model::*;
use serde_json::Value;
use std::collections::HashSet;

// A role in a relationship: the concept that plays it plus an optional
// distinguishing name (required when the same concept plays several roles).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Role {
    pub concept: String,
    pub name: Option<String>,
}

impl Role {
    // Role name used by expressions; defaults to the playing concept's name.
    pub fn ref_name(&self) -> &str {
        self.name.as_deref().unwrap_or(&self.concept)
    }
}

// Relationship arity derived from the role list (owner counts as first role).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arity {
    Unary,
    Binary,
    Nary,
}

impl Arity {
    pub fn from_role_count(count: usize) -> Self {
        match count {
            0 | 1 => Arity::Unary,
            2 => Arity::Binary,
            _ => Arity::Nary,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Arity::Unary => "unary",
            Arity::Binary => "binary",
            Arity::Nary => "n-ary",
        }
    }
}

// Additional roles declared under a relationship body (the `roles` array).
pub fn additional_roles(body: &Value) -> Vec<Role> {
    body.get("roles")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    let concept = r.get("concept").and_then(|c| c.as_str())?;
                    Some(Role {
                        concept: concept.to_string(),
                        name: r.get("name").and_then(|n| n.as_str()).map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

// Total role count: the implicit owner role plus the additional roles.
pub fn role_count(body: &Value) -> usize {
    1 + additional_roles(body).len()
}

// Relationship arity from its body.
pub fn arity(body: &Value) -> Arity {
    Arity::from_role_count(role_count(body))
}

// Declared multiplicity, if any.
pub fn multiplicity(body: &Value) -> Option<&str> {
    body.get("multiplicity").and_then(|v| v.as_str())
}

// Per spec, multiplicity only constrains relationships comprising more than
// one role; a unary relationship (owner only) must not carry one.
pub fn multiplicity_allowed(a: Arity) -> bool {
    !matches!(a, Arity::Unary)
}

// `OneToOne` is many-to-one in both directions and is only defined for
// binary relationships.
pub fn one_to_one_allowed(a: Arity) -> bool {
    matches!(a, Arity::Binary)
}

// True when the concept is a built-in value type or a user ValueType.
pub fn is_value_type(snapshot: &Snapshot, concept: &str) -> bool {
    if BUILTIN_CONCEPTS.contains(&concept) {
        return concept != "Any";
    }
    snapshot
        .get(&artifact_key(KIND_CONCEPT, concept))
        .and_then(|b| b.get("type"))
        .and_then(|v| v.as_str())
        == Some("ValueType")
}

// True when the concept is `Boolean` or transitively extends it.
pub fn is_boolean_like(snapshot: &Snapshot, concept: &str) -> bool {
    if concept == "Boolean" {
        return true;
    }
    let mut cur = concept.to_string();
    let mut seen: HashSet<String> = HashSet::new();
    while seen.insert(cur.clone()) {
        let Some(body) = snapshot.get(&artifact_key(KIND_CONCEPT, &cur)) else {
            return false;
        };
        let Some(extends) = body.get("extends").and_then(|v| v.as_array()) else {
            return false;
        };
        let mut next: Option<String> = None;
        for sup in extends {
            let Some(s) = sup.as_str() else { continue };
            if s == "Boolean" {
                return true;
            }
            if !BUILTIN_CONCEPTS.contains(&s) {
                next = Some(s.to_string());
            }
        }
        match next {
            Some(n) => cur = n,
            None => return false,
        }
    }
    false
}

fn identify_by(snapshot: &Snapshot, concept: &str) -> Vec<String> {
    snapshot
        .get(&artifact_key(KIND_CONCEPT, concept))
        .and_then(|b| b.get("identify_by"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

// Relationships declared directly under `concept`, as (rel_name, body).
fn owned_relationships<'a>(snapshot: &'a Snapshot, concept: &str) -> Vec<(String, &'a Value)> {
    snapshot
        .iter()
        .filter_map(|(key, body)| {
            let (kind, name) = split_artifact_key(key)?;
            if kind != KIND_ONTOLOGY_REL {
                return None;
            }
            let (owner, rel) = name.split_once('.')?;
            (owner == concept).then(|| (rel.to_string(), body))
        })
        .collect()
}

// The four conditions a concept must satisfy to be demoted back to an n-ary
// virtual entity (design-ouline.md §4.3). The returned list is the *blockers*;
// an empty vector means the concept is a pure join entity eligible for demotion.
pub fn demote_blockers(snapshot: &Snapshot, concept: &str) -> Vec<String> {
    let mut blockers = Vec::new();
    let identifying = identify_by(snapshot, concept);

    // Condition 1: identify_by must be a surrogate key (binary to a value type).
    if identifying.is_empty() {
        blockers.push("缺少 identify_by（无代理键身份）".to_string());
    } else {
        for id in &identifying {
            match snapshot.get(&artifact_key(KIND_ONTOLOGY_REL, &format!("{concept}.{id}"))) {
                Some(body) => {
                    let surrogate = additional_roles(body)
                        .last()
                        .map(|r| is_value_type(snapshot, &r.concept))
                        .unwrap_or(false);
                    if arity(body) != Arity::Binary || !surrogate {
                        blockers.push(format!(
                            "identify_by 关系 `{concept}.{id}` 不是代理键（需二元且末端为值类型）"
                        ));
                    }
                }
                None => blockers.push(format!("identify_by 关系 `{concept}.{id}` 不存在")),
            }
        }
    }

    for (rel, body) in owned_relationships(snapshot, concept) {
        // Identifying relationships are covered by condition 1.
        if identifying.iter().any(|i| i == &rel) {
            continue;
        }
        // Condition 2: only outward binary ManyToOne relationships.
        if arity(body) != Arity::Binary {
            blockers.push(format!("关系 `{concept}.{rel}` 不是二元关系"));
        } else if multiplicity(body) != Some("ManyToOne") {
            blockers.push(format!(
                "关系 `{concept}.{rel}` 不是 ManyToOne（存在 OneToOne 或未标注）"
            ));
        }
        // Condition 3: no attributes (roles pointing at value types).
        if let Some(last) = additional_roles(body).last() {
            if is_value_type(snapshot, &last.concept) {
                blockers.push(format!("存在指向值类型的属性关系 `{concept}.{rel}`"));
            }
        }
    }

    // Condition 4: not referenced from any other relationship.
    for (key, body) in snapshot {
        let Some((kind, name)) = split_artifact_key(key) else {
            continue;
        };
        if kind != KIND_ONTOLOGY_REL {
            continue;
        }
        let Some((owner, _rel)) = name.split_once('.') else {
            continue;
        };
        if owner == concept {
            continue;
        }
        if additional_roles(body).iter().any(|r| r.concept == concept) {
            blockers.push(format!("被关系 `{name}` 引用"));
        }
    }

    blockers.sort();
    blockers.dedup();
    blockers
}

// Number of outward binary ManyToOne relationships owned by a concept.
fn outward_many_to_one(snapshot: &Snapshot, concept: &str) -> usize {
    let identifying = identify_by(snapshot, concept);
    owned_relationships(snapshot, concept)
        .into_iter()
        .filter(|(rel, body)| {
            !identifying.contains(rel)
                && arity(body) == Arity::Binary
                && multiplicity(body) == Some("ManyToOne")
        })
        .count()
}

// Advisory hints for the equivalence/normalization checks (§4.5) plus the
// demotion opportunity surfaced by §4.3. All are warnings: they never block a
// commit, they just nudge the modeler.
pub fn normalization_hints(snapshot: &Snapshot, issues: &mut Vec<Issue>) {
    for (key, body) in snapshot {
        let Some((kind, name)) = split_artifact_key(key) else {
            continue;
        };

        if kind == KIND_ONTOLOGY_REL && arity(body) == Arity::Binary {
            if let Some(last) = additional_roles(body).last() {
                if is_boolean_like(snapshot, &last.concept) {
                    issues.push(Issue::warning(
                        format!("ontology.relationships.{name}"),
                        "末端角色为 Boolean；可考虑重构为一元关系（等价归一化）",
                    ));
                }
            }
        }

        if kind == KIND_CONCEPT {
            let is_entity = body.get("type").and_then(|v| v.as_str()) == Some("EntityType");
            // A join entity has at least two outward ManyToOne relationships and
            // satisfies every demotion condition.
            if is_entity && outward_many_to_one(snapshot, name) >= 2 {
                if demote_blockers(snapshot, name).is_empty() {
                    issues.push(Issue::warning(
                        format!("ontology.concepts.{name}"),
                        "纯连接实体满足降格条件，可折叠为 n 元关系（等价归一化）",
                    ));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn concept(name: &str, ty: &str) -> Value {
        json!({ "name": name, "type": ty })
    }

    fn rel(name: &str, roles: Value, multiplicity: Option<&str>) -> Value {
        let mut body = json!({ "name": name, "roles": roles, "verbalizes": ["x"] });
        if let Some(m) = multiplicity {
            body["multiplicity"] = json!(m);
        }
        body
    }

    #[test]
    fn arity_classification() {
        assert_eq!(arity(&rel("r", json!([]), None)), Arity::Unary);
        assert_eq!(
            arity(&rel("r", json!([{ "concept": "B" }]), None)),
            Arity::Binary
        );
        assert_eq!(
            arity(&rel("r", json!([{ "concept": "B" }, { "concept": "C" }]), None)),
            Arity::Nary
        );
    }

    #[test]
    fn multiplicity_applicability() {
        assert!(!multiplicity_allowed(Arity::Unary));
        assert!(multiplicity_allowed(Arity::Binary));
        assert!(multiplicity_allowed(Arity::Nary));
        assert!(one_to_one_allowed(Arity::Binary));
        assert!(!one_to_one_allowed(Arity::Unary));
        assert!(!one_to_one_allowed(Arity::Nary));
    }

    #[test]
    fn boolean_like_follows_extends_chain() {
        let mut snap = Snapshot::new();
        snap.insert(
            artifact_key(KIND_CONCEPT, "Flag"),
            json!({ "name": "Flag", "type": "ValueType", "extends": ["Boolean"] }),
        );
        assert!(is_boolean_like(&snap, "Boolean"));
        assert!(is_boolean_like(&snap, "Flag"));
        assert!(!is_boolean_like(&snap, "String"));
    }

    #[test]
    fn pure_join_entity_is_demotable() {
        let mut snap = Snapshot::new();
        snap.insert(artifact_key(KIND_CONCEPT, "Sale"), concept("Sale", "EntityType"));
        snap.insert(artifact_key(KIND_CONCEPT, "Person"), concept("Person", "EntityType"));
        snap.insert(artifact_key(KIND_CONCEPT, "Product"), concept("Product", "EntityType"));
        snap.insert(
            artifact_key(KIND_ONTOLOGY_REL, "Sale.id"),
            rel("id", json!([{ "concept": "Integer" }]), Some("OneToOne")),
        );
        snap.insert(
            artifact_key(KIND_ONTOLOGY_REL, "Sale.buyer"),
            rel("buyer", json!([{ "concept": "Person" }]), Some("ManyToOne")),
        );
        snap.insert(
            artifact_key(KIND_ONTOLOGY_REL, "Sale.item"),
            rel("item", json!([{ "concept": "Product" }]), Some("ManyToOne")),
        );
        snap.get_mut("concept:Sale")
            .expect("Sale concept")
            .as_object_mut()
            .expect("Sale body is an object")
            .insert("identify_by".to_string(), json!(["id"]));
        assert!(demote_blockers(&snap, "Sale").is_empty());

        // Referenced from another relationship -> no longer demotable.
        snap.insert(
            artifact_key(KIND_ONTOLOGY_REL, "Person.bought"),
            rel("bought", json!([{ "concept": "Sale" }]), Some("ManyToOne")),
        );
        assert!(!demote_blockers(&snap, "Sale").is_empty());
    }

    #[test]
    fn boolean_tipped_binary_relationship_is_hinted() {
        let mut snap = Snapshot::new();
        snap.insert(
            artifact_key(KIND_CONCEPT, "Person"),
            concept("Person", "EntityType"),
        );
        snap.insert(
            artifact_key(KIND_ONTOLOGY_REL, "Person.files_joint"),
            rel("files_joint", json!([{ "concept": "Boolean" }]), None),
        );
        let mut issues = Vec::new();
        normalization_hints(&snap, &mut issues);
        assert!(issues
            .iter()
            .any(|i| i.message.contains("Boolean") && i.level == "warning"));
    }
}
