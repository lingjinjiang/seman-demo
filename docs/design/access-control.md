# 资源模型与权限模型（Access Control）

> 讨论稿。回答两个连着的问题：**租户 / 项目 / 本体 / 语义模型 / 数据源之间到底是什么关系**，
> 以及在此基础上**权限该怎么设**。
> 相关：`design-ouline.md` §1.5（版本与发布边界）、§2.6（身份三层与下沉红线）；`roadmap.md` P5。

---

## 0. 先说结论

1. **术语已统一为「项目 Project」**（✅ 已落地）：代码里的 `repos` / `repo_id` 已全部更名为
   `projects` / `project_id`，API 为 `/api/projects`，UI 文案统一为「项目」。
   **一个项目 = 一份 OSSIE 文档 = 一个语义模型**。旧库由 `db.rs` 的 `RENAME_MIGRATIONS` 自动迁移
   （已验证：`repos → projects`、各表 `repo_id → project_id`，数据无损）。
2. **本体与语义模型不是资源，是同一份文档的两个 section**。它们不是能各自授权、各自版本的对象，
   而是**同一个模型的两个视图**。权限与版本都落在「项目」这一层。
3. **权限只挂在两个层级**：租户（平台资产）与项目（模型资产）。**不引入第三层**（见 §3.4 取舍）。
4. **权限信息永远不进 OSSIE 文档**。这是「环境令牌不进模型」的推广：
   成员、角色、环境、凭证、行列级策略都是平台侧数据。理由见 §2.1（Ossie 官方立场）。
5. **发布是权限模型里最危险的动作**，因此单独设门禁：
   「能改模型」≠「能发布到 prod」。这一条与 §1.5 的开发态/应用态分离是同一件事的两面。
6. **用户与授权管理暂缓**（✅ 本轮决定）：成员、角色、鉴权中间件**暂时不做**，
   当前仍以 `tenant_id` 过滤维持单租户可用；但 §4 的模型与 §6 的分期作为后续实现的依据保留。

---

## 1. 现状盘点：混乱从哪来

| 层 | 现在叫什么 | 问题 |
|---|---|---|
| 代码/DB | `tenants` / `repos` / `data_sources` / `settings` / `releases` | `repos` 是 git 语汇，不是业务语汇 |
| UI | 「工作台」「模型仓库」「新建模型仓库」 | 同一个东西一会儿是仓库一会儿是项目 |
| 设计文档 | 「场景」「一份文档 = 一个语义模型」 | 「场景」没有对应到任何表 |
| 权限 | **完全没有** | 租户只是 `tenant_id` 过滤，没有成员、角色、鉴权 |

结论：**先在词汇上对齐，再谈权限**。当前 `tenant_id` 过滤不是权限模型，
它只解决了"数据不串"，没有解决"谁能做什么"。

---

## 2. 参考：别人怎么切

### 2.1 Apache Ossie —— 规范有意不管权限

这是最重要的一条，因为它决定了我们的边界放在哪：

- `core-spec/spec.md` 与 `ontology/ontology.md` 里**没有任何** owner / tenant / permission 字段，
  文档是纯粹的可携带元数据。
- Ossie `ROADMAP.md` 把 **"Discovery, versioning, and access control for Ossie models"**
  列在 *Catalog Integration & Semantic Services* 之下 —— **访问控制被明确划给平台/目录，而不是文档**。
- `docs/index.md` Phase 4「Govern」的第一条是 *"Establish ownership: Define who owns each
  semantic model and who is responsible for approving changes"*，并建议把模型放进版本控制。

⇒ 我们做的是**规范留白的那一层**：归属、版本、权限。同时必须守住可携带性：
**加权限不能污染文档**，否则导出物过不了官方 `validate.py`，也失去互操作意义。

### 2.2 Palantir Foundry —— 两条正交的轴

Foundry 的模型最值得借鉴的是**把"资源层级 RBAC"和"数据级强制控制"分成两条正交的轴**：

| 轴 | 机制 | 特征 |
|---|---|---|
| 资源层级 | Organization → **Project** → 资源；项目上授予 Viewer / Editor / Owner，向下继承 | 可授权、可继承、由所有者管理 |
| 数据级强制控制 | **Markings / Classifications**（强制访问控制）、Restricted Views（行/列级） | **不可被项目角色覆盖**，只收紧不放宽 |

另外两条值得抄：

- **Ontology 是 enrollment 级（租户级）的受治理层，不属于某个项目**；项目里放的是喂给它的数据。
  ⚠️ 这一条我们**不能照抄**：OSSIE 规定本体与语义模型同在一份文档里、无跨模型引用，
  所以我们的本体天然是项目级的。这是有意识的偏离，需要在文档里写明理由。
- **审批/usecase 化的访问**：敏感动作（如发布到生产）走显式审批，而不是"有编辑权就能干"。

### 2.3 阿里云 —— 账号体系与数据平台分层

- **RAM**：主账号 → RAM 用户/角色/用户组，权限以策略（Policy）形式绑定，策略 = 资源 × 操作；
  另有**资源组**做粗粒度归组。
- **数据平台侧**（DataWorks / MaxCompute 一类）：**工作空间**是协作与权限单元（管理员/开发/运维/访客），
  平台内部再有自己的项目空间、角色与 ACL，敏感数据另有**标签级安全**做列级控制。

对我们的启示：**身份（谁能登录）** 与 **授权（能对哪些资源做什么）** 要分开；
而且**平台资产（连接、环境）与模型资产（项目）分属不同的授权面**。

### 2.4 开源项目里最值得抄的四个

| 项目 | 抄什么 | 映射到我们 |
|---|---|---|
| **Kubernetes** | `(subject, verb, resource, namespace)` 四元组；RoleBinding 把主体绑到角色 | 我们的「主体 × 动作 × 资源 × 租户/项目」 |
| **GitLab** | Group → Project + 角色（Guest→Owner）；**Protected Branches / Protected Environments** 单独管"谁能推主干/谁能部署生产" | **谁能发布到 prod 单独设门禁** |
| **dbt Cloud** | Account → Project → **Environment**；环境自带权限，prod 与 dev 分开 | 我们已有环境概念，正好挂发布权限 |
| **OpenMetadata / DataHub** | Policy = 资源 × 操作 × 规则；外加 **Domain / Data Product** 做跨资产归组与归属 | 将来的「域标签」（design-outline §3.2）与跨项目共享 |

> 注：以上为设计模式的归纳，具体产品的最新形态请以官方文档为准。

---

## 3. 我们的资源模型（建议）

### 3.1 一张图

```
租户 Tenant ─────────────────────────── 隔离边界（组织 / 身份 / 计费 / 数据驻留）
│  成员与角色 Members & Roles
│  环境 Environment            dev / test / prod      ┐ 租户级平台资产
│  数据源 DataSource           连接坐标 + 凭证         ┘ （不进模型文档）
│
└── 项目 Project ───────────────────── 协作 + 权限 + 版本 + 发布边界
    │  = 一份 OSSIE 文档 = 一个语义模型（代码里叫 repo）
    │  成员与角色 Members & Roles（项目级）
    │
    ├── 本体 Ontology        ┐ 同一份文档的两个 section
    ├── 语义模型 Semantic    ┘ 是两个「视图」，不是两个可授权的资源
    ├── 版本 Branches / Commits        （§1.5）
    └── 发布 Releases        commit × 环境 → 消费方只读（§1.5）
```

### 3.2 术语表（建议口径）

| 术语 | 英文 | 是什么 | 不是什么 |
|---|---|---|---|
| 租户 | Tenant | 隔离边界；拥有成员、环境、数据源 | 不是项目分组 |
| 项目 | Project | **一份 OSSIE 文档**；协作与权限单元；版本与发布的粒度 | 不是文件夹（不装多个模型，见 §3.4） |
| 本体 | Ontology | 项目内 `ontology` section 的**编辑视图** | 不是独立资源、不能单独授权 |
| 语义模型 | Semantic Model | 项目内 `semantic_model` section 的**编辑视图** | 同上 |
| 数据源 | Data Source | 租户级连接资产（当前仅 PostgreSQL） | 不属于任何项目；不进文档 |
| 环境 | Environment | dev / test / prod，发布的目标 | 不是运行实例，是发布指针的目标 |
| 发布 | Release | `commit × 环境` 的不可变指针 | 不重写历史；回滚=重发旧提交 |

### 3.3 为什么不把「本体」当独立资源

Palantir 可以，我们不行：OSSIE 规定**一份文档 = 一个语义模型、无跨模型引用**，
本体与语义模型存在单向依赖（ontology → mapping → dataset）。
把本体拆成独立可授权/可版本化的资源，会立刻产生「本体已发布、语义模型还是旧的」这类悬空状态。

**结论：本体与语义模型是同一个项目的两个视图；权限、版本、发布都落在项目层。**
它们在 UI 上是两个导航项，在权限上是同一个对象。

### 3.4 取舍：要不要引入第三层「项目组 / 域」

设计文档 §3.4 提到过「大底座 + N 个场景模型」和跨模型共享维度。那是否意味着需要
「租户 → 项目组 → 项目」三层？

**建议：现在不引入。** 理由：

1. 版本与发布已经是项目粒度，再加一层会立刻出现"项目组权限 vs 项目权限"两套规则；
2. 目前没有"多个项目共享同一批成员"的真实需求，**没有需求的层级只会变成负担**；
3. 横向归组的需求（域标签、共享维度）本质上属于**治理元数据**，用 OpenMetadata/DataHub 式的
   **Domain / Tag** 挂上去更轻，不必是权限层级。

**保留演进路径**：真出现"N 个模型共享一批人 + 统一发布窗口"时，再加「项目组」，
届时它只需是一个可继承的角色绑定节点，不影响现有模型。

---

## 4. 权限模型（建议）

### 4.1 主体 × 动作 × 资源

```
主体 Subject   = 用户 User | 用户组 Group | 服务账号 ServiceAccount
资源 Resource  = 租户 | 项目 | 数据源 | 环境 | 发布 | 设置
动作 Action    = view | edit | delete | publish | use | admin
```

判定写成四元组（照 Kubernetes 的形状）：

```
can(subject, action, resource, scope?)   scope = 租户 或 项目
```

### 4.2 租户级角色（管平台资产）

| 角色 | 能力 |
|---|---|
| **租户管理员 TenantAdmin** | 管理成员与角色、数据源、环境、设置；可发布任意项目到任意环境 |
| **成员 Member** | 创建项目；对**自己是成员的项目**行使项目角色；看不到未加入项目的内容 |
| **只读访客 Guest** | 只读已发布版本（消费侧） |

> 角色名刻意与 GitLab / dbt Cloud 对齐，降低学习成本。

### 4.3 项目级角色（管模型）

| 角色 | 看模型 | 改模型/提交 | 发布 dev·test | 发布 prod | 管成员/删除项目 |
|---|:--:|:--:|:--:|:--:|:--:|
| **查看者 Viewer** | ✅ | | | | |
| **编辑者 Editor** | ✅ | ✅ | | | |
| **发布者 Publisher** | ✅ | ✅ | ✅ | | |
| **所有者 Owner** | ✅ | ✅ | ✅ | ✅（可配审批） | ✅ |

**为什么把 Publisher 单列**：这是整个模型里唯一"会影响正在被消费的东西"的动作。
GitLab 用 Protected Environment、dbt Cloud 用 environment 权限解决同一问题。
我们的等价物是 §1.5 的 `release`。

### 4.4 环境门禁（发布闸门）

角色之外再挂一层按环境的规则，默认建议：

```
dev   ← 编辑者及以上即可发布（联调自由）
test  ← 发布者及以上
prod  ← 仅所有者；可选「需要审批 N 人」（对应 Palantir 的审批式访问）
```

这与 §2.2 环境定义、§1.4 承诺分流是同一套对象，不新增概念。

### 4.5 数据源：可见 ≠ 可用

数据源是租户级资产且**含凭证**，因此拆成两个动作：

- `use`：可作为部署/查询目标被引用（编辑者及以上）；
- `admin`：可查看/修改坐标与凭证（仅租户管理员）。

这与我们已经做的**密码脱敏**（API 不回显 `password`）是同一条原则的延伸：
**凭证只进不出**。

### 4.6 消费方：只读已发布版本

问数 / Agent / BI 不走用户身份，而是**服务账号 + API Key**，作用域限定为：

```
scope = release:read  project:<id>  environment:prod
```

即"只能读某个项目发布到 prod 的那一份快照"。这与 §1.5「消费方只读已发布版本」严格对齐：
**权限边界与发布边界是同一条线**。

---

## 5. 三条不变量

1. **权限不进文档**：成员、角色、环境、凭证、行列策略都不写进 OSSIE 文档；
   导出物必须继续能过官方 `validate.py`。（推广自「环境令牌不进模型」）
2. **发布是消费侧的唯一边界**：`view` 可以看草稿，但**任何消费方（含 API Key）只能读 release**。
3. **默认最小可见**：新成员默认看不到任何项目；加入项目才可见；跨项目不继承任何权限。

---

## 6. 落地路径

### 6.1 数据模型增量

```
tenant_members   (tenant_id, subject_type, subject_id, role, created_at)
project_members  (project_id, subject_type, subject_id, role, created_at)
env_policies     (project_id, environment, min_role, approvers_json, updated_at)
api_keys         (id, tenant_id, name, scope_json, hashed_key, created_at, revoked_at)
users            (id, tenant_id, email, display_name, status)   -- 接入 OIDC 后由 IdP 供数
audit_log        (id, tenant_id, actor, action, resource, detail_json, created_at)
```

`repos` 无需改名（实现名），但 API 与 UI 对外统一用 **project**；
可在后端加一层 `project` 语义别名，避免以后大规模改表。

### 6.2 API 增量（草案）

```
GET/POST  /api/tenants/{id}/members
GET/POST  /api/projects/{id}/members
PUT       /api/projects/{id}/environments/{env}/policy
GET/POST  /api/api-keys            (创建后仅回显一次明文)
GET       /api/audit               (按资源/主体/时间过滤)
```

所有既有路由加一层 `authorize(subject, action, resource)` 中间件；
**未配置成员时保持当前行为**（单租户兼容），避免把已有部署锁死。

### 6.3 分期建议

| 阶段 | 内容 | 理由 |
|---|---|---|
| **S1 术语与边界** | 统一叫「项目」；明确本体/语义模型是视图；文档写清三级关系 | 零风险，先消除歧义 |
| **S2 发布门禁** | `releases` 加"谁能发布到哪个环境"；prod 需 Owner；API Key 只读 release | 直接补上当前最危险的空档 |
| **S3 完整 RBAC** | 成员表 + 角色 + 中间件 + 成员管理 UI + 审计日志 | 需要身份前置 |
| **S4 企业能力** | OIDC/Keycloak、用户组、服务账号、行列级策略（对齐 roadmap P5） | 客户信号触发 |

---

## 7. 已决策

| # | 议题 | 决策 | 状态 |
|---|------|------|------|
| 1 | 叫「项目」还是「语义模型」 | **项目 Project**；讨论术语时才说"一个项目就是一个语义模型" | ✅ 已落地（含表与 API 改名 + 旧库迁移） |
| 2 | `repos` 是否重命名为 `projects` | **重命名**：表、字段、API、UI 全链路统一 | ✅ 已落地 |
| 3 | 项目级是否保留 Publisher 独立一档 | **保留**（更好解释）；环境白名单作为可选细化 | ⏸ 待 S2 实现 |
| 4 | prod 发布是否需要审批流 | **先做"仅 Owner 可发布"**，审批流等真实合规需求 | ⏸ 待 S2 实现 |
| 5 | 用户 / 角色 / 鉴权中间件 | **暂时空着**，不实现；以 `tenant_id` 维持单租户可用 | ⏸ 本轮决定 |

> 尚未实现的部分（S2 发布门禁、S3 RBAC、S4 OIDC）在 `roadmap.md` P5 里跟踪，
> 本文件作为实现时的依据，不随实现进度改写。
