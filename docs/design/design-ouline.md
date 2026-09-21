# Ossie Studio — 产品设计与开发大纲（v2）

> 基于 ontology/semantic model 规范研究与架构讨论沉淀的设计决策。
> 技术栈与里程碑详见 `ROADMAP.md`，本文聚焦：**用户指引（工作流）** 与 **建模细节（数据源控制、ontology 关系处理）**。

---

## 0. 设计立场（三条铁律，所有功能决策的裁判）

1. **数据语义层为体，业务本体为用**：semantic model 是唯一必需层、建模主战场；ontology 是有 ROI 触发条件的增强，永不成为前置门槛。
2. **环境令牌不进模型**：`source` 只写逻辑名（标识），定位信息（host/metalake/连接串）只存在于环境绑定表（定位符）。模型文档永远可携带。
3. **承诺面 = 背锅面**：导出向导在承诺做出的那一刻就分流环境类型，"导出即用"只绑定平台托管环境；外部环境交付的是交接包 + 验收工具。

依赖结构（决定一切顺序问题的底层事实）：

```
metric ──▶ field ──▶ dataset ──▶ source(逻辑名) ──▶ 环境绑定表 ──▶ catalog/物理库
ontology ──(OntologyMap/mapping，单向)──▶ dataset/field
```

---

## 1. 用户指引：三种进入场景与默认工作流

### 1.1 场景识别（立项时第一个问题）

| 场景 | 起点 | ontology 时机 | 占比预期 |
|---|---|---|---|
| **A. 存量数据 + BI/问数**（默认） | 业务度量清单 | **后置萃取**（数据集站稳后升华） | ~80% |
| **B. Greenfield / 新业务系统** | 业务事实定义 | **前置**（作为数据建模的需求文档） | 少数 |
| **C. 已有 OWL/Palantir 本体** | 本体导入 | **前置**（遗产即起点，dataset 去实现） | 金融/政务 |

场景 B/C 由产品入口分流，但 artifact 与依赖链不变：**metric 的实现永远最后**（它站在硬依赖链顶端）。

### 1.2 默认工作流（场景 A，五步）

```
① 总线矩阵视图（业务过程 × 维度填格子）——纯业务语言
        ↓ 每格批量生成
② 骨架 metric（📝 name/description/ai_context 齐全，expression 留空）
        ↓ 由 metric 反推
③ dataset 设计（需要哪些表/字段/关系；决定"从 catalog 精选导入哪些表"）
        ↓ 绑定后自动点亮
④ metric 补表达式 → 状态升级；存在性校验自动跑
        ↓ 按需触发（信号：问数失败集中在组合式问题 / 模型数量增长）
⑤ 萃取 concept → 半自动生成 ontology + 建议 mapping
```

每步都有即时产出物，依赖方向与 artifact 硬依赖一致（不建引用空气的东西）。

### 1.3 建模期不设 ontology 门槛

Ontology tab 存在但不在默认工作流；两个入口：
- **萃取 concept**（自下而上）：选中 dataset/metric → 生成 concept + 建议 mapping；
- **导入外部本体**（自上而下）：OWL / Palantir / LinkML。

### 1.4 导出向导分流（承诺管理）

```
目标环境类型？
(•) 平台托管环境  → 一键部署（平台自建，承诺"导出即用"）
( ) 外部协作环境  → 生成交接包（明示：需环境团队完成 N 项准备；
                     平台提供验收工具，不适用"即用"承诺）
```

---

## 2. 数据源控制（建模细节一）

### 2.1 source 三态

| 状态 | 写法 | 校验 |
|---|---|---|
| 未绑定 📝 | 空 | 无存在性校验 |
| 逻辑名 🔗 | `sales.public.orders`（**禁止** host/metalake 等环境令牌） | register 后自动存在性校验 |
| 内联 query | SQL 字符串 | 部署时校验 |

**反例（禁止进模型）**：`gravitino://A/sales/public/orders` —— `A` 是环境令牌，迁移即失效。

### 2.2 环境一等公民与接入模式

- 环境（dev/test/prod）为 studio 顶层对象；
- **绑定表**：键控 `(env, 逻辑名) → 坐标/连接`，平台资产，**不进导出物**；
- 支持环境克隆（相邻环境复制绑定表做底稿）；
- 数据源注册（数据源名 → 连接串 + 类型 + **默认 metalake**）同属平台资产，解析时拼接，不进 OSSIE 文档（或仅以 custom_extensions 托运数据源名）。

**两种接入模式**：

| 模式 | 适用 | 绑定形态 |
|---|---|---|
| 混合接入（直连 PG + Hive + Gravitino 并存） | 过渡期 | 逐表绑定：`(env, 逻辑名) → 坐标/连接` |
| **统一接入（Gravitino 为唯一接入点）** | 目标态，多场景场景适用 | **退化为每环境一条数据源注册**；source 省略 metalake（注册时配默认 metalake），metalake 命名差异被吸收进注册表——跨环境重配量从 N 张表缩到 1 个数据源 |

### 2.3 校验三层与 dataset 状态机

```
层1 结构校验（离线永远跑）：schema/内部引用完整性 → error
层2 存在性校验（register 触发，连 catalog 时自动启用）：
    source 可解析、物理列存在、类型兼容 → error
    （实现：sqlparser-rs 提取 expression 列引用 × catalog schema 快照缓存）
层3 执行校验（deploy/查询硬门禁）：EXPLAIN 预检

状态机：📝 未绑定 → 🔗 已关联（层2 可跑）→ ✅ 已验证 → 🚀 已部署
        （"空表但可查" = ✅，区别于"服务不可用"）
```

### 2.4 导出包三层

```
model.yaml       模型文档（source 全逻辑名，环境无关）
bindings.yml     绑定模板（结构齐全 + ${TOKEN} 占位，导入方只填 2-3 个环境变量）
data-plan.yaml   数据预案（每表：跳过 / 造数 / 管道引用）
acceptance.yaml  验收标准（绑定覆盖率、表存在性、冒烟查询）——平台的核心交付
```

导入流程固定剧本：导入 → 填令牌 → 确认建议绑定（自动发现匹配）→ 执行 data-plan → 健康检查出报告。

### 2.5 模型驱动造数（环境自举）

- `ddl.rs` 已有 DDL 生成 → 延伸：**按 datatype/约束/relationship 生成合成数据**；
- deploy 时"建表 + 造数"一键完成，dev/test 环境无需搬运生产数据即可演示查询；
- data-plan 中"造数"策略的默认实现。

### 2.6 身份三层与 custom_extensions 下沉

| 层 | 内容 | 稳定性 | 位置 |
|---|---|---|---|
| 1 模型词汇 | `source` 纯逻辑名（业务词汇） | 业务寿命级 | OSSIE 文档 |
| 2 catalog 身份 | catalog.schema.table 坐标、分区信息、资产标签、原始属性 | 命名级，跨环境稳定 | **custom_extensions（vendor_name: GRAVITINO）** |
| 3 接入点 | server URL、凭证、默认 metalake | 环境特定 | 数据源注册表（平台资产） |

- **下沉红线**：判断法——"env A 和 B 里这个值会不一样吗？"会（server/metalake/凭证）→ 注册表；不会（名字/分区/注释）→ 可下沉；
- custom_extensions 形状：`{vendor_name, data}`，**data 为 JSON 字符串**，schema 自定（建议 `{"catalog":"...","schema":"...","table":"..."}`）；
- **vendor_name `GRAVITINO` 尚未进官方枚举**（规范清单只有 SNOWFLAKE/DBT/DATABRICKS/…）——先用约定字符串，成熟后向社区提 PR 注册；
- **解析优先级**：register/解析优先读 custom 中的坐标，source 兜底——catalog 内表迁移时只改 custom，source 不动；
- round-trip 纪律：studio 将 custom_extensions 视为 opaque payload，导入导出忠实保留。

---

## 3. Semantic model 建模细节

### 3.1 metric 双面性

- 业务面（name/description/ai_context）与实现面（expression）同一 artifact 的两面；
- 骨架态（expression 空）合法，校验只查业务面；
- 建模入口以总线矩阵开始（而非 dataset 表单）——符合业务思维。

### 3.2 dataset 精选导入（catalog 浏览）

- **搜索优先**的 picker（表名/注释全文搜 + catalog/schema 过滤）：面对上千张表，树状浏览不够；
- **精选而非全量**（语义模型是 curated view，catalog 侧才是全量 inventory）；
- 导入产物一律草稿态（📝），自动完成：类型映射、`is_time` 推断、PK/UK、注释→description；
- 导入即 register（关联层写入映射，**键含 model 维度**）；已导入表去重提示（含跨模型可见："已在模型 X 中导入"）；
- 增量友好：后续新表分批导入。

#### 域标签层（域划分是元数据，不是 DDL）

生产库结构已定型的现实下，业务域划分不依赖 DB 层 schema 组织：

| 方案 | 说明 |
|---|---|
| Gravitino 自带 tag | 给资产打 `domain:sales` 类标签；统一 API、全消费者可见；每环境一份需同步 |
| 平台侧标签（映射表加列） | 随平台走，可跨环境复用；Gravitino 侧消费者看不到 |
| **结合（推荐）** | Gravitino tag 为 canonical，平台导入时同步缓存 |

标签来源三级：① 命名约定自动打标（`ord_*`→交易域）；② 注释语义 LLM 辅助分类，人工确认；③ picker 人工修正。域词汇表可演进为 ontology concept。

### 3.3 relationship 的 join 语义

- `from/to` + `from_columns/to_columns` = 等值 join（不要求真实 FK）；
- **非唯一键 join 给 fanout 警告**（"目标列不是 unique key，聚合可能被放大"）——查询编译器子查询隔离的依据；
- 同值关联（如按 city 关联）就是普通 relationship，无特殊语法。

### 3.4 多场景模型的组织（大底座 + N 个场景）

- **规范约束：一份文档 = 一个语义模型**，无跨模型引用（spec.md:87-91）——场景 = studio 的一个 repo = 一份 OSSIE 文档；
- 三层分工：Gravitino = 全量 inventory → picker = 精选 → N 个场景模型 = 交付物；
- **映射表带 model 维度**：`(env, model_id, dataset_id) → catalog asset`；一张表可进多个模型（多对多）；
- **共享维度一致性**（customers/date 反复进多个模型，防漂移）三层次：
  1. 低成本：跨模型导入时一致性提示（"模型 X 已有此资产 dataset，复制还是新建"）；
  2. 中成本：studio 级共享数据集库（平台功能，不进 OSSIE 文档），源资产变更批量提醒更新；
  3. 高成本：ontology 跨模型对齐——同一 concept 绑定多个模型的 dataset，语义锚点（ontology 价值随模型数 scaling 的第一个兑现点）；
- **模型拆分粒度**：按查询面 + 责任团队，不按数据域；单模型 ~50+ dataset 时 join 路径解析与 grounding 质量下降，应拆或抽公共维度；
- **Gravitino 覆盖边界**：API-only 服务数据不在其内——已 ETL 进湖的直接可用；服务背后是 DB 的用 JDBC catalog 接；纯 API 的退回逐表绑定模式（该 dataset 单独绑数据源），或落地为表后入 catalog。

---

## 4. Ontology 建模细节（重点：关系处理）

### 4.1 画布渲染规范（与 demo 一致）

- 节点 = 全部 concept：EntityType 大节点实线、ValueType 小节点浅色（可整体开关）；
- **边 = 仅二元关系**，方向 = 定义侧（第一角色）→ 另一端，标签 = `Concept.name`；
- **multiplicity 标在箭头端**（被决定端）：ManyToOne→`1`，OneToOne→`1:1`，无约束→不标；
- **unary = 节点徽章**（⚑）；**n 元 = 虚拟实体 hub**（虚线菱形，腿按 roles 顺序标 #1..#n，★ = 被决定角色）；
- 自环标角色名（`depends_on(blocked)`）；平行边各自带全名标签；🔑 = identify_by。

### 4.2 关系编辑器规则

| 规则 | 来源 |
|---|---|
| 声明侧（宿主）可修改 = 换边，**换边必须弹警告**（约束方向反转，语义已改变） | multiplicity 相对角色顺序定义 |
| roles **顺序即语义**（最后角色被前面元组函数决定） | spec |
| multiplicity 枚举无 ManyToMany：多对多 = 留空 | spec |
| OneToOne 仅二元可选 | spec |
| 同 concept 多角色时角色名必填 | spec |
| identify_by 关系必须声明在被标识 concept 下（编辑器锁定该侧） | spec |
| 二元关系未标 multiplicity → validation **warning**（"确认是否有意为之"） | 建模纪律 |

### 4.3 虚拟实体 ↔ 真实实体（升格/降格重构）

- **n 元关系 = 虚拟实体**（身份隐含在事实元组中）；真实实体 = 有建档者（identify_by 显式身份）；
- **升格（Promote）**：hub 右键"具名为实体" → 生成 EntityType + 补 identify_by + 拆 N 条二元 ManyToOne，引用自动迁移；
- **降格（Demote）**前置四条件（全中才允许）：identify_by 是代理键、仅对外 N 条 ManyToOne、无属性、不被其他关系引用；
- 画布视觉：虚拟实体虚线 + "n 元事实·无身份"角标，编辑器与真实实体不同（关系表单 vs concept 表单）。

### 4.4 名词测试引导（建档判据）

新建概念时向导提问（替代抽象的"是不是实体"）：
1. "业务上怎么称呼它？"（有名词 → 实体倾向）
2. "它会被'处理'吗？"（取消/审批/退款 → 实体）
3. "需要事后指向单笔吗？"（对账/审计/售后 → 实体）

三个否 → 建议保持为关系/事实态。

### 4.5 等价归一化检查（validation）

- 二元 → Boolean 的关系 ⇄ unary 关系：互相提示可重构；
- 纯连接实体（满足降格四条件）：提示可折叠为 n 元；
- 表达式合法性：`derived_by`/`requires` 的点 join 引用检查（expression language 子集）。

---

## 5. Mapping（第三视图）

- 导出终态为 **OntologyMap 文档**（内嵌 semantic_model + concept_mappings）；
- artifact kind `concept_mapping`，key 按 concept 限定（仿 `ontology_relationship:Person.earns`）；
- 编辑器形态：**左 concept / 右 dataset.field / 中间连线**（编辑时必须同时看到两侧，故不并入任何单一 tab）；
- 跨层校验：mapping 引用的 concept/relationship/dataset/field 必须双侧存在；
- concept/relationship 表单提供可选"全局标识符（URI/QName）"字段（+ `prefixes`）——为 RDF/OWL 对齐留门。

---

## 6. 与执行/生态的接口（细节见 ROADMAP.md）

- **DeployTarget trait**：PG（已有）/ Gravitino（exporter 照 converters/polaris 模式）；
- **查询编译器**：语义查询 IR（LLM 契约）→ join 路径 + fanout 隔离 → Trino SQL；LLM 永不直出 SQL；
- **导入生态**：dbt（复用社区 ossie_dbt）、catalog 精选导入（§3.2）、OWL/Palantir/LinkML（§1.3）；
- **问数 Agent**：grounding 分层——真实实体注册为"可定位可下钻"，虚拟实体/事实只以 verbalizes 参与匹配（可下钻性的来源）。

---

## 7. 分期（并入 ROADMAP 的增量调整）

| 期 | 相对 ROADMAP v1 的调整 |
|---|---|
| P0 | + DIALECTS 已对齐；+ source 逻辑名校验规则（禁环境令牌） |
| P1 | + 总线矩阵入口、骨架 metric 状态；+ fanout 警告；存在性校验（层2，sqlparser-rs + schema 快照） |
| P2 | Gravitino exporter 按 DeployTarget 实现；**绑定表 + 环境概念 + 导出包三层**；模型驱动造数 |
| P3 | Agent grounding 按真实/虚拟实体分层 |
| P4 | ontology 关系全套规则（§4）；升格/降格重构；萃取 concept；**OntologyMap 导出** |
| P5 | OWL/LinkML 导入（视客户信号）；OIDC/审计 |

验收标准补充：跨环境迁移演练（A 环境导出 → B 环境导入 → 填令牌 → 健康检查全绿）为 P2 出口标准之一ß