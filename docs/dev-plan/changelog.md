# 开发变更记录

按轮次倒序记录。每条包含：日期、范围、摘要、涉及文件。

---

## 2026-09-23 — 本体页 IA 修正：关系下沉到概念之下

反馈「关系不应该和概念平级，关系应该是概念下的一个属性」。上一轮重设计虽然移除了左侧的
「新建关系」入口，但本体页仍保留了与「概念」平级的顶层「关系」标签页——关系在界面上依旧是
一等对象，与规范不符。

规范依据（`../ossie/ontology/ontology.md`）：ontology 以 *concept* 为主键分层，
「grouping each relationship under the concept that plays its first role」；
concept 的 schema 里 `relationships` 是它的一个字段。

**改动（仅前端信息架构，后端与工件模型不变）**

- `frontend/src/pages/OntologyPage.tsx`
  - 本体页标签收敛为 **概念 / 图谱 / Raw**，**移除顶层「关系」标签页与顶层「新建关系」按钮**。
  - 概念行改为进入**概念详情弹窗**：上半部是概念定义表单，下半部是「该概念声明的关系」表格
    （关系名 / 元数 / 其他角色 / 多重性 / verbalizes），并在此处提供 `+ 新建关系`。
  - 关系编辑走**二级弹窗**（`Modal` 叠加），owner 预填为当前概念；换边仍按 §4.2 弹警告。
  - 图谱中点击节点进入概念详情，点击边 / n 元 hub 直接进入对应关系编辑。
  - 概念重命名时若已有声明关系会**弹警告**：关系标识形如 `概念.关系名`，重命名不会自动迁移
    （自动级联迁移列入待办，见 milestones）。
- 概念表格新增「关系」计数列，直观体现「关系是概念的属性」。

**验证**：`npm run build` 通过；后端未改动。

**已知待办**：概念重命名的关系级联迁移；表格排序/分页。

## 2026-09-23 — 前端整体重设计 + 平台能力（租户 / 数据源 / 设置）

反馈「整个页面不太合适，需要按商用软件标准重设计」。本轮做布局与信息架构的整体调整，
并把平台级对象补齐（租户、数据源、设置），因此超出 roadmap 原 P2 的分批范围——
**这是一次结构性的 UI/平台重构，属于对 roadmap 分期的主动调整**。

**后端**

- `db.rs`：新增 `tenants` / `data_sources` / `settings` 表；`repos` 增加 `tenant_id`，
  唯一约束改为 `(tenant_id, name)`；新增容忍型 `ALTER TABLE` 迁移与默认租户播种。
  新增表的数值列用 `BIGINT`（避免 PG `INT4` 与 `i64` 解码不兼容）。
- 新增 `src/platform.rs`：租户 CRUD、PostgreSQL 数据源 CRUD + 连接测试、按租户的设置读写。
  数据源连接串由坐标拼装，**永不进入 OSSIE 文档**（design-ouline §2.6）。
- `src/vcs.rs`：`create_repo_scoped` / `list_repos_scoped`（仓库按租户隔离，同名互不冲突）。
- `src/api.rs`：新增 `/api/tenants`、`/api/data-sources`（含 `/test`）、`/api/settings`；
  `POST /api/repos` 接受 `tenantId`；新增 `POST /api/repos/{id}/semantic/deploy-to-source`
  （按数据源部署，连接信息不经过请求体）。
- **修复**：`CreateRepoReq` / `ResetReq` / `DeployReq` / `DeployToSourceReq` 缺少
  `#[serde(rename_all = "camelCase")]`，导致前端发送的 `tenantId`/`commitId`/`connectionUrl`
  被静默忽略（仓库创建会落到 default 租户、重置与部署接口不可用）。
- 数据源响应**脱敏**：不再回显 `password`。

**前端（整体重设计）**

- 布局改为「左侧按大功能分组的导航 + 顶部工作区工具条 + 右侧功能页」：
  工作区（项目概览）· 建模（本体 / 语义模型 / 版本控制）· 平台（数据源 / 设置）。
- 样式整体改为**浅色/白色主题**（设计令牌、卡片、表格、表单、弹窗、徽章统一重写）。
- **表格优先**：
  - 本体页：概念表（类型 / 继承 / identify_by / 关系数）、关系表（声明概念 / 元数 / 角色 /
    多重性 / verbalizes），另有「图谱」（规范渲染画布）与「Raw」（OSSIE YAML）两个视图。
  - 语义模型页：数据集 / 关系 / 度量三张表，另有「DDL / 部署」与「Raw」。
  - 数据源页：PostgreSQL 连接表（测试连接 / 编辑 / 删除）。
  - 版本控制页：分支表、历史表、提交与合并卡片、导入导出。
- 新建/编辑统一走**弹窗**（`Modal` 支持宽版），表单复用既有 `forms.tsx` 并新增「取消」动作。
- 新增组件：`components/ui.tsx`（PageHeader / Tabs / DataTable / StatCard）、
  `components/OntologyGraph.tsx`（从 `OntologyTab` 抽出的规范画布）。
- 页面重写为 `pages/Studio.tsx`（壳）、`OverviewPage`、`OntologyPage`、`SemanticPage`、
  `DataSourcesPage`、`SettingsPage`、`VersionControlPage`；移除 `OntologyTab` /
  `SemanticTab` / `GitTab`。
- 设置页提供：默认提交作者、默认部署 schema、租户管理与切换、规范版本与存储信息。

**验证**：`cargo test`（20 单测 + 4 集成）、`cargo check --all-targets`、`npm run build`
全部通过；并对 `tenants` / `data-sources` / `settings` / 租户隔离 / 密码脱敏做了本地端到端冒烟。

**已知取舍**：数据源仅支持 PostgreSQL（按需求）；租户隔离是应用层的 `tenant_id` 过滤，
尚未做鉴权与行级强隔离（属 P5）；连接测试与部署需要可达的 PG 实例，本地无 PG 时只验证错误路径。

## 2026-09-21 — Ontology 导航模型对齐规范（P4 修订）

反馈「ontology 建模效果不理想」。核对 `../ossie/ontology/ontology.md` 后确认：规范用
`ontology → concept → relationships` 的层级表示，「relationship 是 concept 下的关键字」，
关系按**第一角色所在 concept** 分组。原左侧导航把概念与关系并列为两个顶层入口，与规范不符。

**改动（仅导航层，渲染与表单逻辑不变）**

- `frontend/src/pages/OntologyTab.tsx`
  - 左侧改为纯 concept 导航，并按 ConceptType 分组：`实体 · EntityType` / `值类型 · ValueType`。
  - **移除左侧「新建关系」入口**；关系归入「所属 concept」之下管理：
    选中概念后，右侧面板在概念表单下方列出「该概念的关系」，并提供 `+ 新建关系`
    （owner 即当前概念）。
  - 新建 concept 改为**弹窗**（名称 / 类型 / extends），带重名校验与类型约束提示；
    值类型必须继承内置值类型，创建时默认 `String`。
  - 编辑关系时提供「← 返回所属概念」；画布交互（选中节点/边/hub）保持不变。
- 新增 `frontend/src/components/Modal.tsx`：可复用弹窗壳。
- `frontend/src/styles.css`：concept 分组标题、关系区块、返回链接、弹窗标题/操作区样式。

**验证**：`npm run build` 通过；`cargo test` 全绿（后端未改动）。

## 2026-09-21 — Ontology 建模语义对齐（P4 首轮）

依据 `docs/design/design-ouline.md` §4 与 `docs/design/roadmap.md` P4，把此前「demo 已定义、
未产品化」的 ontology 关系语义落到代码：新增关系语义引擎，补齐校验规则，并按渲染规范重写画布。

**后端**

- 新增 `src/ontology.rs`：关系语义引擎（纯函数）
  - `Arity`（unary / binary / n-ary）判定：`arity = 1 + roles.len()`，owner 即第一角色。
  - multiplicity 适用性：一元的 multiplicity 无意义；`OneToOne` 仅二元；多对多留空。
  - 降格四条件（`demote_blockers`）：代理键 / 仅对外 ManyToOne / 无属性 / 不被其他关系引用。
  - 等价归一化提示（`normalization_hints`）：二元→Boolean ⇄ 一元；纯连接实体可折叠为 n 元。
  - 单元测试 5 例。
- `src/validation.rs`：新增 §4.2 校验
  - 一元关系带 multiplicity → **error**；
  - n 元关系标 `OneToOne` → **error**（OneToOne 仅二元）；
  - 二元关系未标 multiplicity → **warning**（多对多请留空）；
  - `identify_by` 指向的关系必须二元 → **error**；
  - 接入 `normalization_hints`（§4.5 等价归一化提示，warning 不阻断提交）。
  - 新增单元测试 4 例。
- `src/lib.rs`：注册 `pub mod ontology;`。

**前端**

- `frontend/src/pages/OntologyTab.tsx`：按 §4.1 渲染规范重写
  - 二元关系 → 有向边（owner → 另一端），标签为关系名；multiplicity 以 chip 标在**箭头端**（`1` / `1:1`）。
  - unary → 节点徽章 ⚑；n 元 → 虚线菱形虚拟实体 hub，腿按 `#1..#n` 编号，被决定角色标 ★。
  - 自环标角色名；平行边标全名；`identify_by` 节点标 🔑。
  - EntityType 大节点实线 / ValueType 小节点浅色，并提供「显示值类型」整体开关。
- `frontend/src/components/forms.tsx`：关系编辑器按 §4.2 约束
  - multiplicity 选项随 arity 变化（一元禁用、n 元仅 ManyToOne、二元含 OneToOne）。
  - 换 owner（声明侧）时弹警告：约束方向随之反转。
  - roles 支持 ↑/↓ 有序编辑，并提示「顺序即语义」。
- `frontend/src/styles.css`：新增 entity/value 分级、hub 菱形、edge-label / edge-mult、canvas-toggle 样式。

**未覆盖（仍属 P4）**：升格/降格的重构操作与引用迁移、名词测试向导、derived_by/requires
点 join 校验、Mapping 与 OntologyMap 导出、萃取 concept。

## 2026-09-21 — 协作约定与设计文档沉淀

- 新增 `AGENTS.md`：项目定位、权威参考（同级 `../ossie`）、架构铁律、代码与验证约定。
- 新增 `docs/dev-plan/`：开发计划跟踪目录（本目录）。
