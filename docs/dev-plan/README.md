# 开发计划跟踪

本目录跟踪 Ossie Studio 的工程进度，与 `docs/design/roadmap.md`（分期定义）和
`docs/design/design-ouline.md`（设计与建模细则）配套使用：

- `milestones.md`：里程碑（M1–M6）与分期（P0–P5）状态表。
- `changelog.md`：按轮次记录已完成/进行中的改动。

> 约定：**设计变更先改 `docs/design/`，进度变更改本目录**。里程碑出口标准以
> `docs/design/roadmap.md` §5 为准，本目录只做状态跟踪，不重新定义标准。

## 如何使用

1. 开始一项工作前，在 `milestones.md` 找到对应里程碑，把状态改为「进行中」。
2. 完成后更新复选框与状态，并在 `changelog.md` 追加一条记录（日期 + 一句话 + 涉及文件）。
3. 若某轮改动偏离 roadmap 分期，需在 `changelog.md` 中显式说明理由。

## 状态图例

| 状态 | 含义 |
|------|------|
| 未开始 | 尚未动手 |
| 进行中 | 已部分落地，出口标准未达成 |
| 已完成 | 满足 roadmap 对应出口标准 |
| 阻塞 | 依赖外部信号（客户需求、上游 issue 等） |
