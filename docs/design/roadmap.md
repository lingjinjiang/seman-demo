# Ossie Studio — Roadmap & 技术栈参考（v2）

> 目标：从"OSSIE 建模平台原型"演进为"建模平台 + 语义查询编译 + Gravitino/Trino 执行 + LLM 问数"的完整问数平台。
> 架构讨论基线：Apache Ossie（incubating）0.2.0.dev0 + Apache Gravitino + Trino。
> **产品设计与建模细则（用户指引、数据源控制、ontology 关系规则）见 `docs/design-outline.md`**；本文管工程分期与技术选型。
> ontology 画布交互原型（渲染规则参照）：`design/ontology-demo.html`。

---

## 1. 现状盘点（基线）

### 已有资产

| 模块 | 文件 | 状态 | 说明 |
|------|------|------|------|
| 工件模型 | `src/model.rs` | ✅ | 5 种 artifact（concept / ontology_relationship / dataset / semantic_relationship / metric），Snapshot=BTreeMap |
| 校验 | `src/validation.rs` | ✅ | 引用完整性、枚举、继承链、identify_by 等 |
| 版本控制 | `src/vcs.rs` | ✅ | 分支/提交/diff(`HEAD~N`)/reset/三路 merge，工件级 |
| DDL 生成 | `src/ddl.rs` | ✅ | 纯函数生成 PG DDL（datatype→PG 类型映射、PK/UK/FK） |
| 导入导出 | `src/export.rs` | ✅ | OSSIE YAML/JSON 双向 |
| API | `src/api.rs` | ✅ | REST 全量 CRUD |
| 前端 | `frontend/` | ✅ | React Flow 画布 + Ontology/Semantic/Git 三页 |
| 测试 | `tests/integration.rs` | ✅ | 内存 SQLite 全链路 |

### 与目标架构的差距

| 差距 | 严重度 | 归属 |
|------|--------|------|
| 无语义查询编译器（只有 DDL，没有 query→SQL） | 🔴 核心 | P1 |
| ontology **关系语义**未落实：声明侧/multiplicity 方向/unary/n 元/虚拟实体/升格降格，画布与校验均未按规范语义实现（demo 已定义渲染规则，未产品化） | 🔴 核心 | P4 |
| 数据源控制缺位：source 无逻辑名约束、无环境概念、无绑定表、无分级健康诊断 | 🟠 | P2 |
| 无 ontology mappings / OntologyMap 导出 | 🟠 | P4 |
| 无 LLM 问数层 | 🔴 | P3 |
| `model.rs` DIALECTS 只有 7 个，落后于 spec（已列 P0） | 🟡 | P0 |
| 无骨架 metric / 总线矩阵入口（metric 驱动工作流缺起点） | 🟡 | P1 |
| 无存在性校验（表达式列引用 × 物理表结构比对） | 🟡 | P1 |
| 无用户/权限/多租户 | 🟡 | P5 |

---

## 2. 目标架构（v2：引入环境绑定层）

```
┌────────────────────────────────────────────────────────────┐
│ 前端（React + React Flow）                                  │
│  总线矩阵 │ 画布(ontology 规范渲染/semantic) │ SQL 控制台     │
│  Mapping 编辑器 │ 环境/绑定管理 │ 数据预览与造数              │
├────────────────────────────────────────────────────────────┤
│ Rust 后端（axum + sqlx）                                     │
│  artifact/VCS/validation/export           【已有】           │
│  + query.rs      语义查询编译器（IR → SQL）        【P1】    │
│  + existence.rs  存在性校验（列引用×schema 快照）  【P1】    │
│  + binding.rs    环境/绑定表/健康诊断              【P2】    │
│  + gravitino.rs  Gravitino exporter(DeployTarget)【P2】    │
│  + trino.rs      Trino 查询执行代理                【P2】    │
│  + ontology 规则引擎(关系语义/等价重构检查)        【P4】    │
├────────────────────────────────────────────────────────────┤
│ LLM Agent 服务（Python，独立部署）                 【P3】    │
├────────────────────────────────────────────────────────────┤
│ 执行与元数据面                                               │
│  Trino ──(gravitino-connector)──▶ Apache Gravitino         │
│     解析链：dataset.source(逻辑名) → 环境绑定表 → 坐标       │
└────────────────────────────────────────────────────────────┘
```

关键设计决策（v2 更新，理由见 design-outline.md）：

1. **语义查询 IR**：LLM↔编译器契约（`{metrics, dimensions, filters, order_by, limit, path?}`），编译器只接受 IR + 模型快照；LLM 永不直出 SQL；
2. **方言后端 trait**：Trino 首选，PG（已有 deploy 体系）次之，ANSI 保底；
3. **source 只写逻辑名，环境令牌一律进绑定表**（`(env, 逻辑名) → 坐标/连接`，平台资产，不进导出物）；⚠️ 取代 v1 中"gravitino:// 坐标进 source"的设想——那是反模式；
4. **编译器为纯函数**：`(Snapshot, IR, dialect) -> SQL + 诊断`，仿 `ddl.rs`。

---

## 3. Roadmap

### P0 基座对齐（1~2 周）

- [ ] `model.rs` DIALECTS 对齐 spec 全量枚举（+SIGMA/THOUGHTSPOT/DAX）
- [ ] dataset 补齐 `unique_keys`、`ai_context`；field 补齐 `label`、`dimension.is_time`
- [ ] **source 逻辑名规则**：validation 拒绝环境令牌（host/metalake/端口形态检测），只许 `schema.table` / `db.schema.table` / query
- [ ] 校验规则对照官方 `validation/validate.py` 补差；round-trip golden 测试

**验收**：`examples/sample_model.yaml` 导出物可被官方 `validate.py` 零修改通过；source 含环境令牌的样例被正确拒绝。

### P1 语义查询编译器 + metric 驱动工作流（核心，4~6 周）★

编译器：
- [ ] 查询 IR（JSON Schema 先行，前后端共用）
- [ ] `src/query.rs`：IR 校验（指标/维度/字段存在性、类型相容）
- [ ] 单 dataset 编译：metrics + dimensions + filters + order/limit
- [ ] 跨 dataset：relationships 图构建、join 路径解析（最短/显式 `path` 覆盖）、**扇出检测**（many 侧强制子查询隔离）
- [ ] 时间维度：`is_time` 滚动/对比 filter
- [ ] Trino 方言后端；`/query/preview` 纯函数预览 API；前端 SQL 预览 + 查询控制台
- [ ] `sqlparser-rs` 二次校验编译产物

工作流与校验：
- [ ] **总线矩阵视图**（业务过程 × 维度）批量生成骨架 metric
- [ ] **metric 骨架态**：expression 为空合法，只校验业务面
- [ ] **存在性校验（`src/existence.rs`）**：sqlparser-rs 提取 expression 列引用 × 数据源 schema 快照比对（快照来自 PG introspection / Gravitino，缓存于平台侧）
- [ ] relationship 非唯一键 **fanout warning**

**验收**：10 题编译基准（单源/双源 join/复合指标/时间过滤）sqlparser + Trino EXPLAIN 全过；骨架 metric 全生命周期（骨架→绑定 dataset→补表达式→点亮）可演示。

### P2 数据源控制 + Gravitino（3~4 周）

数据源控制（design-outline §2、§2.6、§3.4）：
- [ ] **环境一等公民**：env CRUD；绑定表 `(env, 逻辑名) → 坐标/连接串`，环境克隆
- [ ] 数据源注册（数据源名 → 连接 + 类型 + **默认 metalake**）；**统一接入模式下绑定退化为每环境一条注册**
- [ ] **custom_extensions 下沉 catalog 坐标**（vendor_name: GRAVITINO，data 为 JSON 字符串；解析优先读 custom、source 兜底；适时向社区注册 vendor_name）
- [ ] **dataset 状态机**：📝未绑定 → 🔗已关联 → ✅已验证 → 🚀已部署；层 2 校验挂 register 触发
- [ ] **分级健康诊断**：未绑定 / 表缺失 / 空表就绪（可查）/ 已部署
- [ ] **导出包三层**：`model.yaml`（全逻辑名）+ `bindings.yml`（`${TOKEN}` 占位模板）+ `data-plan.yaml` + `acceptance.yaml`
- [ ] 导入剧本：自动发现建议绑定 → 确认 → data-plan 执行 → 健康报告
- [ ] **picker 域标签机制**：Gravitino tag 为 canonical + 平台缓存；命名约定自动打标 + 注释语义 LLM 辅助分类
- [ ] **映射表带 model 维度**：`(env, model, dataset) → catalog asset`（一表多模型）；共享维度一致性提示
- [ ] **模型驱动造数**：`ddl.rs` 延伸，按 datatype/约束/relationship 生成合成数据

Gravitino 与执行：
- [ ] `DeployTarget` trait：现有 PG 直连重构 + Gravitino 实现（REST 客户端，照 `converters/polaris` 模式）
- [ ] exporter：dataset→table（PK/UK/comment），metrics 进 properties 托运
- [ ] 资产映射表（血缘锚点）：model artifact ↔ catalog 标识
- [ ] Trino + Gravitino 执行链路联调

**验收**：**跨环境迁移演练**——A 环境导出 → B 环境导入 → 填 3 个以内环境令牌 → 建议绑定确认 → data-plan（含造数）→ 健康检查全绿，冒烟查询可跑。⚠️ 风险：Gravitino Trino connector view 支持在途（[gravitino#11925](https://github.com/apache/gravitino/issues/11925)），query-defined dataset 先用后端预建 view 绕行。

### P3 LLM 问数 Agent（3~4 周）

- [ ] Python 服务（FastAPI + LiteLLM），只走 REST，独立部署
- [ ] Grounding 检索 API（Rust 侧）：synonyms/ai_context/description 全文检索（先 PG tsvector / SQLite FTS5）
- [ ] Agent 工具集：model_search → IR 生成（JSON Schema 约束）→ compile → validate → execute（row limit）→ 解释
- [ ] **grounding 分层**：真实实体注册为"可定位/可下钻"，虚拟实体（n 元事实）与 verbalizes 仅参与语义匹配——可下钻性的工具层保障
- [ ] 护栏：IR schema 校验、编译诊断回灌重试（≤N）、EXPLAIN 预检、行列硬限、歧义反问不硬猜
- [ ] 会话与提问历史；回答附"依据"（命中的 metric/relationship/ontology 事实句，可展开 SQL）

**验收**：20 题标准集端到端：≥80% 一次过、0 幻觉 SQL（拒答/反问算通过）。

### P4 Ontology 关系语义 + Mapping（4~6 周）★

关系语义引擎（本轮重新理解的核心，规则全集见 design-outline §4）：
- [ ] **画布渲染规范产品化**（以 `design/ontology-demo.html` 为 UI 规格）：
  二元有向边（定义侧→另一端）、multiplicity 标箭头端、unary 徽章、
  n 元虚线 hub（角色腿按序 + ★被决定端）、自环标角色名、平行边全名标签、
  EntityType/ValueType 分级、🔑 标识
- [ ] **关系编辑器**：声明侧可改（**换边弹警告：约束方向已反转**）、roles 有序编辑、
  multiplicity（无 ManyToMany，OneToOne 限二元）、identify_by 锁定声明侧、
  同 concept 多角色强制角色名
- [ ] **validation 规则**：二元关系未标 multiplicity → warning；换边语义提示；
  角色/宿主引用完整性
- [ ] **虚拟实体 ↔ 真实实体重构**：
  升格（hub→EntityType + identify_by + 拆 N 条二元，引用迁移）；
  降格四条件检查（代理键 / 纯 ManyToOne / 无属性 / 无被引用）
- [ ] **等价归一化检查**：二元→Boolean ⇄ unary 互相提示；纯连接实体→n 元折叠提示
- [ ] **名词测试向导**（三问：怎么称呼/会被处理吗/需事后指向吗）引导实体化决策
- [ ] derived_by/requires 表达式编辑与点 join 引用校验（expression language 子集）

Mapping：
- [ ] artifact kind `concept_mapping`（key 按 concept 限定）；跨层校验（双侧引用存在）
- [ ] Mapping 编辑器：左 concept / 右 dataset.field / 中间连线（第三视图）
- [ ] **OntologyMap 导出**（内嵌 semantic_model + concept_mappings）；concept/relationship 可选全局标识符（URI/QName）+ `prefixes`
- [ ] **萃取 concept**：从已选 dataset/metric 半自动生成 concept + 建议 mapping

**验收**：ontology 全模型（含 unary/n 元/派生规则/虚拟实体）导出为 OntologyMap 且过官方校验；升格/降格往返无损（含引用迁移）；画布规则与 demo 一致。

### P5 治理与生态（持续）

- [ ] 用户/RBAC/多租户（OIDC：Keycloak）；审计日志
- [ ] metrics 开放 API（REST/GraphQL）供 BI 工具消费
- [ ] 条件项（客户信号触发）：OWL/LinkML 导入（LinkML 桥可借力其 OWL/SHACL 生成器）；行级 merge 冲突编辑
- [ ] 跟踪社区：OSSIE 查询语言标准化、[#256 Gravitino converter](https://github.com/apache/ossie/issues/256)、[ontology-query #107](https://github.com/apache/ossie/issues/107)、[LinkML #3983](https://github.com/linkml/linkml/issues/3983)

---

## 4. 技术栈参考

沿用不变：Rust + axum + sqlx；React 18 + TS + Vite + React Flow；SQLite/PG 平台存储；serde_yaml/JSON ↔ OSSIE 文档。

新增/调整：

| 需求 | 选型 | 说明 |
|------|------|------|
| SQL 解析/校验（Rust） | `sqlparser-rs` | 编译产物校验 + **expression 列引用提取**（存在性校验） |
| Trino 执行 | 直连 HTTP `/v1/statement`（reqwest） | 协议简单；代理层自带行数/超时护栏 |
| Gravitino 客户端 | reqwest 自研轻客户端 | 对标 `converters/polaris` 模式 |
| LLM Agent | Python + FastAPI + LiteLLM | 独立部署，REST 调 Rust 侧 |
| grounding 检索 | PG tsvector / SQLite FTS5 起步 | 零新增组件；语料大再上 Meilisearch |
| 鉴权 | Keycloak（OIDC） | P5 |

模块落位（相对 v1 增量）：

```
src/
  query.rs        【新】IR + 编译器 + 方言后端 trait
  existence.rs    【新】存在性校验（列引用 × schema 快照）
  binding.rs      【新】环境/绑定表/健康诊断/导出包生成
  gravitino.rs    【新】REST 客户端 + exporter
  trino.rs        【新】查询执行代理
  ontology_rules  【新】关系语义/等价重构/降格四条件（validation 扩展）
  ddl.rs          【改】DeployTarget 抽象 + 合成数据生成
  validation.rs   【改】source 逻辑名规则、multiplicity 提示
frontend/
  BusMatrix.tsx   【新】总线矩阵入口
  MappingEditor   【新】第三视图
  OntologyCanvas  【重写】按 design/ontology-demo.html 渲染规范
  EnvBinding.tsx  【新】环境与绑定管理
agent/            【新】Python FastAPI：LLM 编排 + 工具
```

不建议的方向（不变）：不引入重型语义层引擎（Cube/MetricFlow）；LLM 永不直出 SQL；私有语义只进 `custom_extensions`，导出物永过官方校验。**新增一条**：不做"全量 catalog 导入"——语义模型是精选视图，导入永远是多选式（design-outline §3.2）。

---

## 5. 里程碑汇总（v2）

| 里程碑 | 内容 | 出口标准 |
|--------|------|----------|
| M1 | P0 | 官方 validate.py round-trip 通过；source 环境令牌被拒 |
| M2 | P1 | 10 题编译基准 + EXPLAIN 全过；骨架 metric 全生命周期演示 |
| M3 | P2 | **跨环境迁移演练全绿**（导出→导入→填令牌→造数→冒烟查询）；Gravitino 双 catalog 可查 |
| M4 | P3 | 20 题集 ≥80% 一次过、0 幻觉 SQL |
| M5 | P4 | OntologyMap 导出过官方校验；升格/降格往返无损；画布符合渲染规范 |
| M6 | P5 | OIDC + 审计；metrics 开放 API |

v1 → v2 主要变更：①P1 并入"metric 驱动工作流"与存在性校验；②P2 从"Gravitino 对接"扩为"数据源控制 + Gravitino"，**坐标方案反转**（逻辑名进 source、坐标进绑定表），新增跨环境迁移演练为出口标准；③P4 从"仅 mapping"扩为"ontology 关系语义引擎 + 重构能力 + mapping"，吸收本轮 relationship 语义的全部结论；④P3 增加 grounding 分层（真实/虚拟实体）