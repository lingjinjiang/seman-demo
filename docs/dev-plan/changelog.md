# 开发变更记录

按轮次倒序记录。每条包含：日期、范围、摘要、涉及文件。

---

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
