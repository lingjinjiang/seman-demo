# AGENTS.md — Ossie Studio 协作指南

本文件是本仓库的**唯一权威协作约定**，供所有在此仓库工作的工程/Agent 阅读并遵守。
凡与本文件冲突的临时指令，以用户当次明确指令为准；无明确指令时以本文件为准。

---

## 1. 项目定位

Ossie Studio 是构建在 [Apache Ossie (Incubating)](https://github.com/apache/ossie) 语义/本体规范之上的**建模平台**，目标演进为
「建模平台 + 语义查询编译 + Gravitino/Trino 执行 + LLM 问数」的完整问数平台（见 `docs/design/roadmap.md`）。

- **后端**：Rust + axum + sqlx（`Any` 驱动，SQLite / PostgreSQL 同一套 schema）。
- **前端**：React 18 + TypeScript + Vite + React Flow（`@xyflow/react`）。
- **版本控制**：自研轻量 VCS（表驱动分支/提交/工作区，快照树 + 三路合并）。
- **互操作**：OSSIE `0.2.0.dev0` 的 YAML / JSON 导入导出。

## 2. 权威参考（同级 `../ossie` 目录）

当前工程与 **Apache Ossie 官方仓库平级**，位于 `../ossie`。任何涉及「规范对齐」的实现，
**先查官方仓，再动手**，不要凭记忆或本仓注释臆测规范。

| 用途 | 路径（相对 `../ossie`） |
|------|--------------------------|
| 语义模型核心规范 | `core-spec/spec.md`、`core-spec/spec.yaml`、`core-spec/ossie-schema.json` |
| 表达式语言（列引用、聚合、时间函数） | `core-spec/expression_language.md` |
| 本体/关系规范（roles、multiplicity、identify_by、mappings） | `ontology/ontology.md`、`ontology/ontology.json` |
| 官方校验器（导出物验收基准） | `validation/validate.py` |
| 转换器参考模式（新增 exporter 时对标） | `converters/`（尤其 `converters/polaris`、`converters/dbt`） |

官方校验器用法（导出物必须零修改通过）：

```bash
python ../ossie/validation/validate.py examples/sample_model.yaml
python ../ossie/validation/validate.py <file> --schema ../ossie/ontology/ontology.json
```

## 3. 设计文档（本仓 `docs/design/`）

设计与分期以这两份文档为准，实现前**先读、定期回看**：

- `docs/design/design-ouline.md`：产品设计大纲（用户工作流、数据源控制、语义/本体建模细则）。
- `docs/design/roadmap.md`：技术选型与 P0–P5 分期、里程碑出口标准。

> 注意：这两份文档内部互相引用的旧路径（如 `ROADMAP.md`、`docs/design-outline.md`、`design/ontology-demo.html`）
> 与实际文件名不一致，实际文件以本节路径为准。

## 4. 仓库结构

```
src/            Rust 后端（lib name = ossie_studio）
  model.rs        工件常量 + 持久化行 + Snapshot 类型（kind:key -> artifact）
  validation.rs   引用完整性 / 枚举 / 继承链 / identify_by 校验
  ontology.rs     关系语义引擎（arity、multiplicity 适用性、降格条件、归一化提示）
  platform.rs     平台对象：租户 / PostgreSQL 数据源 / 按租户设置
  release.rs      版本发布（commit × 环境 的不可变指针）+ 发布台账
  vcs.rs          分支、提交、diff、reset、三路 merge
  ddl.rs          纯函数生成 PostgreSQL DDL（datatype -> PG 类型映射）
  export.rs       OSSIE YAML/JSON 双向（OSSIE_VERSION 常量在此）
  api.rs          axum REST 路由（全量 CRUD + 错误类型 ApiError）
  db.rs           连接与 schema 初始化（sqlx Any）
  main.rs         启动入口（DATABASE_URL / PORT 环境变量）
frontend/src/
  App.tsx         挂载壳（渲染 Studio）
  pages/          Studio（壳：侧边导航 + 顶栏 + 路由）
                  OverviewPage / OntologyPage / SemanticPage /
                  DataSourcesPage / SettingsPage
  components/     forms.tsx（表单）、ui.tsx（PageHeader/Tabs/DataTable）、
                  Modal.tsx、OntologyGraph.tsx（规范画布）、
                  VersionBar.tsx（版本条：提交/历史/分支/发布，内嵌建模页）
  styles.css      浅色主题设计系统（设计令牌 + 布局 + 组件样式）
tests/          integration.rs，内存 SQLite 全链路
examples/       sample_model.yaml（导入导出样例）
docs/design/    设计大纲与 roadmap
docs/dev-plan/  开发计划跟踪（milestones.md 状态表 + changelog.md 变更记录）
```

前端信息架构：左侧按大功能分组的导航（工作区 / 建模 / 平台），右侧为具体功能页；
内容管理以**表格优先**，本体与语义模型另提供图谱与 Raw 预览。

## 5. 常用命令

```bash
# 后端（默认 SQLite: ossie.db，监听 127.0.0.1:8080，自动建库）
cargo run
cargo test            # 全部跑在内存 SQLite 上，无需外部数据库
cargo check --all-targets

# 前端
cd frontend && npm install
npm run dev           # vite dev，代理 /api -> 127.0.0.1:8080
npm run build         # tsc && vite build，产物供后端 ServeDir 托管
```

存储配置：`DATABASE_URL=sqlite:ossie.db`（默认）或 `DATABASE_URL=postgres://user:pass@host:5432/db`；端口 `PORT=8080`。

## 6. 架构铁律（所有功能决策的裁判，改前必读）

以下来自 `docs/design/design-ouline.md` 的「三条铁律」与依赖结构，是**不可违反**的边界：

1. **数据语义层为体，业务本体为用**：semantic model 是唯一必需层、建模主战场；ontology 是 ROI 触发条件下的增强，永不做前置门槛。
2. **环境令牌不进模型**：`source` 只写逻辑名（如 `sales.public.orders`）。**禁止** host / 端口 / `gravitino://` / metalake 等环境令牌进入 OSSIE 文档——定位信息只存在于环境绑定表（平台资产，不进导出物）。
3. **承诺面 = 背锅面**：导出向导须先分流环境类型；「导出即用」只绑定平台托管环境，外部环境交付的是「交接包 + 验收工具」。

依赖链（决定一切顺序问题）：

```
metric -> field -> dataset -> source(逻辑名) -> 环境绑定表 -> catalog/物理库
ontology -(OntologyMap/mapping, 单向)-> dataset/field
```

其它必须保持的实现纪律：

- **编译器为纯函数**：如 `ddl.rs`，新增查询编译器同样 `(Snapshot, IR, dialect) -> SQL + 诊断`；**LLM 永不直出 SQL**，只产出语义查询 IR。
- **校验三层**：层1 结构校验（离线永远跑）；层2 存在性校验（register 触发）；层3 执行校验（deploy/EXPLAIN 硬门禁）。
- **dataset 状态机**：📝未绑定 → 🔗已关联 → ✅已验证 → 🚀已部署。
- **一份文档 = 一个语义模型**，无跨模型引用（spec.md）。
- **关系不是与概念平级的一等对象**：按 ontology 规范，关系归属于「第一角色」所在的概念
  （artifact key 形如 `Concept.relationship`，UI 中只能在概念详情内创建/编辑，不做顶层关系入口）。
- **版本以仓库为粒度，且是能力不是独立功能**：本体与语义模型同属一份 OSSIE 文档、存在单向依赖，
  因此同版本演进（不做按 section 的独立版本）；提交/历史/分支/发布内嵌在本体与语义模型页共用，
  不占顶层导航（design-ouline §1.5）。
- **开发态与应用态分离**：工作区 draft → commit → **release（commit × 环境）**；
  消费方（问数 / Agent / BI / 开放 API）**只读已发布快照**，永不读 working tree 或任意分支。
  发布是追加式不可变记录，回滚 = 重新发布历史 commit（不重写历史）。
- **不做全量 catalog 导入**：语义模型是精选视图（curated view），导入永远是多选式。
- **导出物永远可被官方 `validate.py` 零修改通过**；私有语义只进 `custom_extensions`。
- **反模式（明确不做）**：重型语义层引擎（Cube/MetricFlow）；`gravitino://` 坐标进 `source`。

## 7. 代码约定

- **Rust**：edition 2021；模块平铺在 `src/`，新模块在 `src/lib.rs` 注册 `pub mod`。
- **序列化**：API/持久化层统一 `#[serde(rename_all = "camelCase")]`，前端类型（`frontend/src/types.ts`）与之后端字段一一对齐。
- **工件 kind**：`concept` / `ontology_relationship` / `dataset` / `semantic_relationship` / `metric`；key 形如 `kind:key`，关系 key 形如 `Concept.relationship`（owner 为第一角色）。
- **枚举对照规范**：`CONCEPT_TYPES` / `MULTIPLICITIES` / `DIALECTS` / `DATA_TYPES` 等常量须与 `../ossie` 规范逐项一致；`DIALECTS` 目前落后于 spec 全量（缺 `SIGMA`/`THOUGHTSPOT`/`DAX`，属 P0 待补）。
- **版本常量**：OSSIE 版本只通过 `export.rs::OSSIE_VERSION` 引用，不散落字面量。
- **错误处理**：REST 层统一走 `api.rs::ApiError`；有校验错误的快照不可提交。
- **前端**：函数组件 + TS；新增页面放 `frontend/src/pages/`，共享表单控件放 `components/`。

## 8. 文档与语言约定

- 面向用户的文档、设计文档、提交说明使用**中文**；代码标识符、注释片段、命令保持英文。
- 涉及规范条目时**引用来源**（如 `spec.md:87-91`、`ontology/ontology.md` 章节），便于核对。
- 改动若偏离 `docs/design/roadmap.md` 的分期计划，需在说明中显式指出并给出理由。

## 9. 验证与交付

- 提交前至少跑：`cargo test`（全绿）+ `cargo check --all-targets`；改前端则加 `cd frontend && npm run build`。
- 涉及导入导出/工件结构的改动，用 `examples/sample_model.yaml` 做 round-trip，并对齐官方 `validate.py`。
- 只做**最小、聚焦**的改动；不顺手重构无关代码；保留工作区中他人已有的改动。
