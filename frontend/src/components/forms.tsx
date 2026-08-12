import { useState } from "react";

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
  busy,
  canSave = true
}: {
  onSave: () => void;
  onDelete?: () => void;
  busy?: boolean;
  canSave?: boolean;
}) {
  return (
    <div className="row">
      <button className="primary" onClick={onSave} disabled={!canSave || busy}>
        保存
      </button>
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
  busy
}: {
  body: any;
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
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
      <SaveBar
        onSave={save}
        onDelete={onDelete}
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
  onSave,
  onDelete,
  busy
}: {
  body: any;
  concepts: string[];
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const [owner, setOwner] = useState(body._owner || concepts[0] || "");
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

  const save = () =>
    onSave(
      `${owner.trim()}.${name.trim()}`,
      Object.fromEntries(
        Object.entries({
          name: name.trim(),
          description: description.trim() || undefined,
          multiplicity: multiplicity || undefined,
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
      <div className="row">
        <SelectRow
          label="起始概念（owner，第一角色）"
          value={owner}
          onChange={setOwner}
          options={concepts}
        />
        <TextRow label="关系名" value={name} onChange={setName} />
      </div>
      <SelectRow
        label="多重性"
        value={multiplicity}
        onChange={setMultiplicity}
        options={["ManyToOne", "OneToOne"]}
        placeholder="（可选）"
      />
      <div>
        <div className="muted" style={{ marginBottom: 6 }}>
          其他角色（第一个角色即 owner）
        </div>
        {roles.map((r, i) => (
          <div key={i} className="row" style={{ marginBottom: 6 }}>
            <select
              value={r.concept}
              onChange={(e) =>
                setRoles(roles.map((x, j) => (j === i ? { ...x, concept: e.target.value } : x)))
              }
            >
              <option value="">选择概念</option>
              {concepts.map((c) => (
                <option key={c} value={c}>
                  {c}
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
        placeholder={'例如 {Person} earns {Salary}'}
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
      <SaveBar
        onSave={save}
        onDelete={onDelete}
        busy={busy}
        canSave={!!name.trim() && !!owner.trim() && !!verbalizes.trim()}
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
  busy
}: {
  body: any;
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
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
  busy
}: {
  body: any;
  datasets: string[];
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
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
  busy
}: {
  body: any;
  onSave: (key: string, body: any) => void;
  onDelete?: () => void;
  busy?: boolean;
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
        busy={busy}
        canSave={!!name.trim() && dialects.some((d) => d.expression.trim())}
      />
    </div>
  );
}
