# RLM、Agent、Council、Workflow 在 Fabric 里到底是什么

这部分最容易被概念包装绕晕，所以直接从源码看。

## 1. `rlm.query()` 本质上不是一个神秘的新执行器

关键实现就在 QuickJS 的 `GUEST_SETUP` 中：

- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)

核心逻辑可以概括成：

```ts
globalThis.rlm = Object.freeze({
  query: (args) => {
    if (args && args.runner && args.runner !== "pi") {
      throw new Error(...)
    }
    return __budgetedRun({ ...args, runner: "pi", recursive: true })
  },
})
```

所以 Fabric 里的：

```ts
await rlm.query({ task: "..." })
```

本质上就是：

```ts
await agents.run({
  task: "...",
  runner: "pi",
  recursive: true,
})
```

再加上 token budget accounting。

## 2. `recursive: true` 真正改变了什么

看：

- [`src/agents/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/manager.ts)

AgentManager 在 spawn 时会判断：

```ts
const recursive = runner === "pi" && request.recursive === true
const extensions = recursive ? true : ...
```

然后 worker 参数里会带：

```text
--full-code-mode ...
--fabric-extension <path>
--depth <currentDepth + 1>
```

也就是说 recursive child 不是单纯“再 call 一次 model API”。

它会启动一个新的 Pi child，并让这个 child 再加载 Fabric extension。

于是形成：

```text
Main Pi
  │
  └─ Fabric
       │
       └─ agents.run(recursive=true)
            │
            ▼
          Child Pi
            │
            └─ Fabric
                 │
                 └─ fabric_exec / agents / tools ...
```

这就是 Fabric 里 RLM 真正的递归来源。

## 3. 这更接近 Recursive Agent Harness，而不只是普通 LLM recursion

经典 RLM 思路可以粗略理解为：

```text
LLM
 ↓
程序化探索大 context
 ↓
对相关子问题再次调用 LLM
```

Fabric 的实现更偏：

```text
Pi Agent
 ↓
启动完整 Child Pi Agent
 ↓
Child 仍拥有 tools + Fabric runtime
 ↓
Child 还可以继续递归
```

所以从工程形态看，它已经接近“递归 Agent Harness”。

相关背景可以参考：

- Recursive Language Models: [arXiv:2512.24601](https://arxiv.org/abs/2512.24601)
- Fabric 自带的 RLM skill：[`skills/fabric-rlm`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164/skills)

## 4. AgentManager 才是真正的子 Agent 执行器

关键文件：

- [`src/providers/agents-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/agents-provider.ts)
- [`src/agents/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/manager.ts)

`AgentsProvider` 负责把 Registry action 暴露成：

```text
agents.run
agents.spawn
agents.wait
agents.status
agents.create
agents.ask
agents.tell
...
```

`AgentManager` 负责真正的 lifecycle。

### spawn 流程

它会：

1. 检查 recursion depth。
2. 检查 runner。
3. 检查 budget。
4. 获取并发 semaphore。
5. 创建 run directory。
6. 写 `task.txt`、`status.json` 等文件。
7. 可选创建 Git worktree。
8. 组装 worker arguments。
9. 通过 transport 启动 worker。
10. 后台 monitor 状态。

支持的 transport 包括源码中出现的：

```text
process
tmux
screen
localterm
herdr
```

这说明 Fabric 的 Agent 不只是一个抽象 Promise，而是真正有独立进程/终端执行生命周期。

## 5. `agents.run` 与 `agents.spawn`

概念上：

```ts
agents.run(...)
```

等于：

```text
spawn
 ↓
wait
 ↓
返回最终结果
```

而：

```ts
agents.spawn(...)
```

会立刻返回 handle，之后可以：

```ts
agents.status({ id })
agents.wait({ id })
agents.stop({ id })
```

因此 `spawn` 更适合后台并行任务。

## 6. Council 没有额外的“Council Engine”

同样看 `GUEST_SETUP`。

Council 的本质是：

```ts
const results = await Promise.all(
  roles.map(role => agents.run(...))
)
```

然后如果 `synthesize=true`：

```ts
return agents.run({
  task: "Synthesize ..." + JSON.stringify(results)
})
```

所以：

```text
Council
 = parallel agents.run
 + one synthesizer agent
```

这很好理解为什么 Council 往往：

- 质量可能更高
- wall time 可以通过并行降低
- 总 token 往往更高

## 7. Workflow 也主要是 Guest-side 控制流

Fabric 注入：

```ts
workflow.parallel(...)
workflow.pipeline(...)
workflow.agent(...)
workflow.phase(...)
```

其中 `parallel` 的实现核心就是受 concurrency 控制的 Promise workers。

大体结构：

```ts
const results = new Array(items.length)
let cursor = 0

await Promise.all(
  workers.map(async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await thunk[index]()
    }
  })
)
```

所以 Fabric Workflow 并不依赖一个重量级 DAG engine 才能工作。

很多 orchestration 能力其实只是：

> 在 QuickJS guest 里给模型提供一套更容易生成的高级 JS API。

## 8. Token Budget 是怎么计的

`GUEST_SETUP` 里维护：

```ts
let __workflowSpentTokens = 0
```

每次 budget-aware agent run 后读取：

```ts
result.usage.input
result.usage.output
```

累加到 spent token。

然后：

```ts
workflow.budget.total
workflow.budget.spent()
workflow.budget.remaining()
```

都只是围绕这个值构建。

当达到预算后，后续 agent 调用会提前失败。

另外 AgentManager 还有更外层的 USD recursion budget ledger。

因此 Fabric 有两类 budget 思路：

```text
单次 workflow token budget
+
跨 recursive agent 的 cost budget
```

## 9. 为什么 RLM 不一定省总 Token

这点需要特别区分。

RLM 可能显著减少 **Main Agent Context**：

```text
Main
 ↓
只收到 child 汇总
```

但 child 自己仍然会消耗 token。

所以可能出现：

```text
主 context：明显更省
系统总 token：不一定更省
```

如果递归拆分得好：

- 每个 child 只看局部信息
- 总体也可能节省

如果拆分得差或深度太高：

- 多次重复加载系统提示
- 多个 Agent 重复探索
- synthesis 再消费一次

总 token 反而可能上升。

因此 RLM 更准确的价值是：

> **把超过单上下文窗口的大问题变成可分治、可递归处理的问题。**

而不是简单承诺“更省 token”。

## 10. Fabric、RLM、普通脚本的关系

可以这样看：

```text
LLM 写 Python/JS
     │
     ├─ 程序完成循环 / 搜索 / 聚合
     │
     ▼
Programmatic Tool Use
     │
     ├─ 给程序统一 tools API
     ├─ sandbox
     ├─ approval
     ├─ audit
     └─ lifecycle
     │
     ▼
Fabric
     │
     ├─ agents.run
     ├─ recursive=true
     └─ budget / depth / transport
     │
     ▼
RLM / Recursive Agent Harness
```

所以 RLM 不是和 Fabric 平级的另一种东西。

在 Fabric 里，它更像是在已有 Programmatic Runtime 上实现的一种 recursive orchestration pattern。