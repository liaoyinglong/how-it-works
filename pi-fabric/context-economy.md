# Fabric 的中间态、控制流与 Context Economy

这篇专门解释一个最容易产生误解的问题：

> Fabric 为什么能把大量 `read` / `grep` / MCP 调用放进一次 `fabric_exec` 里？如果模型本来就要看工具输出才能决定下一步，那这些步骤不是少不了吗？

答案是：**必要的语义判断并没有消失。Fabric 省掉的是那些本来可以由确定性程序控制流完成、却让主 LLM 每一步都重新当一次“调度器”的往返。**

---

## 1. 不是所有“下一步”都需要 LLM 判断

传统 Tool Calling 往往长这样：

```text
LLM
 ↓
grep
 ↓
结果进入主模型
 ↓
LLM 决定下一步
 ↓
read
 ↓
结果再次进入主模型
 ↓
LLM 再决定下一步
```

但很多依赖其实是机械的。例如：

```text
find *.tsx
→ grep useEffect
→ 对命中的文件 read 附近 80 行
→ 过滤空结果
```

这里“拿到 grep 结果后读命中文件”并不需要模型重新做一次语义推理。模型只要事先写出控制流即可：

```ts
const hits = await pi.grep({
  pattern: "useEffect",
  path: "src",
  limit: 50,
})

const files = extractPaths(hits)

const snippets = await Promise.all(
  files.map(path => pi.read({ path, limit: 120 }))
)

return snippets
```

模型写程序时不需要提前知道 `files` 具体有哪些，就像普通程序员写：

```ts
const users = await db.query(...)
for (const user of users) {
  await sendEmail(user.email)
}
```

写代码时并不知道 `users` 的真实值，但知道“拿到结果以后应该怎么处理”。

Fabric 把这种能力用于 Tool Calling。

---

## 2. 真正需要语义判断时，还是要让 LLM 参与

例如任务是：

> 找到所有认证相关实现，判断哪几个最可疑，再沿着最值得怀疑的实现继续追。

其中：

```text
grep auth
→ 得到 30 个候选
→ 哪几个值得继续追？
```

“哪几个值得继续追”通常是语义判断，纯 TypeScript 不一定能可靠完成。

这时有三种常见策略。

### 2.1 能程序化的规则，直接写进代码

如果判断标准明确：

```ts
const suspicious = hits.filter(x =>
  x.text.includes("skipAuth") ||
  x.text.includes("public") ||
  x.text.includes("admin")
)
```

这类判断不需要再次调用 LLM。

### 2.2 先收集和压缩，再回主 LLM

例如：

```text
find / grep / read 30 个候选
        ↓
程序过滤明显无关项
        ↓
只返回 8 个候选
        ↓
主 LLM 再做语义判断
```

因此 Fabric 不是保证“复杂任务一个模型回合完成”，而是把一个任务拆成更大的 **可程序化探索阶段**。

原来可能是：

```text
LLM → grep → LLM → read A → LLM → read B → LLM → ...
```

现在可能变成：

```text
LLM
 ↓
fabric_exec：grep → read A/B/C → filter → return 8 candidates
 ↓
LLM 再判断
```

它减少的是不必要的 model round-trip，不是取消必要推理。

### 2.3 中间需要模型判断时，调用 sub-agent / RLM

Fabric 的 guest runtime 还暴露了 `agents.*`、`workflow.*` 和 `rlm.query()`。

因此程序可以在某个中间阶段再次调用模型：

```ts
const chunks = await collectCandidates()

const judgments = await Promise.all(
  chunks.map(chunk =>
    workflow.agent(`判断这段代码是否存在权限绕过风险：\n${chunk}`)
  )
)

return judgments
```

这时整体变成：

```text
Main LLM
  ↓
Fabric program
  ↓
read / grep / MCP
  ↓
必要时 child LLM / RLM 判断
  ↓
继续程序控制流
  ↓
最终压缩结果
  ↓
Main LLM
```

因此更准确的说法是：

> **Fabric 把“程序负责控制流，LLM 负责语义判断”变成了同一个 runtime 中可以组合的能力。**

---

## 3. Fabric 到底怎么“压缩”中间结果

这里也没有神奇的自动摘要算法。主要靠三个朴素手段。

### 3.1 Source-side filtering

尽量在源头少读：

```ts
await pi.grep({ pattern: "targetSymbol", path: "src", context: 2 })
await pi.read({ path: "src/engine.ts", offset: 120, limit: 80 })
```

而不是直接读取一个 5000 行文件。

Fabric 自带的 `fabric-exec` skill 明确写了 **Search before reading**，并提醒无界 `pi.read` 会受 2000 行 / 50KB 上限约束：

- [`skills/fabric-exec/SKILL.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/skills/fabric-exec/SKILL.md)

### 3.2 在 sandbox 内做 map / filter / reduce

例如把大量原始结果转换成更紧凑的结构：

```ts
return hits.map(x => ({
  file: x.file,
  line: x.line,
  symbol: extractSymbol(x.text),
}))
```

也就是说，大量原始字符串可以只存在于 QuickJS 中间变量里，最终只 `return` 一个很小的结构化结果。

### 3.3 只在需要语义的地方调用模型

```text
100 个搜索结果
↓
程序筛到 15 个
↓
LLM 判断
↓
选 3 个继续深入
```

而不是让主模型依次看 100 个搜索结果。

---

## 4. 为什么中间 `read` 结果不会自动全部进入主模型 Context

假设模型生成：

```ts
const a = await pi.read("a.ts")
const b = await pi.read("b.ts")
const c = await pi.read("c.ts")

return {
  aImports: extractImports(a),
  bImports: extractImports(b),
  cImports: extractImports(c),
}
```

执行时：

```text
a / b / c 原始内容
      ↓
QuickJS guest variables
      ↓
程序内部处理
      ↓
return 小对象
```

`QuickJsRuntime` 最终把 `__piFabricMain()` resolve 出来的值 dump 回 host，并把这个值放进 `FabricSandboxResult.value`：

- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)

而 `fabric_exec` 最后主要格式化 `result.value`，再按输出预算返回给模型：

- [`src/fabric-exec-tool.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-tool.ts)

所以核心边界可以理解成：

```text
nested tool outputs
      ↓
QuickJS 中间态
      ↓
return value
      ↓
fabric_exec tool result
      ↓
Main LLM context
```

需要注意：Fabric 仍然会保留 audit / activity / trace 等执行信息用于 UI、审计和恢复，但它们和“每个 nested tool result 都作为一条新的主模型 Tool Result 消息进入对话”不是一回事。

---

## 5. “相关文件”是谁决定的

Fabric 没有一个神奇的：

```ts
getRelevantFiles()
```

通常还是模型生成的 TypeScript 决定：

- 搜什么 pattern
- 从哪里搜索
- 怎么解析命中结果
- 最多读多少文件
- 每个文件读哪个范围
- 用什么规则 filter
- 最终 `return` 什么

例如：

```ts
const hits = await pi.grep({
  pattern: "login|signin|authenticate",
  path: "src",
  limit: 50,
})

const paths = parsePaths(hits)

const candidates = await Promise.all(
  paths.slice(0, 10).map(async path => {
    const content = await pi.read({ path, limit: 250 })
    return {
      path,
      relevant: content.includes("authenticate"),
      preview: content.slice(0, 1500),
    }
  })
)

return candidates.filter(x => x.relevant)
```

因此 Fabric 本身并不会替模型自动判断“哪些文件相关”。它提供的是一个让模型能够表达这种动态控制流的运行环境。

---

## 6. 这是提示词，还是内置能力？答案是三层一起工作

Fabric 对模型的约束和引导主要来自三层。

### 6.1 Prompt / Tool Guidance：告诉模型怎么写

`fabric_exec` 的 ToolDefinition 里直接带有 `promptGuidelines`，其中明确要求：

- 独立操作尽量在一个 `fabric_exec` 中 batch
- `Promise.all` 用于并行
- 有依赖的步骤保持 sequential
- Search before reading
- 中间结果留在 sandbox
- Return only the compact final value
- 不要返回没用的 raw logs

源码：

- [`src/fabric-exec-tool.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/fabric-exec-tool.ts)

`fabric-exec` skill 也再次强调：

> One type-checked TS program in a fresh executor. Only the `return` value reaches the model.

源码：

- [`skills/fabric-exec/SKILL.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/skills/fabric-exec/SKILL.md)

### 6.2 TypeScript declarations：告诉模型 API 长什么样

Fabric 给 guest program 提供完整的 TypeScript declaration，包括：

```ts
pi.read(...)
pi.grep(...)
pi.find(...)
tools.search(...)
tools.describe(...)
agents.run(...)
...
```

例如 `PiToolsApi` 明确定义 `read / grep / find / ls` 返回 `Promise<string>`。

源码：

- [`src/runtime/guest-types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/guest-types.ts)

用户提供的 `code` 还会被自动包成：

```ts
async function __piFabricMain() {
  // model generated code
}
```

然后经过 TypeScript compiler 做检查和 transpile：

- [`src/runtime/type-checker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/type-checker.ts)

### 6.3 Runtime：真正提供这些 API 并执行

这些 API 不是 LLM 自己“想象”出来的。

`GUEST_SETUP` 会把 `tools`、`pi`、`mcp`、`agents`、`workflow`、`rlm` 等对象挂进 QuickJS global。

它们最终都通过：

```ts
__fabricHostCall(ref, args)
```

回到 host。

源码：

- [`src/runtime/quickjs-runtime.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/runtime/quickjs-runtime.ts)

因此可以把这三层记成：

```text
Prompt Guidance
“建议你 search before read，并 compact return”
        +
TypeScript Declarations
“pi.read / pi.grep 的签名和返回类型是什么”
        +
Runtime Validation & Execution
“真正执行 host tool，并校验 / approval / audit”
```

---

## 7. `return` 是怎么定义的

没有专门 DSL，就是普通 TypeScript `return`。

模型传给 `fabric_exec` 的 `code` 是 function body：

```ts
const hits = await pi.grep({ pattern: "AuthService", path: "src" })
return hits
```

Type checker 在外面包成：

```ts
async function __piFabricMain() {
  const hits = await pi.grep({ pattern: "AuthService", path: "src" })
  return hits
}
```

QuickJS 最后运行 `__piFabricMain()`，它 resolve 的 value 就成为 Fabric 的执行结果。

所以模型完全可以决定最终边界：

```ts
return rawEverything
```

也可以：

```ts
return {
  relevantFiles,
  findings,
  evidence,
}
```

Fabric 的 prompt guidance 会强烈鼓励后者，但不会凭空替一个写得很差的程序自动理解并重写结果。

---

## 8. 最准确的一句话

原来一句容易被误解的话是：

> 大量 `read` / `grep` / MCP 调用可以在一个模型回合内由 TypeScript 串并行执行，减少 `LLM → tool → LLM → tool` 的往返。

更严谨的版本应该是：

> **对于下一步可以由确定性控制流决定的 `read` / `grep` / MCP 操作，Fabric 可以在一次 `fabric_exec` 中串行或并行完成，中间结果保留在 sandbox；只有真正需要语义判断时，才回到主模型或调用 child agent / RLM，从而减少不必要的 `LLM → tool → LLM` 往返。**

也可以再压缩成一句：

> **Fabric 省掉的不是必要的思考，而是本来可以由程序完成、却让 LLM 每一步都充当调度器的思考。**
