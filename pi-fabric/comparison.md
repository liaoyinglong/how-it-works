# Fabric vs Python / MCP / LangGraph / RLM

Fabric 很容易和几类东西混在一起，因为它们表面上都在解决“让 LLM 做更多事情”。

但实际上它们解决的问题层级不同。

先给一个最短结论：

> **Python / JS 是通用程序执行；MCP 是能力暴露协议；LangGraph 是开发者定义的 Agent Orchestration Framework；RLM 是递归处理超大上下文的 inference pattern；Fabric 则是在 Pi 里面让模型动态生成程序，统一调用 tools / MCP / agents / actors / mesh 的 Agent Runtime。**

因此很多时候它们不是互斥关系，而是可以组合。

本文仍然基于固定源码快照：[`08019b6138e90466d2b4ebd1acedd3d2523eb164`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164)。

---

## 1. 先用一张表定位

| 方案 | 主要解决什么 | 谁写控制流 | 控制流何时产生 | 是否天然是 Agent Runtime | 和 Fabric 的关系 |
|---|---|---|---|---|---|
| 普通 Tool Calling | 让模型一次调用一个 Tool | LLM 一轮一轮决定 | inference 时 | 部分 | Fabric 想减少其中机械的往返 |
| Python / JS Script | 通用计算、循环、文件/网络/进程操作 | 人或 LLM | 运行前/运行时 | 否 | Fabric 的 programmatic execution 思想与它最接近 |
| MCP | 标准化暴露 Tool / Resource / Prompt | 不负责主控制流 | N/A | 否 | Fabric 把 MCP server 当 Provider 使用 |
| Fabric | 让模型生成临时程序组合 tools / agents / MCP | LLM 生成 TypeScript | inference 时 | 是 | 本体 |
| LangGraph | 构建长期、可持久化、开发者可控的 Agent Graph | 应用开发者 | 应用开发时 | 是 | 更偏应用框架，不是 Pi 内临时 Code Mode |
| RLM | 对超大 context 做程序化探索和递归模型调用 | 模型 / harness | inference 时 | 不是完整 runtime | Fabric 内部提供 `rlm.query()` 作为一种 pattern |

---

# 2. Fabric vs 直接让 LLM 写 Python / JS

这两个其实是最近的一组。

假设任务是：

> 扫描 300 个文件，找到所有 `useEffect`，只返回包含异步副作用的候选。

直接写 Python：

```python
for file in files:
    text = read(file)
    if "useEffect" in text:
        ...
```

Fabric：

```ts
const files = await pi.find(...)
const results = await Promise.all(
  files.map(path => pi.read({ path }))
)
return filter(results)
```

从控制流思想看，两者都是：

```text
LLM
 ↓
Program
 ↓
Program 自己循环/判断/并行
 ↓
Result
```

所以 Fabric 并没有发明“让模型写程序”这件事。

真正的区别在周围的 runtime。

---

## 3. Python 操作的是 OS，Fabric 操作的是 Agent Capabilities

普通 Python 最自然的 API 是：

```text
open()
subprocess
requests
filesystem
SDK
```

Fabric guest 最自然的 API 是：

```ts
pi.read(...)
pi.grep(...)
pi.edit(...)
mcp.server.tool(...)
agents.run(...)
mesh.publish(...)
compact.request(...)
```

所以可以粗略写成：

```text
Python
→ OS / SDK / Network APIs

Fabric Program
→ Agent Capability APIs
```

而这些 capability 会统一经过：

```text
Host Bridge
→ ActionRegistry
→ schema
→ approval
→ provider
→ audit
```

相关实现：

- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)
- [`src/core/action-registry.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/action-registry.ts)

如果直接用 Python 自己实现同样效果，你最终需要逐渐补：

```text
Tool Registry
MCP Client
Schema Validation
Permissions
Timeout / Cancellation
Result Bounding
Audit Trace
Sub-agent Lifecycle
Context Boundary
Persistent Actor
Shared Coordination State
Compaction
```

做到后面，本质上就在自己构建 Agent Runtime。

---

## 4. 什么时候直接 Python 反而更合适

Fabric 并不是“脚本的升级版，因此所有脚本都该改成 Fabric”。

对于已经完全确定的工程任务：

```text
批量转换 JSON
重命名文件
生成代码
统计 AST
固定规则 lint
一次性 migration
```

如果控制逻辑已经确定，直接写：

```text
Python / Node script
```

通常更简单、更容易测试、更容易复用。

Fabric 更适合这种情况：

> **具体控制流本身需要由模型根据当前任务临时生成。**

例如：

```text
“帮我理解这个陌生 repo 的认证系统”
```

模型事先不知道：

- 搜什么关键词
- 哪些文件会命中
- 是否需要 MCP
- 哪些文件值得继续读
- 是否需要 child agent

但它可以临时生成一个小程序去完成当前 exploration stage。

因此：

```text
稳定、可复用、确定性任务
→ 普通 Script

临时、任务相关、模型动态决定 orchestration
→ Fabric
```

---

# 5. Fabric vs MCP：两者根本不是同一层

MCP 最容易被误认为：

> “已经有 MCP 了，为什么还需要 Fabric？”

因为 MCP 主要解决的是：

```text
一个能力怎么被标准化地暴露给 AI Application
```

例如：

```text
GitHub MCP
  search_issues
  get_pull_request

Database MCP
  query
  schema
```

它回答的是：

> **有哪些能力？参数是什么？怎么调用？**

它并不负责回答：

> **这 20 个工具应该怎样循环、并行、过滤、递归调用，并且怎样管理中间数据？**

MCP 官方资料：

- [Model Context Protocol](https://modelcontextprotocol.io/)

---

## 6. Fabric 直接把 MCP 当成 Provider

Fabric 源码里：

```text
MCP
```

只是 ActionRegistry 下的一种 Provider。

Guest 可以直接：

```ts
await mcp.github.search_issues(...)
```

最后还是进入：

```text
QuickJS
 ↓
Host Bridge
 ↓
ActionRegistry
 ↓
McpProvider
 ↓
mcporter runtime
 ↓
MCP server
```

源码：

- [`src/providers/mcp-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/mcp-provider.ts)

所以关系更像：

```text
MCP
= Capability Protocol

Fabric
= Programmatic Orchestration Runtime
```

不是：

```text
Fabric vs MCP
谁替代谁
```

而是：

```text
Fabric
  └─ 可以 orchestration MCP capabilities
```

---

# 7. 一个 MCP 例子就能看出区别

假设 GitHub MCP 有：

```text
list_pull_requests
get_pr_files
get_file
get_comments
```

普通 Tool Loop：

```text
LLM → list PRs
LLM ← 结果
LLM → get PR files
LLM ← 结果
LLM → read N files
...
```

MCP 本身不会帮你自动变成：

```ts
const prs = await mcp.github.list_pull_requests(...)

const details = await Promise.all(
  prs.slice(0, 5).map(async pr => {
    const files = await mcp.github.get_pr_files({ pr: pr.number })
    return summarize(files)
  })
)

return details.filter(relevant)
```

Fabric 提供的正是这一层 programmatic control flow。

---

# 8. Fabric vs LangGraph：动态 Agent Program vs 应用级 Graph

LangGraph 和 Fabric 都可以被叫做：

```text
Agent Orchestration
```

但使用者角色完全不同。

LangGraph 官方定位更接近：

> 构建 long-running、stateful agents 的低层 orchestration framework。

官方参考：

- [LangGraph Overview](https://reference.langchain.com/python/langgraph/overview)
- [LangGraph](https://langchain-ai.github.io/langgraph/)

LangGraph 的典型模式是开发者写：

```python
builder = StateGraph(State)

builder.add_node("search", search_node)
builder.add_node("review", review_node)

builder.add_edge(...)

app = builder.compile(...)
```

也就是：

```text
Developer
   ↓
预先定义 Graph / State / Node / Edge
   ↓
Runtime 执行
```

而 Fabric 的典型模式是：

```text
User Task
   ↓
Main LLM
   ↓
临时生成 TypeScript
   ↓
QuickJS 执行
```

最大的区别是：

> **LangGraph 的 graph 通常是产品代码的一部分；Fabric 的 program 通常是一次 inference 的中间产物。**

---

# 9. LangGraph 更适合什么

如果你正在构建一个真正的产品：

```text
客服 Agent
研究 Agent SaaS
长期审批工作流
Human-in-the-loop workflow
需要 checkpoint / resume 的生产任务
```

而且你希望：

```text
节点是谁
状态结构是什么
哪些边允许跳转
什么时候 checkpoint
```

由工程师明确控制，那么 LangGraph 非常合理。

因为你真正想要的是：

```text
Developer-authored Agent Application
```

而不是让模型每次重新发明 orchestration。

---

# 10. Fabric 更适合什么

Fabric 的目标不是让你开发一个新的 Agent SaaS Framework。

它是直接嵌进 Pi coding agent：

```text
Main Coding Agent
  ↓
当前任务临时需要一个控制流
  ↓
生成 TypeScript
  ↓
执行完就结束
```

例如：

```text
这一次需要并行扫 50 个 package
下一次需要 GitHub + grep + read
再下一次只需要 edit + test
```

这些 orchestration 没必要由应用开发者提前设计成固定 Graph。

因此：

```text
LangGraph
→ Developer programs the agent system

Fabric
→ LLM programs its own temporary tool/agent execution
```

这是两者最值得记住的区别。

---

# 11. Fabric vs RLM：Runtime 和 Pattern 的关系

RLM（Recursive Language Models）更容易和 Fabric 混为一谈。

RLM 原始论文：

- [Recursive Language Models — arXiv:2512.24601](https://arxiv.org/abs/2512.24601)

它的核心思想可以粗略理解成：

```text
超大 Context 不直接全部塞进模型
        ↓
把它当成外部环境
        ↓
模型用程序探索 / 切片
        ↓
对子问题递归调用模型
        ↓
聚合结果
```

它主要解决：

> **单个模型上下文窗口无法有效处理巨大输入。**

所以 RLM 首先是一种 inference / context decomposition pattern。

---

# 12. Fabric 里面的 `rlm.query()` 实际是什么

Fabric 在 QuickJS guest 中暴露：

```ts
rlm.query(...)
```

但从源码看，它没有单独一套“RLM Model Runtime”。

它的核心就是受 budget 管理的：

```ts
agents.run({
  ...args,
  runner: "pi",
  recursive: true,
})
```

详细拆解见：

- [rlm-and-agents.md](./rlm-and-agents.md)
- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)

因此概念层级可以写成：

```text
Fabric Runtime
  ├─ pi.*
  ├─ mcp.*
  ├─ workflow.*
  ├─ agents.*
  ├─ actors
  ├─ mesh
  └─ rlm.query()
        ↓
     recursive Pi agent
```

所以：

> **RLM 是 Fabric 可以执行的一种 recursive orchestration pattern；Fabric 的范围比 RLM 更大。**

---

# 13. RLM 和普通 Sub-agent 也不完全一样

普通 Sub-agent：

```text
Main
 ↓
“帮我 review auth 模块”
 ↓
Child Agent
 ↓
结果
```

RLM 更强调：

```text
大问题
 ↓
程序化分解 context
 ↓
对子块递归推理
 ↓
必要时进一步递归
 ↓
聚合
```

而 Fabric 的 `recursive: true` 又比最简 RLM 更重：

```text
不是简单 model(prompt)
```

而是：

```text
完整 Child Pi
+
Tools
+
Fabric Extension
+
还能继续递归
```

所以从工程形态上，它其实更接近：

```text
Recursive Agent Harness
```

而不只是裸模型递归。

---

# 14. Fabric vs 普通 Tool Calling

这是理解它价值最直接的 baseline。

传统：

```text
LLM
 ↓
grep
 ↓
LLM
 ↓
read
 ↓
LLM
 ↓
read
 ↓
LLM
```

Fabric：

```text
LLM
 ↓
TypeScript program
 ↓
grep
 ↓
read/read/read
 ↓
filter/map
 ↓
compact return
 ↓
LLM
```

但这里必须保留一个边界：

> 真正需要语义判断时，模型仍然要重新参与。

Fabric 节省的是：

```text
deterministic orchestration
```

而不是：

```text
semantic reasoning
```

详见：

- [context-economy.md](./context-economy.md)

---

# 15. 它们其实可以组合

真正工程里经常是：

```text
LangGraph Application
    ↓
某个 Node 里调用一个 Agent
    ↓
Agent 通过 MCP 获取外部能力
```

或者：

```text
Pi + Fabric
   ↓
fabric_exec
   ↓
MCP GitHub
   ↓
recursive RLM child
```

甚至：

```text
Fabric guest
   ↓
pi.bash("python deterministic-analysis.py")
```

所以不要把工具选择理解成：

```text
只能选一个
```

而应该看每层的问题是什么。

---

# 16. 一个实用选择表

| 场景 | 推荐 |
|---|---|
| 已知算法，批量处理文件 | Python / Node Script |
| 给各种 AI Client 暴露 GitHub / DB / Browser 能力 | MCP |
| 在 Pi 中临时组合 read/grep/MCP/Agent | Fabric |
| 构建固定的生产级 Agent Workflow | LangGraph（或类似 orchestration framework） |
| 输入远超单模型上下文，需要动态分治推理 | RLM |
| Fabric 里偶尔遇到超大 repo / context | Fabric + RLM |
| 单文件简单修改 | 普通 Tool Call 通常已经足够 |
| 大量独立 read/search 能并行 | Fabric programmatic execution 很有优势 |
| 多个长期参与者跨 session 协调 | Fabric Actor + Mesh |

---

# 17. 最值得记住的层级关系

```text
                    Agent System
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
 Capability          Orchestration      Inference Pattern
       │                 │                 │
      MCP          Fabric / LangGraph      RLM
                         │
                    Program Execution
                         │
                    TS / Python / JS
```

更具体一点：

```text
Python / JS
→ 最基础的“程序能做控制流”

MCP
→ 标准化“程序/模型能调用什么外部能力”

Fabric
→ 让 Pi 模型临时编程这些能力，并加入 Agent Runtime 语义

LangGraph
→ 让开发者构建长期、状态化 Agent 应用

RLM
→ 让模型对巨大 context 做递归、程序化分解
```

所以 Fabric 最特别的地方并不是某一个单独能力。

而是把：

> **Code as Action + Tool Runtime + MCP + Multi-Agent + Context Lifecycle**

压进了 Pi 的一次 coding-agent inference loop 里。
