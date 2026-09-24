import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { DataTable, PageHeader, StatCard, type Column } from "../components/ui";
import type { Tenant } from "../types";

export function SettingsPage({
  tenant,
  tenants,
  refreshTenants,
  onSwitchTenant
}: {
  tenant: string;
  tenants: Tenant[];
  refreshTenants: () => Promise<void>;
  onSwitchTenant: (id: string) => void;
}) {
  const [defaultAuthor, setDefaultAuthor] = useState("");
  const [defaultSchema, setDefaultSchema] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<{ spec: string; storage: string } | null>(
    null
  );

  const [newTenantOpen, setNewTenantOpen] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantDesc, setNewTenantDesc] = useState("");
  const [tenantError, setTenantError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings(tenant)
      .then((s) => {
        setDefaultAuthor(s.values.defaultAuthor || "");
        setDefaultSchema(s.values.defaultSchema || "public");
      })
      .catch((e: any) => setError(e.message));
    api
      .health()
      .then((h) => setInfo({ spec: h.spec, storage: h.storage }))
      .catch(() => undefined);
  }, [tenant]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.putSettings(tenant, {
        defaultAuthor: defaultAuthor.trim(),
        defaultSchema: defaultSchema.trim() || "public"
      });
      setNotice("已保存");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const createTenant = async () => {
    setBusy(true);
    setTenantError(null);
    try {
      await api.createTenant(newTenantName.trim(), newTenantDesc.trim() || undefined);
      setNewTenantName("");
      setNewTenantDesc("");
      setNewTenantOpen(false);
      await refreshTenants();
    } catch (e: any) {
      setTenantError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeTenant = async (t: Tenant) => {
    if (!confirm(`删除租户 ${t.name}？需先删除该租户下的所有项目。`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTenant(t.id);
      if (t.id === tenant) onSwitchTenant("default");
      await refreshTenants();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tenantColumns: Column<Tenant>[] = [
    {
      key: "name",
      header: "租户",
      render: (t) => (
        <span className="cell-primary">
          {t.name}
          {t.id === tenant && <span className="badge accent">当前</span>}
        </span>
      )
    },
    { key: "id", header: "ID", render: (t) => <span className="mono sub">{t.id}</span> },
    {
      key: "description",
      header: "描述",
      render: (t) => <span className="sub">{t.description || "—"}</span>
    },
    {
      key: "createdAt",
      header: "创建时间",
      width: "180px",
      render: (t) => new Date(t.createdAt).toLocaleString()
    },
    {
      key: "actions",
      header: "",
      width: "170px",
      align: "right",
      render: (t) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          {t.id !== tenant && (
            <>
              <button className="sm" onClick={() => onSwitchTenant(t.id)}>
                切换
              </button>{" "}
            </>
          )}
          <button
            className="sm danger"
            disabled={busy || t.id === "default"}
            onClick={() => removeTenant(t)}
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
        title="设置"
        subtitle="平台级配置与租户管理。设置按租户隔离存储。"
      />

      <div className="split" style={{ marginBottom: 16 }}>
        <StatCard label="当前租户" value={tenant} hint={
          tenants.find((t) => t.id === tenant)?.name || ""
        } />
        <StatCard
          label="OSSIE 规范版本"
          value={info?.spec || "—"}
          hint="core-spec / ontology 对齐版本"
        />
        <StatCard
          label="平台存储"
          value={info?.storage || "—"}
          hint="应用自身存储（非语义层目标库）"
        />
      </div>

      <div className="split">
        <div className="panel panel-pad">
          <div className="panel-title">基本配置</div>
          <div className="form">
            <label>
              默认提交作者
              <input
                value={defaultAuthor}
                placeholder="developer"
                onChange={(e) => setDefaultAuthor(e.target.value)}
              />
            </label>
            <label>
              默认部署 schema
              <input
                value={defaultSchema}
                placeholder="public"
                onChange={(e) => setDefaultSchema(e.target.value)}
              />
            </label>
            <div className="hint">
              环境令牌（host / 连接串 / metalake）只存在于数据源与设置中，永不写入 OSSIE 文档。
            </div>
            {notice && <div className="ok-text">{notice}</div>}
            {error && <div className="error-text">{error}</div>}
            <div className="row">
              <button className="primary" onClick={save} disabled={busy}>
                保存设置
              </button>
            </div>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="panel-title" style={{ margin: 0 }}>
              租户
            </div>
            <span className="spacer" />
            <button className="sm" onClick={() => setNewTenantOpen(true)}>
              + 新建租户
            </button>
          </div>
          <DataTable
            columns={tenantColumns}
            rows={tenants}
            rowKey={(t) => t.id}
            empty="没有租户"
          />
        </div>
      </div>

      {newTenantOpen && (
        <Modal title="新建租户" onClose={() => setNewTenantOpen(false)}>
          <div className="form">
            <label>
              名称
              <input
                value={newTenantName}
                onChange={(e) => setNewTenantName(e.target.value)}
                placeholder="acme"
              />
            </label>
            <label>
              描述
              <input
                value={newTenantDesc}
                onChange={(e) => setNewTenantDesc(e.target.value)}
              />
            </label>
            {tenantError && <div className="error-text">{tenantError}</div>}
            <div className="modal-actions">
              <button onClick={() => setNewTenantOpen(false)}>取消</button>
              <button
                className="primary"
                disabled={busy || !newTenantName.trim()}
                onClick={createTenant}
              >
                创建
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
