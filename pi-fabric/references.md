# Pi Fabric 参考资料与源码索引

这份文件集中放源码入口、官方说明和相关概念资料，方便后续继续补充。

## Pi Fabric 官方资料

- GitHub：[monotykamary/pi-fabric](https://github.com/monotykamary/pi-fabric)
- Pi Package：[pi.dev/packages/pi-fabric](https://pi.dev/packages/pi-fabric)
- README：[README.md](https://github.com/monotykamary/pi-fabric/blob/main/README.md)
- Architecture：[docs/architecture.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/architecture.md)
- Agents：[docs/agents.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/agents.md)
- Configuration：[docs/configuration.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/configuration.md)
- Compaction：[docs/compaction.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/compaction.md)
- Audit Trace：[docs/audit-trace.md](https://github.com/monotykamary/pi-fabric/blob/main/docs/audit-trace.md)

## 本次源码分析固定快照

为了避免 `main` 更新后文档描述和代码对不上，本目录主要引用以下 commit：

[`08019b6138e90466d2b4ebd1acedd3d2523eb164`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164)

当时 `package.json` 版本为 `0.40.3`。

## 核心源码导航

### Extension / Tool 入口

- [`src/index.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/index.ts)
- [`src/fabric-exec-tool.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-tool.ts)
- [`src/fabric-exec-arguments.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-arguments.ts)

### Execution Runtime

- [`src/execution-service.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/execution-service.ts)
- [`src/runtime/type-checker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/type-checker.ts)
- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)
- [`src/runtime/node-process-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/node-process-runtime.ts)

### Registry / Provider

- [`src/core/action-registry.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/action-registry.ts)
- [`src/providers/pi-tools-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/pi-tools-provider.ts)
- [`src/providers/mcp-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/mcp-provider.ts)
- [`src/providers/agents-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/agents-provider.ts)

### Agent / Recursive Runtime

- [`src/agents/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/manager.ts)
- [`src/worker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/worker.ts)
- [`src/actors/`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/actors)
- [`src/mesh/`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/mesh)

## RLM / Recursive Agent 背景

### Recursive Language Models

- 论文：[Recursive Language Models — arXiv:2512.24601](https://arxiv.org/abs/2512.24601)

可以把其核心思想粗略理解为：

> 不把超大上下文一次性全塞进 LLM，而是让模型用程序方式探索外部上下文，并对子问题递归调用模型。

### Fabric 中的对应实现

Fabric 的 `rlm.query()` 并没有单独发明一套模型 runtime，而是建立在 `agents.run()` 上，并强制：

```ts
runner: "pi"
recursive: true
```

具体实现位于：

- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)

递归 child 的真正启动过程则位于：

- [`src/agents/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/manager.ts)

## Fabric 使用到的重要第三方依赖

从分析快照的 `package.json` 可见：

- [quickjs-emscripten-core](https://www.npmjs.com/package/quickjs-emscripten-core) — QuickJS WASM runtime
- [mcporter](https://www.npmjs.com/package/mcporter) — MCP runtime / connection pooling
- [TypeScript](https://www.typescriptlang.org/) — guest code type checking / transpile
- [TypeBox](https://github.com/sinclairzx81/typebox) — action input schema validation
- [Shiki](https://shiki.style/) — UI code highlighting

对应源码：[`package.json`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/package.json)

## 阅读源码时值得重点搜索的符号

如果自己继续追，可以优先搜索这些函数/类：

```text
piFabric
createFabricExecTool
FabricExecutionService.execute
QuickJsRuntime.execute
GUEST_SETUP
__fabricHostCall
ActionRegistry.invoke
FabricState.initialize
PiToolsProvider.invoke
McpProvider.invoke
AgentsProvider
AgentManager.spawn
AgentManager.run
rlm.query
__workflowParallel
council.run
```

## 后续值得继续补的主题

这个目录后续还可以继续增加：

- `security.md`：QuickJS sandbox、approval、Schema enforce、Node unsafe runtime
- `context-economy.md`：Fabric 到底如何减少主模型 context / tool round-trip
- `actors-and-mesh.md`：persistent actor、mesh、participant topology
- `compaction.md`：Fabric 如何参与 Pi compaction
- `comparison.md`：Fabric vs 直接写 Python vs MCP vs LangGraph / RLM
- `benchmarks.md`：实际测试 Fabric 在 repo search / bulk read / review 场景的速度和 token 差异
