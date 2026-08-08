# Pi Fabric：源码运行机制解析

> 目标：从源码角度解释 [pi-fabric](https://github.com/monotykamary/pi-fabric) 到底是怎么工作的，而不只停留在 README 的功能介绍。

本文档基于 `pi-fabric` `main` 分支的一次源码快照进行分析：

- 源码仓库：[monotykamary/pi-fabric](https://github.com/monotykamary/pi-fabric)
- 分析时的 commit：[`08019b6138e90466d2b4ebd1acedd3d2523eb164`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164)
- 当时 `package.json` 版本：`0.40.3`
- Pi package 页面：[pi.dev/packages/pi-fabric](https://pi.dev/packages/pi-fabric)

## 一句话理解

Pi Fabric 并不是单纯给 Pi 增加几个工具。

它更像是在 Pi 里面增加了一层 **可编程的 Agent Runtime**：模型不再需要一次次直接调用 `read`、`grep`、`bash`、MCP 等工具，而可以先生成一段 TypeScript，让这段程序在隔离运行时中完成搜索、并行、过滤、循环、子 Agent 调度，最后只把结果返回给主模型。

```text
Main LLM
   │
   │ fabric_exec({ code })
   ▼
TypeScript check / transpile
   │
   ▼
QuickJS sandbox
   │
   │ JSON host bridge
   ▼
ActionRegistry
   ├─ pi.*
   ├─ mcp.*
   ├─ extensions.*
   ├─ agents.* ──► Agent / Actor / RLM
   ├─ mesh.*   ──► Topics / State / Topology
   ├─ compact.*
   ├─ memory.*
   ├─ state.*
   └─ schema.*
```

这个架构带来的核心变化是：

1. **把多次 Tool Call 变成一次 Program Call**。
2. **让中间数据留在 sandbox，而不是不断进入主模型 context**。
3. **让并行、条件、循环由程序完成，而不是靠 LLM 一轮一轮决定**。
4. **把 MCP、Pi tools、extension tools、sub-agent 统一到同一套调用协议中**。
5. **在同一个 runtime 上继续构建 RLM、Workflow、Actor、Mesh、Compaction 等能力**。

但这里有一个很重要的边界：

> Fabric 并不会消灭真正需要 LLM 语义判断的步骤。它主要省掉的是那些本来可以由确定性程序控制流完成、却让主模型每一步都重新充当调度器的往返。

例如 `grep → 根据命中路径 read → filter → return` 可以完全留在一个 TypeScript program 中；而“这 20 个实现里哪个最可疑”仍然需要主 LLM、child agent 或 RLM 做语义判断。详细见 [context-economy.md](./context-economy.md)。

## 推荐阅读顺序

如果想从核心运行链路一路读到更高级能力，建议按下面顺序：

1. [architecture.md](./architecture.md) — 整体架构和模块职责
2. [runtime-flow.md](./runtime-flow.md) — 一次 `fabric_exec` 从模型到工具再返回的完整执行链路
3. [context-economy.md](./context-economy.md) — 中间态、`return`、Prompt/TypeScript/Runtime 三层约束，以及为什么能减少 LLM↔Tool 往返
4. [rlm-and-agents.md](./rlm-and-agents.md) — RLM、Agent、Council、Workflow 到底是怎么实现的
5. [actors-and-mesh.md](./actors-and-mesh.md) — persistent Actor、Mesh、Participant Directory、ControlPlane、durable residency
6. [compaction.md](./compaction.md) — deterministic compaction、programmatic compaction 与 context lifecycle
7. [comparison.md](./comparison.md) — Fabric vs Python / MCP / LangGraph / RLM
8. [benchmarks.md](./benchmarks.md) — 如何验证速度、Token、Context 与任务质量，及上游已有 benchmark harness
9. [references.md](./references.md) — 关键源码入口与相关背景资料

## 文档地图

| 文档 | 核心问题 |
|---|---|
| [architecture.md](./architecture.md) | Fabric 从整体上分成哪些层？ |
| [runtime-flow.md](./runtime-flow.md) | 一次 `fabric_exec` 到底经过哪些函数和 runtime？ |
| [context-economy.md](./context-economy.md) | 为什么多个 tool call 可以留在一次 program 中？中间结果去哪了？ |
| [rlm-and-agents.md](./rlm-and-agents.md) | Recursive Agent / RLM / Council / Workflow 在源码里是什么？ |
| [actors-and-mesh.md](./actors-and-mesh.md) | 长期 Actor 如何保存 context？多个 participant 怎么跨 session 协调？ |
| [compaction.md](./compaction.md) | 长对话越来越大以后，Fabric 怎么重建 active context？ |
| [comparison.md](./comparison.md) | Fabric 和直接写脚本、MCP、LangGraph、RLM 到底是不是同类？ |
| [benchmarks.md](./benchmarks.md) | 如何证明 Fabric 真的更快/更省，而不是只靠架构推断？ |
| [references.md](./references.md) | 源码、官方文档和论文从哪里继续追？ |

## 最重要的源码入口

### Programmatic Runtime

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/index.ts) | Pi extension 入口、生命周期、compaction hook |
| [`src/fabric-exec-tool.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-tool.ts) | `fabric_exec` ToolDefinition、prompt guidance、最终 result |
| [`skills/fabric-exec/SKILL.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/skills/fabric-exec/SKILL.md) | 模型侧 Fabric API / Read economy / return 约定 |
| [`src/execution-service.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/execution-service.ts) | 真正的执行编排核心 |
| [`src/runtime/guest-types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/guest-types.ts) | Guest program 可见的 TypeScript declarations |
| [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts) | QuickJS sandbox、Host Bridge、guest globals |
| [`src/core/action-registry.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/action-registry.ts) | Provider/action 的发现、校验、审批、调用、审计 |

### Agent / Actor / Mesh

| 文件 | 作用 |
|---|---|
| [`src/agents/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/manager.ts) | Child Agent lifecycle |
| [`src/actors/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/actors/manager.ts) | Persistent Actor、mailbox、activation、session |
| [`src/mesh/store.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/mesh/store.ts) | Durable topics 与 versioned shared state |
| [`src/topology/participant-directory.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/participant-directory.ts) | Root / Agent / Actor 的统一 participant directory |
| [`src/topology/control-plane.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/control-plane.ts) | 跨 host steer/followUp/stop + ACK |

### Compaction

| 文件 | 作用 |
|---|---|
| [`src/compaction/hook.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/hook.ts) | Deterministic compaction、cut、token budget |
| [`src/core/compact-controller.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/compact-controller.ts) | Advisory → committed programmatic compaction |
| [`src/providers/compact-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/compact-provider.ts) | `compact.request/status/cancel` |

## 一个最小心智模型

如果只记住一个执行流程，可以记这个：

```text
LLM
 │
 │ 生成 TypeScript
 ▼
fabric_exec
 │
 ▼
FabricExecutionService
 │
 ├─ TypeScript checker
 │
 ▼
QuickJS
 │
 │ __fabricHostCall(ref, args)
 ▼
ActionRegistry
 │
 ├─ validate
 ├─ approve
 ├─ audit
 └─ provider.invoke()
       │
       ├─ Pi tool
       ├─ MCP
       ├─ Agent / Actor
       ├─ Mesh
       └─ Compact

最终 value
   │
   ▼
主 LLM context
```

换句话说，`fabric_exec` 只是入口，真正构成 Fabric 的是：

> **Prompt Guidance + TypeScript Guest API + QuickJS Runtime + JSON Host Bridge + Action Registry + Provider System + Agent/Context Runtime**

其中：

```text
Prompt Guidance
  → 教模型怎么组织程序、Search before read、compact return

TypeScript declarations
  → 告诉模型 pi.read / pi.grep / agents.run 等 API 的签名和返回形状

Runtime
  → 真正提供 API，并负责 validate / approval / audit / timeout / execution
```

所以“哪些文件相关、读多少、最后 return 什么”通常仍然是模型生成的 TypeScript 决定；Fabric 提供的是让这种动态控制流可靠运行的环境，而不是内置一个自动判断相关文件的算法。

## 本专题维护约定

后续更新 `pi-fabric/` 时，不只修改具体分析正文，还要同步检查：

- 本 `README.md` 的推荐阅读顺序和核心结论是否仍然准确；
- 新增、删除或重命名文档后，目录导航是否同步；
- `references.md` 是否需要补充新的源码入口、commit、论文或官方资料；
- 如果新增内容会改变仓库级 Topics 或专题简介，是否需要同步更新根目录 [`README.md`](../README.md)。

如果上游 `pi-fabric` 发生较大变化，优先保留具体 commit 引用，并明确区分“当前实现”和“历史快照”，避免旧结论被新的 `main` 分支覆盖掉。

---

后续如果源码变化较大，建议以具体 commit 链接为准，而不是只看 `main`。