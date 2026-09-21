# 里程碑与分期状态

> 出口标准（Definition of Done）见 `docs/design/roadmap.md` §5，此处只跟踪状态。

## 总览

| 里程碑 | 分期 | 内容 | 状态 |
|--------|------|------|------|
| M1 | P0 | 基座对齐（spec 枚举、source 逻辑名规则、round-trip 过官方校验） | 进行中 |
| M2 | P1 | 语义查询编译器 + metric 驱动工作流 | 未开始 |
| M3 | P2 | 数据源控制 + Gravitino（跨环境迁移演练） | 未开始 |
| M4 | P3 | LLM 问数 Agent | 未开始 |
| M5 | P4 | Ontology 关系语义 + Mapping | 进行中 |
| M6 | P5 | 治理与生态 | 未开始 |

## P0 基座对齐

- [ ] `model.rs` DIALECTS 对齐 spec 全量枚举（补 `SIGMA` / `THOUGHTSPOT` / `DAX`）
- [ ] dataset 补齐 `unique_keys`、`ai_context`；field 补齐 `label`、`dimension.is_time`
- [ ] source 逻辑名规则：validation 拒绝环境令牌（host / metalake / 端口形态）
- [ ] 对照官方 `validation/validate.py` 补校验规则；round-trip golden 测试
- [x] 导出物可被 `examples/sample_model.yaml` round-trip 通过（既有能力）

## P1 语义查询编译器 + metric 驱动工作流

- [ ] 查询 IR（JSON Schema 先行）
- [ ] `src/query.rs`：IR 校验 + 单/跨 dataset 编译 + 扇出检测
- [ ] Trino 方言后端；`/query/preview` 纯函数预览
- [ ] 总线矩阵视图；metric 骨架态
- [ ] 存在性校验（`src/existence.rs`）

## P2 数据源控制 + Gravitino

- [ ] 环境一等公民 + 绑定表 + 环境克隆
- [ ] 数据源注册（含默认 metalake）
- [ ] custom_extensions 下沉 catalog 坐标（vendor_name: GRAVITINO）
- [ ] dataset 状态机（📝 → 🔗 → ✅ → 🚀）
- [ ] 导出包三层（model / bindings / data-plan / acceptance）
- [ ] `DeployTarget` trait + Gravitino exporter

## P3 LLM 问数 Agent

- [ ] Python 服务（FastAPI + LiteLLM）
- [ ] Grounding 检索 API（Rust 侧）
- [ ] Agent 工具集 + 护栏（IR schema、EXPLAIN、行列硬限）
- [ ] grounding 分层（真实/虚拟实体）

## P4 Ontology 关系语义 + Mapping

- [x] 关系语义引擎（arity 判定、multiplicity 适用性、降格四条件、等价归一化提示）——`src/ontology.rs`
- [x] 画布渲染规范产品化（二元有向边 + 箭头端 multiplicity、unary 徽章、n 元虚线 hub、自环角色名、平行边全名、identify_by 🔑）——`frontend/src/pages/OntologyTab.tsx`
- [x] 关系编辑器规则（multiplicity 适用性、换边警告、roles 有序编辑）——`frontend/src/components/forms.tsx`
- [x] validation 规则（一元不得带 multiplicity、OneToOne 仅二元、二元未标 multiplicity → warning、identify_by 必须二元）——`src/validation.rs`
- [x] 等价归一化检查（二元→Boolean 提示、纯连接实体折叠提示）——`src/ontology.rs`
- [ ] 虚拟实体 ↔ 真实实体**重构操作**（升格 / 降格，含引用迁移）
- [ ] 名词测试向导（三问引导实体化决策）
- [ ] derived_by / requires 点 join 引用校验（expression language 子集）
- [ ] Mapping（`concept_mapping` artifact + 第三视图 + OntologyMap 导出）
- [ ] 萃取 concept（从 dataset/metric 半自动生成）

## P5 治理与生态

- [ ] 用户 / RBAC / 多租户（OIDC）
- [ ] metrics 开放 API
- [ ] 条件项：OWL/LinkML 导入（视客户信号）
