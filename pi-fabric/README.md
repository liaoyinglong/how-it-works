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
   ├─ agents.*
   ├─ mesh.*
   ├─ memory.*
   ├─ state.*
   └─ schema.*
```

这个架构带来的核心变化是：

1. **把多次 Tool Call 变成一次 Program Call**。
2. **让中间数据留在 sandbox，而不是不断进入主模型 context**。
3. **让并行、条件、循环由程序完成，而不是靠 LLM 一轮一轮决定**。
4. **把 MCP、Pi tools、extension tools、sub-agent 统一到同一套调用协议中**。
5. **把 RLM、Council、Workflow 等能力建立在同一层 runtime 上**。

## 推荐阅读顺序

如果想理解 Fabric 的源码，建议按下面顺序看：

1. [architecture.md](./architecture.md) — 整体架构和模块职责
2. [runtime-flow.md](./runtime-flow.md) — 一次 `fabric_exec` 从模型到工具再返回的完整执行链路
3. [rlm-and-agents.md](./rlm-and-agents.md) — RLM、Agent、Council、Workflow 到底是怎么实现的
4. [references.md](./references.md) — 关键源码入口与相关背景资料

## 最重要的源码入口

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/index.ts) | Pi extension 入口，注册 `fabric_exec` 和生命周期事件 |
| [`src/fabric-exec-tool.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-tool.ts) | `fabric_exec` 的 ToolDefinition |
| [`src/execution-service.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/execution-service.ts) | Fabric 真正的执行编排核心 |
| [`src/runtime/type-checker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/type-checker.ts) | TypeScript 检查与 transpile |
| [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts) | 默认 QuickJS sandbox + Host Bridge |
| [`src/core/action-registry.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/action-registry.ts) | Provider/action 注册、查找、校验、审批和调用 |
| [`src/fabric-state.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-state.ts) | 整体状态和 provider 初始化 |
| [`src/providers/pi-tools-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/pi-tools-provider.ts) | Pi 原生工具如何进入 Fabric |
| [`src/providers/mcp-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/mcp-provider.ts) | MCP 如何进入 Fabric |
| [`src/providers/agents-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/agents-provider.ts) | `agents.*` API |
| [`src/agents/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/manager.ts) | 子 Agent 真正如何被启动和管理 |

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
       ├─ Agent
       └─ Extension

最终 value
   │
   ▼
主 LLM context
```

换句话说，`fabric_exec` 只是入口，真正构成 Fabric 的是：

> **TypeScript Guest Runtime + JSON Host Bridge + Action Registry + Provider System + Agent Runtime**

---

后续如果源码变化较大，建议以具体 commit 链接为准，而不是只看 `main`。