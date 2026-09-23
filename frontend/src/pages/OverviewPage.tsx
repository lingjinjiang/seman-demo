import { useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { DataTable, PageHeader, StatCard, type Column } from "../components/ui";
import type { Repo } from "../types";

export function OverviewPage({
  tenant,
  tenantName,
  repos,
  refresh,
  onOpen
}: {
  tenant: string;
  tenantName: string;
  repos: Repo[];
  refresh: () => Promise<void>;
  onOpen: (repoId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const repo = await api.createRepo(name.trim(), description.trim() || undefined, tenant);
      setName("");
      setDescription("");
      setOpen(false);
      await refresh();
      onOpen(repo.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (repo: Repo) => {
    if (!confirm(`删除模型仓库 ${repo.name}？该操作不可恢复。`)) return;
    try {
      await api.deleteRepo(repo.id);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const columns: Column<Repo>[] = [
    {
      key: "name",
      header: "模型仓库",
      render: (r) => <span className="cell-primary">{r.name}</span>
    },
    {
      key: "description",
      header: "描述",
      render: (r) => <span className="sub">{r.description || "—"}</span>
    },
    {
      key: "tenant",
      header: "租户",
      width: "150px",
      render: (r) => <span className="badge">{r.tenantId}</span>
    },
    {
      key: "updatedAt",
      header: "更新时间",
      width: "180px",
      render: (r) => new Date(r.updatedAt).toLocaleString()
    },
    {
      key: "actions",
      header: "",
      width: "130px",
      align: "right",
      render: (r) => (
        <span className="cell-actions" onClick={(e) => e.stopPropagation()}>
          <button className="sm" onClick={() => onOpen(r.id)}>
            打开
          </button>{" "}
          <button className="sm danger" onClick={() => remove(r)}>
            删除
          </button>
        </span>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="项目概览"
        subtitle={`租户 ${tenantName}（${tenant}）· 一份文档 = 一个语义模型`}
        actions={
          <button className="primary" onClick={() => setOpen(true)}>
            + 新建模型仓库
          </button>
        }
      />

      <div className="split" style={{ marginBottom: 16 }}>
        <StatCard label="模型仓库" value={repos.length} hint="当前租户下" />
        <StatCard
          label="最近更新"
          value={
            repos.length
              ? new Date(repos[0].updatedAt).toLocaleDateString()
              : "—"
          }
          hint={repos[0]?.name || ""}
        />
        <StatCard label="建模路径" value="本体 → 语义模型" hint="ontology 是增强层，非前置门槛" />
      </div>

      {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="panel">
        <DataTable
          columns={columns}
          rows={repos}
          rowKey={(r) => r.id}
          onRowClick={(r) => onOpen(r.id)}
          empty="还没有模型仓库，先创建一个吧"
        />
      </div>

      {open && (
        <Modal title="新建模型仓库" onClose={() => setOpen(false)}>
          <div className="form">
            <label>
              名称
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="retail_analytics"
              />
            </label>
            <label>
              描述
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="hint">仓库将创建在租户 {tenant} 下，默认分支 main。</div>
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button onClick={() => setOpen(false)}>取消</button>
              <button
                className="primary"
                disabled={busy || !name.trim()}
                onClick={create}
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
