import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { DataTable, PageHeader, type Column } from "../components/ui";
import type { DataSource, DataSourceInput } from "../types";

const EMPTY: DataSourceInput = {
  name: "",
  kind: "postgres",
  host: "localhost",
  port: 5432,
  database: "",
  username: "",
  password: "",
  sslmode: "prefer",
  defaultSchema: "public",
  description: ""
};

function toInput(source: DataSource): DataSourceInput {
  return {
    name: source.name,
    kind: source.kind,
    host: source.host,
    port: source.port,
    database: source.database,
    username: source.username,
    password: "",
    sslmode: source.sslmode,
    defaultSchema: source.defaultSchema,
    description: source.description || ""
  };
}

export function DataSourcesPage({ tenant }: { tenant: string }) {
  const [rows, setRows] = useState<DataSource[]>([]);
  const [editing, setEditing] = useState<DataSource | "new" | null>(null);
  const [form, setForm] = useState<DataSourceInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setRows(await api.listDataSources(tenant));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  const openNew = () => {
    setForm(EMPTY);
    setError(null);
    setNotice(null);
    setEditing("new");
  };

  const openEdit = (source: DataSource) => {
    setForm(toInput(source));
    setError(null);
    setNotice(null);
    setEditing(source);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing === "new") {
        await api.createDataSource(tenant, form);
      } else if (editing) {
        await api.updateDataSource(editing.id, form);
      }
      setEditing(null);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (source: DataSource) => {
    if (!confirm(`删除数据源 ${source.name}？`)) return;
    setBusy(true);
    try {
      await api.deleteDataSource(source.id);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const test = async (source: DataSource) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const out = await api.testDataSource(source.id);
      if (out.ok) {
        setNotice(`${source.name}：${out.message}`);
      } else {
        setError(`${source.name}：${out.message}`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<DataSource>[] = [
    {
      key: "name",
      header: "名称",
      render: (s) => <span className="cell-primary">{s.name}</span>
    },
    {
      key: "kind",
      header: "类型",
      width: "110px",
      render: (s) => <span className="badge accent">{s.kind}</span>
    },
    {
      key: "address",
      header: "坐标（host:port/database）",
      render: (s) => (
        <span className="mono">
          {s.host}:{s.port}/{s.database}
        </span>
      )
    },
    {
      key: "defaultSchema",
      header: "默认 schema",
      width: "130px",
      render: (s) => <span className="mono">{s.defaultSchema}</span>
    },
    {
      key: "username",
      header: "用户",
      width: "130px",
      render: (s) => <span className="mono">{s.username}</span>
    },
    {
      key: "description",
      header: "描述",
      render: (s) => <span className="sub">{s.description || "—"}</span>
    },
    {
      key: "actions",
      header: "",
      width: "210px",
      align: "right",
      render: (s) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          <button className="sm" disabled={busy} onClick={() => test(s)}>
            测试连接
          </button>{" "}
          <button className="sm" onClick={() => openEdit(s)}>
            编辑
          </button>{" "}
          <button
            className="sm danger"
            disabled={busy}
            onClick={() => remove(s)}
          >
            删除
          </button>
        </span>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="数据源"
        subtitle="数据源属于平台资产（租户级），不进 OSSIE 文档；当前仅支持 PostgreSQL。"
        actions={
          <button className="primary" onClick={openNew}>
            + 新建数据源
          </button>
        }
      />

      {notice && <div className="ok-text" style={{ marginBottom: 10 }}>{notice}</div>}
      {error && !editing && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="panel">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          onRowClick={openEdit}
          empty="还没有数据源；注册一个 PostgreSQL 连接即可用于语义层部署"
        />
      </div>

      {editing && (
        <Modal
          title={editing === "new" ? "新建数据源（PostgreSQL）" : `编辑数据源 · ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <div className="form">
            <label>
              名称
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="warehouse"
              />
            </label>
            <div className="row">
              <label>
                主机
                <input
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
              </label>
              <label style={{ maxWidth: 110 }}>
                端口
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) =>
                    setForm({ ...form, port: Number(e.target.value) || 0 })
                  }
                />
              </label>
            </div>
            <label>
              数据库
              <input
                value={form.database}
                onChange={(e) => setForm({ ...form, database: e.target.value })}
              />
            </label>
            <div className="row">
              <label>
                用户名
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </label>
              <label>
                密码
                <input
                  type="password"
                  value={form.password || ""}
                  placeholder={editing === "new" ? "" : "留空表示不修改"}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </label>
            </div>
            <div className="row">
              <label>
                默认 schema
                <input
                  value={form.defaultSchema}
                  onChange={(e) =>
                    setForm({ ...form, defaultSchema: e.target.value })
                  }
                />
              </label>
              <label>
                sslmode
                <select
                  value={form.sslmode}
                  onChange={(e) => setForm({ ...form, sslmode: e.target.value })}
                >
                  {["disable", "prefer", "require"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              描述
              <input
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button onClick={() => setEditing(null)} disabled={busy}>
                取消
              </button>
              <button
                className="primary"
                onClick={submit}
                disabled={busy || !form.name.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
