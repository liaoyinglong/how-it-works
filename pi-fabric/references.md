# Pi Fabric 参考资料与源码索引

这份文件集中放源码入口、官方说明、论文和 benchmark 入口，方便后续继续追源码。

## Pi Fabric 官方资料

- GitHub：[monotykamary/pi-fabric](https://github.com/monotykamary/pi-fabric)
- Pi Package：[pi.dev/packages/pi-fabric](https://pi.dev/packages/pi-fabric)
- README：[README.md](https://github.com/monotykamary/pi-fabric/blob/main/README.md)
- Architecture：[docs/architecture.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/architecture.md)
- Agents / Actors / Mesh：[docs/agents.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/agents.md)
- Configuration：[docs/configuration.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/configuration.md)
- Compaction：[docs/compaction.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/compaction.md)
- Programmatic Compaction：[docs/programmatic-compaction.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/programmatic-compaction.md)
- Audit Trace：[docs/audit-trace.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/audit-trace.md)
- Interface / Topology UI：[docs/interface.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/interface.md)

## 本次源码分析固定快照

为了避免 `main` 更新后文档描述和代码对不上，本目录主要引用以下 commit：

[`08019b6138e90466d2b4ebd1acedd3d2523eb164`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164)

当时 `package.json` 版本为 `0.40.3`。

## 本专题文档

- [architecture.md](./architecture.md) — 整体架构
- [runtime-flow.md](./runtime-flow.md) — `fabric_exec` 完整执行链路
- [context-economy.md](./context-economy.md) — 中间态、tool round-trip 与 Main context
- [rlm-and-agents.md](./rlm-and-agents.md) — RLM、Agent、Council、Workflow
- [actors-and-mesh.md](./actors-and-mesh.md) — persistent Actor、Mesh、Participant Topology
- [compaction.md](./compaction.md) — deterministic / programmatic compaction
- [comparison.md](./comparison.md) — Fabric vs Python / MCP / LangGraph / RLM
- [benchmarks.md](./benchmarks.md) — benchmark harness、指标与实验设计

## 核心源码导航

### Extension / Tool 入口

- [`src/index.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/index.ts)
- [`src/fabric-exec-tool.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-tool.ts)
- [`src/fabric-exec-arguments.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-arguments.ts)
- [`skills/fabric-exec/SKILL.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/skills/fabric-exec/SKILL.md)

### Execution Runtime

- [`src/execution-service.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/execution-service.ts)
- [`src/runtime/type-checker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/type-checker.ts)
- [`src/runtime/guest-types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/guest-types.ts)
- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)
- [`src/runtime/node-process-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/node-process-runtime.ts)

### Registry / Provider

- [`src/core/action-registry.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/action-registry.ts)
- [`src/providers/pi-tools-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/pi-tools-provider.ts)
- [`src/providers/mcp-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/mcp-provider.ts)
- [`src/providers/agents-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/agents-provider.ts)
- [`src/providers/mesh-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/mesh-provider.ts)
- [`src/providers/compact-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/compact-provider.ts)

### Agent / Recursive Runtime

- [`src/agents/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/manager.ts)
- [`src/worker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/worker.ts)
- [`src/providers/agents-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/agents-provider.ts)

### Actors / Mesh / Topology

- [`src/actors/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/actors/manager.ts)
- [`src/actors/types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/actors/types.ts)
- [`src/mesh/store.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/mesh/store.ts)
- [`src/topology/types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/types.ts)
- [`src/topology/participant-directory.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/participant-directory.ts)
- [`src/topology/control-plane.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/control-plane.ts)
- [`src/lifecycle/broker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/lifecycle/broker.ts)
- [`src/residency/client.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/residency/client.ts)
- [`skills/fabric-exec/references/mesh.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/skills/fabric-exec/references/mesh.md)

### Compaction

- [`src/compaction/hook.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/hook.ts)
- [`src/compaction/normalize.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/normalize.ts)
- [`src/compaction/projections.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/projections.ts)
- [`src/compaction/render.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/render.ts)
- [`src/compaction/threshold.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/threshold.ts)
- [`src/core/compact-controller.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/compact-controller.ts)
- [`src/agents/compact-control.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/compact-control.ts)

### Benchmark / Certification

- [`bench/README.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/README.md)
- [`bench/run-cell.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-cell.sh)
- [`bench/run-matrix.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-matrix.sh)
- [`bench/analyze.py`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/analyze.py)
- [`bench/run-deepswe-matrix.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-deepswe-matrix.sh)
- [`bench/analyze_pier.py`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/analyze_pier.py)
- [`scripts/benchmark-real-resume.mjs`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/scripts/benchmark-real-resume.mjs)
- [`scripts/benchmark-memory-heads.mjs`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/scripts/benchmark-memory-heads.mjs)

## RLM / Recursive Agent 背景

- [Recursive Language Models — arXiv:2512.24601](https://arxiv.org/abs/2512.24601)

可以把其核心思想粗略理解为：

> 不把超大上下文一次性全塞进 LLM，而是让模型用程序方式探索外部上下文，并对子问题递归调用模型。

Fabric 的 `rlm.query()` 建立在 `agents.run()` 上，并强制使用 Pi recursive child。详细见 [rlm-and-agents.md](./rlm-and-agents.md)。

## 相邻项目 / 概念

- [Model Context Protocol](https://modelcontextprotocol.io/) — capability protocol
- [LangGraph](https://langchain-ai.github.io/langgraph/) — developer-authored stateful agent orchestration
- [LangGraph Reference](https://reference.langchain.com/python/langgraph/overview) — API/reference

这些和 Fabric 的边界见 [comparison.md](./comparison.md)。

## Fabric 使用到的重要第三方依赖

- [quickjs-emscripten-core](https://www.npmjs.com/package/quickjs-emscripten-core) — QuickJS WASM runtime
- [mcporter](https://www.npmjs.com/package/mcporter) — MCP runtime / connection pooling
- [TypeScript](https://www.typescriptlang.org/) — guest code type checking / transpile
- [TypeBox](https://github.com/sinclairzx81/typebox) — action input schema validation
- [Shiki](https://shiki.style/) — UI code highlighting

对应源码：[`package.json`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/package.json)

## 阅读源码时值得重点搜索的符号

```text
piFabric
createFabricExecTool
FabricExecutionService.execute
QuickJsRuntime.execute
GUEST_SETUP
__fabricHostCall
ActionRegistry.invoke
FabricState.initialize
AgentManager.spawn
AgentManager.run
ActorManager
MeshStore
ParticipantDirectory
FabricControlPlane
LifecycleBroker
CompactController.maybeCommit
registerCompactionHook
rlm.query
__workflowParallel
council.run
```

当前计划中的核心分析主题已经覆盖；后续新增内容时继续按具体问题扩展，不预先创建空主题。