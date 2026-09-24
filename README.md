# Ossie Studio

基于 [Apache Ossie (Incubating)](https://github.com/apache/ossie) 的建模平台。

- 按 **ontology** 规范创建实体（Concept：`EntityType` / `ValueType`）与关系（roles、multiplicity、verbalizes、identify_by、requires、derived_by），提供 ER 画布建模。
- 按 **semantic** 规范配置数据集、字段、关系、度量，并可一键接入 PostgreSQL 生成/部署语义层（表 + 主键/唯一键/外键 + 度量元数据）。
- 建模过程内置 **git 式版本控制**：分支、提交、log、diff（含 `HEAD~N`）、reset、三路 merge。
- 支持与 Ossie 规范互操作的 **YAML / JSON 导入导出**。
- 存储同时兼容 **SQLite 与 PostgreSQL**（同一套表结构），默认 SQLite，测试全部跑在内存 SQLite 上。

## 技术栈

| 层 | 选型 |
|----|------|
| 后端 | Rust + axum + sqlx（Any 驱动：SQLite / PostgreSQL） |
| 前端 | React 18 + TypeScript + Vite + React Flow（@xyflow/react） |
| 版本控制 | 自研轻量 VCS（表驱动：branches / commits / working_trees，快照树 + 三路合并） |

## 快速开始

```bash
# 后端（默认 SQLite: ossie.db，监听 127.0.0.1:8080，自动建库）
cargo run

# 前端开发模式（另开终端，代理 /api -> 8080）
cd frontend && npm install && npm run dev
# 打开 http://localhost:5173

# 生产模式：后端直接托管 frontend/dist（先 npm run build）
cd frontend && npm run build
cd .. && cargo run
# 打开 http://127.0.0.1:8080
```

### 存储配置

```bash
# SQLite（默认，文件自动创建）
DATABASE_URL=sqlite:ossie.db

# PostgreSQL（同一套 schema，启动时自动初始化表结构）
DATABASE_URL=postgres://user:pass@localhost:5432/ossie

# 端口
PORT=8080
```

> 说明：语义层部署目标是另一个 PostgreSQL 连接串（见下），与应用自身存储无关。

### 测试

```bash
cargo test   # 全部跑在内存 SQLite 上，无需外部数据库
```

## 功能

### Ontology 建模

本体页**以概念表为主**，新建与编辑走弹窗；**关系归属于声明它的概念**（进入概念详情查看与编辑），
另提供图谱与 Raw 视图。图谱按 ontology 规范渲染（二元有向边、箭头端 multiplicity、一元徽章、
n 元虚拟实体 hub）：

- **实体/值类型**：`type`、`extends`（值类型必须传递地继承内置值类型）、`identify_by`、`requires`、`derived_by`、`description`。
- **关系**：key 形如 `Person.earns`（owner 即第一角色），支持一元/二元/多元、`roles`（同概念多角色必须用 `name` 区分）、`multiplicity`（`ManyToOne`/`OneToOne`）、`verbalizes`。
- 画布中实体为蓝色、值类型为绿色，关系为带箭头的边，点击节点/连线即可编辑。
- 内置校验：概念/关系引用完整性、枚举合法性、值类型继承链、`identify_by` 指向、字段重名、关系列数量一致性等；有错误的快照无法提交。

### Semantic 语义层 + PostgreSQL 部署

- 数据集（`source`、`primary_key`、`unique_keys`、字段的 `datatype`/`is_time`/ANSI_SQL 表达式）、数据集关系（FK）、多方言度量。
- **预览 DDL**：纯函数生成 PostgreSQL DDL，本地即可查看。
- **部署**：提供 PostgreSQL 连接串与目标 schema，事务内执行：
  - 每个 dataset 建一张表（字段列 + 主键/唯一键 + 关系外键；未声明的引用列自动补 TEXT 列并给出校验警告）；
  - 度量写入 `ossie_metrics`（name/datatype/expression），供查询层消费；
  - 模型快照写入 `ossie_model`（自描述语义层）。

### Git 式版本控制

- 每个项目默认 `main` 分支 + 初始提交；工作区即当前分支的编辑快照。
- 支持：创建/切换/删除分支、提交（校验通过才允许）、历史、任意两个 ref 的 diff（`working` / `head` / 分支名 / 提交 id / `HEAD~N`）、硬重置、三路合并（找共同祖先，冲突时返回冲突工件列表，不落库）。
- diff 为工件级结构化变更（added/removed/modified）+ 行级 unified 文本。

### 导入导出

- 导出：`GET /api/projects/:id/export?format=yaml|json`，生成符合 Ossie `0.2.0.dev0` 的文档（`ontology` + `semantic_model` 两个 section，关系按概念分组）。
- 导入：`POST /api/projects/:id/import`，把嵌套的关系拆回工件写入工作区；`examples/sample_model.yaml` 是现成的示例。

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST/GET | `/api/projects` | 创建 / 列出项目 |
| GET/DELETE | `/api/projects/{id}` | 项目详情 / 删除 |
| GET/POST | `/api/projects/{id}/branches` | 分支列表 / 创建（`from` 支持 `default`、`branch:<名>`、`commit:<id>`） |
| POST/DELETE | `/api/projects/{id}/branches/{branch}` | 切换 / 删除分支 |
| GET | `/api/projects/{id}/working` | 工作区快照 + 校验问题 |
| GET/POST | `/api/projects/{id}/artifacts` | 工件列表 / 创建更新 |
| GET/PUT/DELETE | `/api/projects/{id}/artifacts/{kind}/{key}` | 单个工件 |
| GET/POST | `/api/projects/{id}/commits` | 历史 / 提交 |
| GET | `/api/projects/{id}/commits/{commit}` | 提交详情（含树） |
| GET | `/api/projects/{id}/diff?from=&to=` | 任意 ref 差异 |
| POST | `/api/projects/{id}/reset` | 硬重置当前分支 |
| POST | `/api/projects/{id}/merge` | 三路合并 |
| GET | `/api/projects/{id}/validate` | 校验当前工作区 |
| GET | `/api/projects/{id}/export` | 导出 Ossie YAML/JSON |
| POST | `/api/projects/{id}/import` | 导入 Ossie YAML/JSON |
| GET | `/api/projects/{id}/semantic/preview?schema=` | 生成语义层 DDL |
| POST | `/api/projects/{id}/semantic/deploy` | 部署语义层到 PostgreSQL |
| POST | `/api/projects/{id}/semantic/deploy-to-source` | 通过已注册数据源部署语义层 |
| GET/POST | `/api/tenants` | 租户列表 / 创建 |
| DELETE | `/api/tenants/{id}` | 删除租户（需先清空其项目） |
| GET/POST | `/api/data-sources?tenant=` | PostgreSQL 数据源列表 / 创建 |
| PUT/DELETE | `/api/data-sources/{id}` | 更新 / 删除数据源 |
| POST | `/api/data-sources/{id}/test` | 测试连接 |
| GET/PUT | `/api/settings?tenant=` | 按租户读取 / 写入设置 |
| GET/POST | `/api/projects/{id}/releases` | 发布记录列表 / 发布当前提交到环境 |
| DELETE | `/api/projects/{id}/releases/{releaseId}` | 删除发布记录（不删提交） |
| GET | `/api/projects/{id}/released?environment=` | **消费方只读**：该环境当前发布的 OSSIE 文档 |

工件 kind：`concept`、`ontology_relationship`、`dataset`、`semantic_relationship`、`metric`。

## 界面与平台能力

前端按商用建模工具的形态组织：**左侧按大功能分组的导航**，右侧为具体功能页，整体采用浅色主题。

- **项目概览**：租户下的项目列表（一份文档 = 一个语义模型），新建/打开/删除。
- **本体**：概念表（EntityType / ValueType、extends、identify_by、关系数）。**关系不与概念平级**——
  按 ontology 规范它归属于「第一角色」所在的概念，因此点开概念详情即可查看 / 编辑「该概念声明的
  关系」（关系名、元数、角色、多重性、verbalizes）。另提供**图谱**（二元有向边 + 箭头端
  multiplicity、一元节点徽章、n 元虚线 hub、identify_by 🔑）与 **Raw**（OSSIE YAML）视图。
- **语义模型**：数据集 / 关系 / 度量三张表，另有 **DDL / 部署**（可部署到已注册数据源）与 **Raw**。
- **版本与发布**（内嵌在本体 / 语义模型页顶部的版本条，非独立页面）：分支切换、未提交更改、
  提交、历史与 diff、导入导出；以及**发布**——把某个提交推送到 dev / test / prod。
- **数据源**：PostgreSQL 连接管理（坐标、默认 schema、连接测试）；**仅支持 PostgreSQL**。
- **设置**：默认提交作者、默认部署 schema、租户管理与切换、规范版本与存储信息。

**租户隔离**：项目、数据源、设置均按 `tenant_id` 隔离，同名项目可在不同租户下共存。
当前为应用层过滤，尚未接入鉴权/RBAC（见 roadmap P5）。

> 设计约束：环境令牌（host / 连接串 / metalake）只存在于数据源与设置中，**永不写入 OSSIE 文档**。

**开发态与应用态分离**：建模发生在工作区（draft）与分支上；发布（release）是
`提交 × 环境` 的不可变指针，**消费方只读已发布版本**——工作区里正在改的东西不会立刻影响使用。
回滚 = 把历史提交重新发布为一条新记录，历史永不重写。

```bash
# 消费方读取某环境当前发布的模型（唯一对外读取入口）
curl http://127.0.0.1:8080/api/projects/<projectId>/released?environment=prod
# 发布当前分支最新提交
curl -X POST http://127.0.0.1:8080/api/projects/<projectId>/releases \
  -H 'content-type: application/json' \
  -d '{"environment":"prod","message":"v1.2 新增订单域","author":"alice"}'
```

## 与 Apache Ossie 规范的对齐

- 版本对齐 `0.2.0.dev0`（core-spec 与 ontology 规范均为该版本）。
- 枚举完全照搬：`ConceptType`、`Multiplicity`、`Dialect`、`DataType`、内置概念。
- 语义模型的结构（datasets/relationships/metrics/custom_extensions）与官方 `spec.md`、`osi-schema.json` 一致；导出文档可直接与官方仓库的 `validation/validate.py` 对照。
- 关系分组约定（`Concept.relationship` 全名、owner 为第一角色）与 ontology 规范一致。
- 注意：ontology mappings（`ontology_mappings` / `concept_mappings`）与 expression language 尚未实现，属规划中。

## 开发计划跟踪

大方向（分期 P0–P5 与里程碑 M1–M6）由设计文档定义，逐项进度与改动记录放在
[`docs/dev-plan/`](docs/dev-plan/README.md)：

- 分期与技术选型：[`docs/design/roadmap.md`](docs/design/roadmap.md)
- 产品设计与建模细则：[`docs/design/design-ouline.md`](docs/design/design-ouline.md)
- 里程碑状态表：[`docs/dev-plan/milestones.md`](docs/dev-plan/milestones.md)
- 变更记录：[`docs/dev-plan/changelog.md`](docs/dev-plan/changelog.md)

| 里程碑 | 分期 | 大方向 | 状态 |
|--------|------|--------|------|
| M1 | P0 | 与 Ossie spec 基座对齐（枚举、source 逻辑名规则、官方校验 round-trip） | 进行中 |
| M2 | P1 | 语义查询编译器 + metric 驱动工作流（IR → SQL，扇出隔离） | 未开始 |
| M3 | P2 | 数据源控制 + Gravitino（环境绑定表、跨环境迁移演练） | 未开始 |
| M4 | P3 | LLM 问数 Agent（IR 契约、grounding 分层、护栏） | 未开始 |
| M5 | P4 | Ontology 关系语义 + Mapping（本轮已完成语义引擎/渲染/校验首轮） | 进行中 |
| M6 | P5 | 治理与生态（OIDC/RBAC/审计、metrics 开放 API） | 未开始 |

> 约定：**设计变更先改 `docs/design/`，进度变更改 `docs/dev-plan/`**；里程碑出口标准以
> `docs/design/roadmap.md` §5 为准。

## 当前限制与 Roadmap

- 合并是**工件级**三路合并（无行级冲突解决），冲突时给出冲突工件列表。
- DDL 部署为幂等建表（`IF NOT EXISTS`）+ upsert 元数据，不含破坏性迁移；重复部署安全。
- 尚无用户/权限/多租户；作者仅作为提交元数据。
- 规划：ontology mappings（逻辑层到本体层映射）、语义层反向同步（变更检测/迁移脚本）、行级冲突编辑、OIDC 登录、Ossie 官方 CLI 兼容。
