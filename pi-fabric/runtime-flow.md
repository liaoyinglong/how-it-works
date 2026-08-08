# `fabric_exec` 一次调用到底发生了什么

这篇只追一次最核心的调用链：

```text
LLM → fabric_exec → TypeScript → QuickJS → Host Bridge → ActionRegistry → Provider → Result
```

## 1. 模型调用 `fabric_exec`

入口定义在：

- [`src/fabric-exec-tool.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-tool.ts)

模型看到的参数核心是：

```ts
{
  code: string,
  strings?: Record<string, string>,
  resultFormat?: "auto" | "yaml" | "json" | "text",
  tokenBudget?: number,
  agentBudget?: number,
  display?: ...
}
```

这里故意把 schema 设计得很扁平，最核心就是一个大的 `code` 字符串。

官方源码注释里明确提到，这么做的一部分原因是减少复杂嵌套 Tool Schema 在模型采样时出现字段漂移的概率。

## 2. `execute()` 转交给 FabricExecutionService

`fabric_exec.execute()` 最终调用：

```ts
state.execution.execute({
  code,
  strings,
  signal,
  parentToolCallId,
  context,
  tokenBudget,
  maxAgentCalls,
})
```

真正的核心进入：

- [`src/execution-service.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/execution-service.ts)

## 3. 第一步不是运行，而是 TypeScript 检查

源码：

- [`src/runtime/type-checker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/type-checker.ts)

用户代码会被包进：

```ts
async function __piFabricMain() {
  // model generated code
}
```

然后使用 TypeScript compiler API：

```ts
ts.createProgram(...)
```

做 syntactic / semantic diagnostics，并 emit JavaScript。

因此如果模型生成：

```ts
const x = await pi.read(...)
return x
```

真正运行的是 transpile 后的 `__piFabricMain()`。

### 一个值得注意的点

这里的 TypeScript 并不是严格业务代码级别的 TS 检查。

配置中大量 strict 选项关闭，同时还过滤一部分常见 correctness diagnostic。目的更偏向：

> 在执行前抓住明显语法/API 使用错误，而不是要求模型生成 production-grade strict TypeScript。

## 4. 默认进入 QuickJS，而不是 Node

执行器选择在 `FabricExecutionService`：

```ts
runtimeKind === "node-process"
  ? new NodeProcessRuntime()
  : new QuickJsRuntime()
```

默认 runtime：

- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)

可选不安全 runtime：

- [`src/runtime/node-process-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/node-process-runtime.ts)

默认 QuickJS guest 没有正常 Node 环境里的：

```text
process
require
fs
network
subprocess
```

所以模型生成的程序不能直接随意碰 host。

所有有副作用的能力必须走 Fabric Bridge。

## 5. Fabric 最关键的桥：`__fabricHostCall`

QuickJS host 会注入：

```ts
__fabricHostCall(ref, args)
```

然后 guest setup 再把它包装成：

```ts
const __call = async (ref, args) => {
  const value = await __fabricBridge(ref, args)
  return value
}
```

之后各种高级 API 都只是这个函数的包装。

例如：

```ts
tools.search(...)
```

实际变成：

```ts
__call("fabric.$search", args)
```

而：

```ts
agents.run(...)
```

实际变成：

```ts
__call("agents.run", args)
```

MCP：

```ts
mcp.github.search(...)
```

大体会变成：

```ts
__call("mcp.github.search", args)
```

这就是整个系统最重要的协议边界。

## 6. Guest API 是在 `GUEST_SETUP` 里动态装出来的

`quickjs-runtime.ts` 内有一个很大的：

```ts
export const GUEST_SETUP = `...`
```

它往 QuickJS global 注入：

```text
tools
pi
extensions
mcp
memory
state
schema
compact
agents
mesh
workflow
rlm
council
print
π
```

所以这些并不是 QuickJS 自己支持的语言能力，而是 Fabric 自己构造的 runtime API。

## 7. Host 端收到 ref 后如何处理

`FabricExecutionService.execute()` 把一个 host callback 交给 runtime：

```ts
runtime.execute(code, async (ref, args, runtimeSignal) => {
  ...
})
```

如果是内部 ref，例如：

```text
fabric.$providers
fabric.$search
fabric.$describe
fabric.$call
fabric.$phase
```

就在 `ExecutionService` 自己处理。

如果是正常能力：

```text
pi.read
mcp.xxx.yyy
agents.run
```

就进入：

```ts
invokeAction(ref, args, context)
```

再调用：

```ts
this.registry.invoke(...)
```

## 8. `ActionRegistry.invoke()` 的完整阶段

源码：

- [`src/core/action-registry.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/action-registry.ts)

执行顺序：

```text
ref
 ↓
parse provider.action
 ↓
provider.describe(action)
 ↓
authorize
 ↓
provider.prepareArguments
 ↓
TypeBox schema validation
 ↓
approval
 ↓
provider.invoke
 ↓
result bound/truncate
 ↓
audit
```

所以 guest 里的一次：

```ts
await pi.read({ path: "src/index.ts" })
```

并不是直接调用 read。

它至少会经过：

```text
QuickJS
 ↓
Host Bridge
 ↓
ExecutionService
 ↓
ActionRegistry
 ↓
PiToolsProvider
 ↓
Pi read ToolDefinition
```

## 9. Nested Tool Call 仍然尽量复用 Pi lifecycle

`PiToolsProvider` 会直接构造 Pi 自带的 tool definition：

```ts
createReadToolDefinition
createBashToolDefinition
createEditToolDefinition
...
```

并在可用时 replay：

```text
tool_execution_start
tool_call
tool_result
tool_execution_end
```

这非常重要，因为这意味着某些其他 Pi extension 对工具的拦截仍然可能生效。

也就是说 Fabric 的目标不是：

> 自己重新实现一个 Pi。

而更像：

> 把 Pi 的 tool runtime 包进一个 programmatic execution layer。

## 10. `Promise.all` 为什么真的能并行

假设 guest：

```ts
const [a, b, c] = await Promise.all([
  pi.read({ path: "a.ts" }),
  pi.read({ path: "b.ts" }),
  pi.read({ path: "c.ts" }),
])
```

每个调用都会生成独立 host promise。

QuickJS runtime 维护：

```text
pendingHostPromises
hostTasks
```

host 侧并不要求一个调用结束才能开始下一个，因此独立能力可以真正并发执行。

这就是 Fabric 能减少 wall-clock time 的来源之一。

## 11. Timeout 与 Cancellation

QuickJS runtime 同时维护：

- memory limit
- max stack
- execution deadline
- AbortSignal
- pending host calls

如果 guest timeout/cancel，host 侧也会通过 `AbortController` 中止还在执行的调用。

某些长任务还可以动态扩展 deadline，例如：

```text
pi.bash timeout
agents.run timeout
```

这比“模型随手写个 Python 然后 bash 跑一下”多了一套统一生命周期管理。

## 12. 最终什么进入主模型 Context

guest 结束后返回：

```ts
{
  value,
  logs,
  terminationReason,
  error?
}
```

`fabric_exec` 再把最终结果格式化成：

```text
text / json / yaml
```

并进行输出预算限制。

中间 nested call 的全部原始结果并不会天然全部展开到主模型对话里。

这就是 Fabric Context Economy 的核心。

## 13. 一个完整例子

模型生成：

```ts
const files = await pi.find({ pattern: "**/*.ts", path: "src" })
const candidates = files
  .split("\n")
  .filter(x => x.includes("auth"))
  .slice(0, 20)

const contents = await Promise.all(
  candidates.map(path => pi.read({ path, limit: 200 }))
)

return contents
  .map((text, i) => ({ path: candidates[i], hasGuard: text.includes("Guard") }))
  .filter(x => !x.hasGuard)
```

真实流程：

```text
Main LLM
   ↓ one tool call
fabric_exec
   ↓
TS checker
   ↓
QuickJS
   ↓
pi.find ───────────────┐
                       │
                       ▼
                 ActionRegistry
                       │
                 PiToolsProvider
                       │
                    Pi find
                       │
                   result
                       │
                       ▼
                    QuickJS
                       │
              Promise.all reads
                 /   /   \   \
                ▼   ▼     ▼   ▼
             ActionRegistry...
                       │
                       ▼
              QuickJS filter/map
                       │
                    return
                       │
                       ▼
              one compact result
                       │
                       ▼
                   Main LLM
```

主模型不需要在每个 `read` 之后重新推理一次。

这正是 `fabric_exec` 与普通 tool-call loop 最本质的区别。