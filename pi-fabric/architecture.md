# Pi Fabric 架构拆解

## 1. 它不是“一个 Tool”，而是一层 Runtime

从表面看，Pi 只多了一个 `fabric_exec`。但从源码看，`fabric_exec` 只是模型暴露面，真正的系统由几层组成：

```text
┌──────────────────────────────────────┐
│               Pi Host                │
│                                      │
│  Extension events / lifecycle / UI   │
└─────────────────┬────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────┐
│           fabric_exec Tool           │
│                                      │
│ code / strings / budgets / display   │
└─────────────────┬────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────┐
│       FabricExecutionService         │
│                                      │
│ typecheck / timeout / audit / guard  │
└─────────────────┬────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────┐
│          QuickJS Guest Runtime       │
│                                      │
│ tools / pi / mcp / agents / rlm ...  │
└─────────────────┬────────────────────┘
                  │ JSON-only bridge
                  ▼
┌──────────────────────────────────────┐
│            ActionRegistry            │
│                                      │
│ resolve → prepare → validate →       │
│ approve → invoke → audit             │
└──────────────┬──────────┬────────────┘
               │          │
      ┌────────┘          └──────────┐
      ▼                              ▼
 PiToolsProvider                 McpProvider
 AgentsProvider                  other providers
```

官方架构文档也给出了同样的核心结构：[`docs/architecture.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/docs/architecture.md)。

## 2. `src/index.ts`：Pi Extension 入口

入口是：

- [`src/index.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/index.ts)

它默认导出：

```ts
export default async function piFabric(pi: ExtensionAPI): Promise<void>
```

这里主要做几件事：

### 2.1 建立全局 FabricState

```ts
const capturedTools = new CapturedToolCatalog();
const state = new FabricState(pi, capturedTools);
```

`FabricState` 是整个插件的状态容器。它负责持有：

- `ActionRegistry`
- `FabricExecutionService`
- AgentManager
- ActorManager
- MeshStore
- SchemaController
- CompactController
- Provider 实例

源码：[`src/fabric-state.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-state.ts)

### 2.2 创建并注册 `fabric_exec`

```ts
const fabricTool = createFabricExecTool(...)
pi.registerTool(fabricTool)
```

也就是说从 Pi 模型视角，Fabric 最核心的入口仍然只是标准的 Pi custom tool。

源码：[`src/fabric-exec-tool.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-tool.ts)

### 2.3 监听 Pi 生命周期

它监听：

- `session_start`
- `input`
- `agent_start`
- `agent_end`
- `turn_end`
- `agent_settled`
- `tool_call`
- `tool_result`
- `message_end`
- `tool_execution_end`
- `session_compact`

这些 hook 使 Fabric 不只是一个“同步执行脚本”的 tool，而可以参与：

- tool lifecycle
- compaction
- handoff
- actor event
- UI activity
- persistent agent topology

这也是它和“简单执行一段 Python”差异最大的地方之一。

## 3. FabricState：装配所有 Provider

`FabricState.initialize()` 会根据配置注册不同 provider。

核心源码：[`src/fabric-state.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-state.ts)

大致可以理解为：

```ts
registry = new ActionRegistry(...)

registry.register(new PiToolsProvider(...))
registry.register(new McpProvider(...))
registry.register(new MeshProvider(...))
registry.register(new StateProvider(...))
registry.register(new SchemaProvider(...))
registry.register(new CompactProvider(...))
registry.register(new AgentsProvider(...))
registry.register(new MemoryProvider(...))
```

所以 `ActionRegistry` 实际上就是 Fabric 的能力总线。

## 4. ActionRegistry：统一的 Capability Bus

源码：[`src/core/action-registry.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/action-registry.ts)

每个能力都变成：

```text
provider.action
```

例如：

```text
pi.read
pi.grep
mcp.github.search
agents.run
mesh.publish
memory.recall
schema.commit
```

`ActionRegistry.invoke()` 的调用顺序非常值得注意：

```text
1. parse ref
2. provider.describe(action)
3. authorize
4. provider.prepareArguments
5. schema validation
6. approval
7. provider.invoke
8. result bounding
9. audit
```

这意味着 Fabric 并不是简单做：

```ts
await someTool(args)
```

而是给所有 nested calls 加了一层统一的：

- 发现
- 类型/Schema
- 权限
- 审批
- 审计
- 超时
- 截断
- 生命周期

## 5. Provider 是 Fabric 最重要的扩展接口

一个 Provider 大体提供：

```ts
{
  name,
  description,
  list(),
  describe(),
  invoke()
}
```

所以 Fabric 的设计不是把 MCP、Pi、Agent 分别写死在 runtime 里，而是统一成 Provider。

这也是为什么 QuickJS guest 可以同时看到：

```ts
pi.read(...)
mcp.foo.bar(...)
agents.run(...)
```

它们最后都会进入相同的 Registry path。

## 6. Pi Tools 并没有被重新实现一遍

源码：[`src/providers/pi-tools-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/pi-tools-provider.ts)

它直接使用 Pi 提供的 ToolDefinition factory，例如：

```ts
createReadToolDefinition(cwd)
createBashToolDefinition(cwd)
createEditToolDefinition(cwd)
createGrepToolDefinition(cwd)
```

因此：

```ts
await pi.read({ path: "src/index.ts" })
```

最终仍然可以走 Pi 原生 tool 的执行逻辑。

更重要的是，Fabric 还会尽量 replay Pi 的：

```text
tool_execution_start
tool_call
tool_result
tool_execution_end
```

所以其他 Pi extension 仍然有机会观察或修改 nested call。

这说明 Fabric 不是“绕过 Pi”，而是尽可能把自己嵌进 Pi 原有 lifecycle。

## 7. MCP 只是另一个 Provider

源码：[`src/providers/mcp-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/mcp-provider.ts)

它通过 `mcporter` 创建 pooled runtime：

```ts
createRuntime(...)
```

然后把 MCP server/tool 映射成：

```text
mcp.<server>.<tool>
```

比如 guest 里：

```ts
await mcp.github.search({ ... })
```

最终仍然变成 ActionRegistry 中的一个 action invoke。

这就是 Fabric 所谓“统一工具运行时”的真正含义。

## 8. 为什么这种架构能省主 Context

传统 Tool Calling：

```text
LLM
 ↓
grep
 ↓
结果进入 conversation
 ↓
LLM
 ↓
read
 ↓
结果再次进入 conversation
```

Fabric：

```text
LLM
 ↓
一次 fabric_exec
 ↓
QuickJS 内部：
  grep
  read
  read
  filter
  map
  Promise.all
 ↓
return compactResult
 ↓
只有 compactResult 进入 Main context
```

所以它优化的并不是“文件读取本身”，而是减少：

> **Host Tool Result → Main Model → 再决定下一 Tool Call**

这样的模型 round-trip。

## 9. 我认为最重要的设计判断

从源码看，Fabric 最核心的设计并不是 Multi-Agent，而是：

> **把 Tool Calling 从“LLM 每一步参与控制”变成“LLM 先生成一个小程序，由 runtime 执行控制流”。**

Multi-Agent、RLM、Council 都是在这个基础之上的进一步能力。

因此理解 Fabric 最好的顺序不是：

```text
swarm → council → RLM
```

而是：

```text
fabric_exec
    ↓
QuickJS
    ↓
Host Bridge
    ↓
ActionRegistry
    ↓
Provider
    ↓
Agent orchestration
```
