import { useState, type ReactNode } from "react";

function splitLines(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinLines(a?: string[]): string {
  return (a || []).join("\n");
}

function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinCsv(a?: string[]): string {
  return (a || []).join(", ");
}

export function TextRow({
  label,
  value,
  onChange,
  placeholder,
  mono
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        className={mono ? "mono" : ""}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function AreaRow({
  label,
  value,
  onChange,
  placeholder,
  rows = 3
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label>
      {label}
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function SelectRow({
  label,
  value,
  onChange,
  options,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function SaveBar({
  onSave,
  onDelete,
  onCancel,
  busy,
  canSave = true
}: {
  onSave: () => void;
  onDelete?: () => void;
  onCancel?: () => void;
  busy?: boolean;
  canSave?: boolean;
}) {
  return (
    <div className="row">
      <button className="primary" onClick={onSave} disabled={!canSave || busy}>
        保存
      </button>
      {onCancel && (
        <button onClick={onCancel} disabled={busy}>
          取消
        </button>
      )}
      {onDelete && (
        <button className="danger" onClick={onDelete} disabled={busy}>
          删除
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ontology: concept
// ---------------------------------------------------------------------------

export function ConceptForm({
  body,
  onSave,
  onDelete,
  busy,
  onCancel,
  extraSection
}: {
  body: any;
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
  onCancel?: () => void;
  /** Rendered between the fields and the action bar, so a concept's own
   *  relationships sit *above* the save button rather than below it. */
  extraSection?: ReactNode;
}) {
  const [name, setName] = useState(body.name || "");
  const [type, setType] = useState(body.type || "EntityType");
  const [extendsList, setExtendsList] = useState(joinCsv(body.extends));
  const [identifyBy, setIdentifyBy] = useState(joinCsv(body.identify_by));
  const [description, setDescription] = useState(body.description || "");
  const [requires, setRequires] = useState(joinLines(body.requires));
  const [derivedBy, setDerivedBy] = useState(joinLines(body.derived_by));

  const save = () =>
    onSave(
      name.trim(),
      Object.fromEntries(
        Object.entries({
          name: name.trim(),
          type,
          extends: splitCsv(extendsList),
          identify_by: splitCsv(identifyBy),
          description: description.trim() || undefined,
          requires: splitLines(requires),
          derived_by: splitLines(derivedBy)
        }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
      )
    );

  return (
    <div className="form">
      <TextRow label="名称（唯一标识）" value={name} onChange={setName} />
      <SelectRow
        label="类型"
        value={type}
        onChange={setType}
        options={["EntityType", "ValueType"]}
      />
      <TextRow
        label="继承（extends，逗号分隔）"
        value={extendsList}
        onChange={setExtendsList}
        placeholder="例如 Integer, String, Person"
      />
      <TextRow
        label="标识关系（identify_by，逗号分隔）"
        value={identifyBy}
        onChange={setIdentifyBy}
        placeholder="例如 nr, order"
      />
      <TextRow label="描述" value={description} onChange={setDescription} />
      <AreaRow
        label="约束（requires，每行一条表达式）"
        value={requires}
        onChange={setRequires}
        placeholder={'例如 0 < SocialSecurityNr'}
      />
      <AreaRow
        label="派生（derived_by，每行一条表达式）"
        value={derivedBy}
        onChange={setDerivedBy}
        placeholder={'例如 EXISTS ( Person.earns )'}
      />
      {extraSection && <div className="form-section">{extraSection}</div>}
      <SaveBar
        onSave={save}
        onDelete={onDelete}
        onCancel={onCancel}
        busy={busy}
        canSave={!!name.trim() && !!type}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ontology: relationship
// ---------------------------------------------------------------------------

export function OntologyRelForm({
  body,
  concepts,
  conceptTypes,
  lockOwner,
  onSave,
  onDelete,
  busy,
  onCancel
}: {
  body: any;
  concepts: string[];
  /** concept name -> ConceptType, used to label the pickers. */
  conceptTypes?: Record<string, string>;
  /** When the caller owns the declaring concept (e.g. a concept being created),
   *  the owner picker is replaced by a read-only note. */
  lockOwner?: boolean;
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
  onCancel?: () => void;
}) {
  // When the caller owns the declaring concept (a concept being created), the
  // owner must stay empty rather than falling back to the first concept.
  const [owner, setOwner] = useState(
    lockOwner ? body._owner || "" : body._owner || concepts[0] || ""
  );
  const [name, setName] = useState(body.name || "");
  const [multiplicity, setMultiplicity] = useState(body.multiplicity || "");
  const [roles, setRoles] = useState<any[]>(
    (body.roles || []).map((r: any) => ({
      concept: r.concept || "",
      name: r.name || ""
    }))
  );
  const [verbalizes, setVerbalizes] = useState(joinLines(body.verbalizes));
  const [requires, setRequires] = useState(joinLines(body.requires));
  const [derivedBy, setDerivedBy] = useState(joinLines(body.derived_by));
  const [description, setDescription] = useState(body.description || "");

  // §4.2: multiplicity only applies when a relationship has more than one role.
  // OneToOne is defined for binary relationships only; many-to-many stays empty.
  const filledRoles = roles.filter((r) => r.concept);
  const arity = 1 + filledRoles.length;
  const multOptions =
    arity <= 1 ? [] : arity === 2 ? ["ManyToOne", "OneToOne"] : ["ManyToOne"];
  const effectiveMultiplicity = arity <= 1 ? "" : multiplicity;

  const typeLabel = (c: string) =>
    conceptTypes?.[c] === "EntityType"
      ? "实体"
      : conceptTypes?.[c] === "ValueType"
        ? "值类型"
        : "";

  const conceptLabel = (c: string) => {
    const t = typeLabel(c);
    return t ? `${c}（${t}）` : c;
  };

  // Role names as expressions will see them: the explicit name, else the
  // playing concept. Used to preview verbalizes and to spot collisions.
  const roleRefs = [owner, ...filledRoles.map((r) => r.name || r.concept)];

  const problems: string[] = [];
  if (!lockOwner && !owner.trim()) problems.push("需要选择声明概念（第一角色）");
  if (!name.trim()) problems.push("需要填写关系名");
  if (roles.some((r) => !r.concept && String(r.name).trim()))
    problems.push("有角色只填了角色名但没有选择概念");
  for (const c of [owner, ...filledRoles.map((r) => r.concept)]) {
    if (c && concepts.length > 0 && !concepts.includes(c))
      problems.push(`概念 \`${c}\` 不存在（可能已被删除），请重新选择`);
  }
  const seen: Record<string, number> = {};
  for (const c of [owner, ...filledRoles.map((r) => r.concept)])
    seen[c] = (seen[c] || 0) + 1;
  for (const [c, n] of Object.entries(seen)) {
    if (n > 1 && c) {
      const named = filledRoles.filter((r) => r.concept === c && r.name).length;
      const ownerCounts = owner === c ? 1 : 0;
      if (named + ownerCounts < n)
        problems.push(`概念 \`${c}\` 扮演多个角色，每个同名角色都需要填写角色名以区分`);
    }
  }
  const refCounts: Record<string, number> = {};
  for (const r of roleRefs.filter(Boolean)) refCounts[r] = (refCounts[r] || 0) + 1;
  for (const [r, n] of Object.entries(refCounts))
    if (n > 1) problems.push(`角色名 \`${r}\` 重复，表达式将无法区分`);
  if (!verbalizes.trim())
    problems.push("至少需要一条自然语言表达（verbalizes）");

  // §4.2: the declaring (owner) side defines the multiplicity direction, so
  // switching it must warn — the constraint flips with the edge.
  const changeOwner = (next: string) => {
    const original = body._owner;
    if (original && next !== original) {
      const ok = confirm(
        `换边会反转约束方向：roles 顺序即语义，声明侧（${original}）定义了 multiplicity 的方向。确定改为 ${next}？`
      );
      if (!ok) return;
    }
    setOwner(next);
  };

  const save = () =>
    onSave(
      `${owner.trim()}.${name.trim()}`,
      Object.fromEntries(
        Object.entries({
          name: name.trim(),
          description: description.trim() || undefined,
          multiplicity: effectiveMultiplicity || undefined,
          roles: roles
            .filter((r) => r.concept)
            .map((r) =>
              r.name ? { concept: r.concept, name: r.name } : { concept: r.concept }
            ),
          verbalizes: splitLines(verbalizes),
          requires: splitLines(requires),
          derived_by: splitLines(derivedBy)
        }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
      )
    );

  return (
    <div className="form">
      {lockOwner ? (
        <div className="muted">
          声明概念（第一角色）：
          <span className="mono">
            {owner || "（随概念一起创建）"}
          </span>
        </div>
      ) : (
        <div className="row">
          <SelectRow
            label="声明概念（第一角色 —— 关系归属于它）"
            value={owner}
            onChange={changeOwner}
            options={concepts}
            placeholder="选择概念"
          />
          <TextRow label="关系名" value={name} onChange={setName} />
        </div>
      )}
      {lockOwner && (
        <TextRow label="关系名" value={name} onChange={setName} />
      )}
      <div className="muted">
        关系标识：
        <span className="mono">
          {owner && name.trim() ? ` ${owner}.${name.trim()}` : "（填写后生成）"}
        </span>
      </div>
      <SelectRow
        label={
          arity <= 1
            ? "多重性（一元关系不适用，已禁用）"
            : arity === 2
              ? "多重性（多对多请留空）"
              : "多重性（n 元：约束最后一个角色）"
        }
        value={multiplicity}
        onChange={setMultiplicity}
        options={multOptions}
        placeholder={arity <= 1 ? "—" : "（可选：多对多/未约束）"}
      />
      <div>
        <div className="muted" style={{ marginBottom: 6 }}>
          其他角色 —— 顺序即语义（第 2、3… 个角色按此顺序参与约束）
        </div>
        {roles.map((r, i) => (
          <div key={i} className="role-row">
            <span className="badge" title="角色位置">
              #{i + 2}
            </span>
            <select
              value={r.concept}
              onChange={(e) =>
                setRoles(roles.map((x, j) => (j === i ? { ...x, concept: e.target.value } : x)))
              }
            >
              <option value="">选择概念</option>
              {concepts.map((c) => (
                <option key={c} value={c}>
                  {conceptLabel(c)}
                </option>
              ))}
            </select>
            <input
              placeholder="角色名（可选）"
              value={r.name}
              onChange={(e) =>
                setRoles(roles.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
            />
            <button
              title="上移（顺序即语义）"
              disabled={i === 0}
              onClick={() => {
                const next = [...roles];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                setRoles(next);
              }}
            >
              ↑
            </button>
            <button
              title="下移（顺序即语义）"
              disabled={i === roles.length - 1}
              onClick={() => {
                const next = [...roles];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                setRoles(next);
              }}
            >
              ↓
            </button>
            <button
              onClick={() => setRoles(roles.filter((_, j) => j !== i))}
              className="danger"
            >
              ×
            </button>
          </div>
        ))}
        <button onClick={() => setRoles([...roles, { concept: "", name: "" }])}>
          + 添加角色
        </button>
      </div>
      <AreaRow
        label="自然语言表达（verbalizes，每行一条）"
        value={verbalizes}
        onChange={setVerbalizes}
        placeholder={
          roleRefs.filter(Boolean).length
            ? `例如 {${roleRefs.filter(Boolean).join("} … {")}}`
            : "例如 {Person} earns {Salary}"
        }
      />
      <TextRow label="描述" value={description} onChange={setDescription} />
      <AreaRow
        label="约束（requires，每行一条）"
        value={requires}
        onChange={setRequires}
      />
      <AreaRow
        label="派生（derived_by，每行一条）"
        value={derivedBy}
        onChange={setDerivedBy}
      />
      {problems.length > 0 && (
        <ul className="issues">
          {problems.map((p, i) => (
            <li key={i} className="warning">
              {p}
            </li>
          ))}
        </ul>
      )}
      <SaveBar
        onSave={save}
        onDelete={onDelete}
        onCancel={onCancel}
        busy={busy}
        canSave={
          problems.length === 0 && !!name.trim() && !!verbalizes.trim()
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semantic: dataset
// ---------------------------------------------------------------------------

export function DatasetForm({
  body,
  onSave,
  onDelete,
  busy,
  onCancel
}: {
  body: any;
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(body.name || "");
  const [source, setSource] = useState(body.source || "");
  const [description, setDescription] = useState(body.description || "");
  const [primaryKey, setPrimaryKey] = useState(joinCsv(body.primary_key));
  const [uniqueKeys, setUniqueKeys] = useState(
    (body.unique_keys || []).map((k: string[]) => joinCsv(k)).join("\n")
  );
  const [fields, setFields] = useState<any[]>(
    (body.fields || []).map((f: any) => ({
      name: f.name || "",
      datatype: f.datatype || "",
      is_time: f.dimension?.is_time ?? "",
      expression:
        f.expression?.dialects?.[0]?.expression || f.expression?.dialects?.[0]?.expression || ""
    }))
  );

  const save = () =>
    onSave(
      name.trim(),
      Object.fromEntries(
        Object.entries({
          name: name.trim(),
          source: source.trim() || undefined,
          description: description.trim() || undefined,
          primary_key: splitCsv(primaryKey),
          unique_keys: uniqueKeys
            .split("\n")
            .map((l: string) => splitCsv(l))
            .filter((k: string[]) => k.length > 0),
          fields: fields
            .filter((f) => f.name)
            .map((f) => ({
              name: f.name.trim(),
              description: undefined,
              datatype: f.datatype || undefined,
              dimension:
                f.is_time === "" ? undefined : { is_time: f.is_time === "true" },
              expression: f.expression
                ? {
                    dialects: [
                      { dialect: "ANSI_SQL", expression: f.expression.trim() }
                    ]
                  }
                : undefined
            }))
        }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
      )
    );

  const setField = (i: number, patch: any) =>
    setFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="form">
      <div className="row">
        <TextRow label="数据集名" value={name} onChange={setName} />
        <TextRow
          label="物理来源（source）"
          value={source}
          onChange={setSource}
          placeholder="database.schema.table"
          mono
        />
      </div>
      <TextRow label="描述" value={description} onChange={setDescription} />
      <TextRow
        label="主键（逗号分隔，支持复合）"
        value={primaryKey}
        onChange={setPrimaryKey}
      />
      <AreaRow
        label="唯一键（每行一个键，列逗号分隔）"
        value={uniqueKeys}
        onChange={setUniqueKeys}
        rows={2}
      />
      <div>
        <div className="muted" style={{ marginBottom: 6 }}>
          字段（fields）
        </div>
        {fields.map((f, i) => (
          <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 8, marginBottom: 8 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <input
                placeholder="字段名"
                value={f.name}
                onChange={(e) => setField(i, { name: e.target.value })}
              />
              <select
                value={f.datatype}
                onChange={(e) => setField(i, { datatype: e.target.value })}
              >
                <option value="">datatype</option>
                {["String", "Integer", "Decimal", "Float", "Boolean", "Date", "Time", "DateTime", "DateTimeTz", "Opaque"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={f.is_time}
                onChange={(e) => setField(i, { is_time: e.target.value })}
              >
                <option value="">时间维度?</option>
                <option value="true">是</option>
                <option value="false">否</option>
              </select>
            </div>
            <div className="row">
              <input
                placeholder="ANSI_SQL 表达式（列名或计算）"
                value={f.expression}
                onChange={(e) => setField(i, { expression: e.target.value })}
                className="mono"
              />
              <button
                onClick={() => setFields(fields.filter((_, j) => j !== i))}
                className="danger"
              >
                ×
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() =>
            setFields([...fields, { name: "", datatype: "", is_time: "", expression: "" }])
          }
        >
          + 添加字段
        </button>
      </div>
      <SaveBar
        onSave={save}
        onDelete={onDelete}
        onCancel={onCancel}
        busy={busy}
        canSave={!!name.trim()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semantic: relationship
// ---------------------------------------------------------------------------

export function SemanticRelForm({
  body,
  datasets,
  onSave,
  onDelete,
  busy,
  onCancel
}: {
  body: any;
  datasets: string[];
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(body.name || "");
  const [from, setFrom] = useState(body.from || datasets[0] || "");
  const [to, setTo] = useState(body.to || datasets[1] || "");
  const [fromColumns, setFromColumns] = useState(joinCsv(body.from_columns));
  const [toColumns, setToColumns] = useState(joinCsv(body.to_columns));
  const [description, setDescription] = useState(body.description || "");

  const save = () =>
    onSave(
      name.trim(),
      Object.fromEntries(
        Object.entries({
          name: name.trim(),
          description: description.trim() || undefined,
          from: from.trim(),
          to: to.trim(),
          from_columns: splitCsv(fromColumns),
          to_columns: splitCsv(toColumns)
        }).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
      )
    );

  return (
    <div className="form">
      <TextRow label="关系名" value={name} onChange={setName} />
      <div className="row">
        <SelectRow
          label="from（多端数据集）"
          value={from}
          onChange={setFrom}
          options={datasets}
        />
        <SelectRow
          label="to（一端数据集）"
          value={to}
          onChange={setTo}
          options={datasets}
        />
      </div>
      <div className="row">
        <TextRow
          label="from_columns"
          value={fromColumns}
          onChange={setFromColumns}
          mono
        />
        <TextRow
          label="to_columns"
          value={toColumns}
          onChange={setToColumns}
          mono
        />
      </div>
      <TextRow label="描述" value={description} onChange={setDescription} />
      <SaveBar
        onSave={save}
        onDelete={onDelete}
        onCancel={onCancel}
        busy={busy}
        canSave={!!name.trim() && !!from && !!to && !!fromColumns.trim() && !!toColumns.trim()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semantic: metric
// ---------------------------------------------------------------------------

export function MetricForm({
  body,
  onSave,
  onDelete,
  busy,
  onCancel
}: {
  body: any;
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(body.name || "");
  const [datatype, setDatatype] = useState(body.datatype || "");
  const [dialects, setDialects] = useState<any[]>(
    body.expression?.dialects?.length
      ? body.expression.dialects.map((d: any) => ({ ...d }))
      : [{ dialect: "ANSI_SQL", expression: "" }]
  );
  const [description, setDescription] = useState(body.description || "");

  const save = () =>
    onSave(
      name.trim(),
      Object.fromEntries(
        Object.entries({
          name: name.trim(),
          description: description.trim() || undefined,
          datatype: datatype || undefined,
          expression: {
            dialects: dialects.filter((d) => d.expression.trim())
          }
        }).filter(([, v]) => v !== undefined)
      )
    );

  return (
    <div className="form">
      <div className="row">
        <TextRow label="度量名" value={name} onChange={setName} />
        <SelectRow
          label="数据类型"
          value={datatype}
          onChange={setDatatype}
          options={["String", "Integer", "Decimal", "Float", "Boolean", "Date", "Time", "DateTime", "DateTimeTz", "Opaque"]}
          placeholder="（可选）"
        />
      </div>
      <div>
        <div className="muted" style={{ marginBottom: 6 }}>
          表达式（支持多方言）
        </div>
        {dialects.map((d, i) => (
          <div key={i} className="row" style={{ marginBottom: 6 }}>
            <select
              value={d.dialect}
              onChange={(e) =>
                setDialects(
                  dialects.map((x, j) =>
                    j === i ? { ...x, dialect: e.target.value } : x
                  )
                )
              }
            >
              {["ANSI_SQL", "SNOWFLAKE", "MDX", "TABLEAU", "DATABRICKS", "MAQL", "BIGQUERY"].map((dl) => (
                <option key={dl} value={dl}>
                  {dl}
                </option>
              ))}
            </select>
            <input
              placeholder="例如 SUM(orders.amount)"
              value={d.expression}
              onChange={(e) =>
                setDialects(
                  dialects.map((x, j) =>
                    j === i ? { ...x, expression: e.target.value } : x
                  )
                )
              }
              className="mono"
            />
            <button
              onClick={() => setDialects(dialects.filter((_, j) => j !== i))}
              className="danger"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            setDialects([...dialects, { dialect: "ANSI_SQL", expression: "" }])
          }
        >
          + 添加方言
        </button>
      </div>
      <TextRow label="描述" value={description} onChange={setDescription} />
      <SaveBar
        onSave={save}
        onDelete={onDelete}
        onCancel={onCancel}
        busy={busy}
        canSave={!!name.trim() && dialects.some((d) => d.expression.trim())}
      />
    </div>
  );
}
