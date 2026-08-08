# Fabric 如何参与 Pi Compaction

Fabric 的 compaction 不是简单的“让另一个 LLM 帮忙总结一下历史”。

它实际上做了两件不同但相关的事情：

1. **默认的 deterministic compaction**：在 Pi 的 compaction hook 上，用结构化、无 LLM 的方式重新构建旧上下文摘要。
2. **programmatic compaction**：允许模型或 Agent 主动提出“现在该 compact 了”，但真正执行必须等到 host 认为安全的边界。

所以理解 Fabric compaction 最重要的心智模型是：

> **Session log 是事实源，Context 只是一个有容量限制的缓存；Compaction 是重新构造这个缓存，而不是删除事实源。**

本文仍然基于固定源码快照：[`08019b6138e90466d2b4ebd1acedd3d2523eb164`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164)。

---

## 1. 为什么 Fabric 自己做 Compaction

普通 compaction 很容易理解成：

```text
旧 conversation
   ↓
LLM summarizer
   ↓
一段摘要
   ↓
继续聊天
```

这有几个天然问题：

- 每次 compact 又多一次模型调用和 token 成本；
- 摘要会受到模型随机性影响；
- 多次 summary-of-summary 容易发生语义漂移；
- 某些 tool call / tool result 的结构关系可能被自然语言总结抹掉；
- debugging 时很难精确回答“这句话到底是从哪一条历史来的”。

Fabric 默认选择另一条路线：

```text
raw session entries
      ↓
结构化 normalize
      ↓
确定性 project
      ↓
有界 render
      ↓
summary + recent raw tail
```

官方文档称之为：

> deterministic, LLM-free compaction

源码/文档：

- [`docs/compaction.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/docs/compaction.md)
- [`src/compaction/hook.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/hook.ts)

---

# 2. 默认是 Fabric Engine，也可以退回 Pi

Fabric 无条件注册自己的 compaction hook。

`src/index.ts` 里明确写着：

```text
Deterministic, LLM-free compaction is registered unconditionally
and is active by default.
```

配置：

```json
{
  "compaction": {
    "engine": "fabric"
  }
}
```

是默认方向。

如果想恢复 Pi 原生 compactor：

```json
{
  "compaction": {
    "engine": "pi"
  }
}
```

Fabric hook 会让开，由 Pi core 正常处理。

源码：

- [`src/index.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/index.ts)

---

# 3. Compaction 不是把全部历史压成一句话

Fabric 的输出是：

```text
Deterministic Summary
        +
Recent Raw Continuity Tail
```

也就是：

```text
很旧的历史
   ↓
结构化摘要

最近一段历史
   ↓
仍保留原始 message/tool context
```

Pi 的：

```text
keepRecentTokens
```

决定这个 recent raw tail 的连续性预算，官方文档给出的默认值是 20,000 tokens。

Fabric 另外有：

```text
compaction.targetContextRatio
```

默认 `0.65`。

但这里很容易误解：

> 它是 **post-compaction occupancy ceiling**，不是“目标要尽量填到 65%”。

也就是：

```text
≤ 65%
```

而不是：

```text
≈ 65%
```

Fabric 会同时考虑：

- context window
- Pi response reserve
- `keepRecentTokens`
- Fabric summary 大小
- pre-compaction token size
- token estimator 与真实 provider token 的校准差异

去求一个安全的 retained raw suffix。

---

# 4. 它的核心 Pipeline

官方给出的 Pipeline 非常值得直接记住：

```text
active branch entries
      │
      ├─► live window
      │      ↓
      │   calibrated token budget
      │      ↓
      │   closure-safe cut
      │      ↓
      │   firstKeptEntryId
      │
      └─► raw cumulative prefix
             ↓
          normalize
             ↓
           project
             ↓
         bound/render
```

可以理解成两个并行问题。

### A. 哪部分继续以 raw context 保留？

由：

```text
live window
→ token budget
→ cut
```

决定。

### B. 被 cut 掉的旧历史，摘要里保留什么？

由：

```text
raw cumulative prefix
→ normalize
→ project
→ render
```

决定。

这两个概念必须分开。

---

# 5. Live Cut 和 Cumulative Truth 是两回事

这是 Fabric compaction 比较聪明的一个设计。

假设已经 compact 过三次：

```text
Raw history A
Compact 1
Raw history B
Compact 2
Raw history C
Compact 3
```

一个简单实现可能每次都：

```text
上一份 summary
+
新的 raw history
   ↓
再 summary
```

这就是 summary chaining。

久了之后：

```text
事实
→ 摘要 1
→ 摘要 2
→ 摘要 3
```

误差会累积。

Fabric 的原则是：

> **Rendered summary 本身不是下一次 compaction 的 semantic truth。**

新的 summary 会尽量重新从 active branch 的 raw typed entries 构建 cumulative truth。

所以逻辑更像：

```text
raw entries ────────────┐
raw entries ────────────┼─► rebuild summary
raw entries ────────────┘

旧 rendered summary
       ╳ 不作为语义事实重新总结
```

这就是官方 invariants 里说的：

> Live cut and cumulative truth are separate.

以及：

> Rendered summaries are never semantic input.

---

# 6. 它不“理解”旧对话，而是从结构投影事实

这里和 LLM Summary 差异最大。

Fabric 的 deterministic compactor 主要依赖：

```text
entry type
message role
content part type
tool name
toolCallId
arguments
isError
exit code
file path
Fabric trace outcome
entry id
ordering
```

然后机械地构建 projection。

它明确避免使用：

```text
“看到这句话像 commit hash，所以记下来”
“看到 stdout 像错误，所以语义分类一下”
“看到代码里说 auth，所以判断这是重要架构信息”
```

官方文档甚至特别强调：

> Structure drives projection.

也就是说：

> **它不是一个聪明的 summarizer，而是一个尽量可靠、可复现的 session-state projector。**

这牺牲了一部分“语义理解能力”，换来：

- deterministic
- 可测试
- 可追踪
- 更不容易 summary drift
- 不需要额外 LLM call

---

# 7. Summary 里主要保留什么

当前源码快照中的主要 section 包括：

```text
[Session Goal]
[Compaction Request]
[Files And Changes]
[Fabric Activity]
[Outstanding Context]
[Earlier Turns]
[Current Status]
[Transcript]
[Footer]
```

分别倾向于保留：

### Session Goal

最开始的用户目标，以及之后重要的 scope change。

### Files And Changes

通过 typed file operations 得出的：

```text
Created
Written
Modified
Read
```

并保留 operation address。

### Fabric Activity

例如一个 named `fabric_exec`：

```text
name — description → outcome
```

以及重要 nested operation / phase。

### Outstanding Context

还没有被结构化后续操作明确解决掉的失败状态。

### Earlier Turns / Current Status / Transcript

提供更紧凑的连续性视图。

所以它更像：

```text
Goal
+
Effects
+
Operational state
+
Recent conversational continuity
```

而不是自然语言意义上的“把整个聊天总结一下”。

---

# 8. 为什么必须保证 Tool Call / Tool Result 不被切开

假设 context cut 恰好这样：

```text
旧 summary 区域：
assistant → toolCall(read A)

保留 raw 区域：
toolResult(read A)
```

模型重新看到 context 时就是：

```text
？？？
为什么突然出现一个 toolResult？
```

反过来也一样：

```text
保留 toolCall
但 result 被 summary 掉
```

也会破坏 conversation protocol。

所以 Fabric 会计算 call/result span，并拒绝把真实的一对 call/result 从中间切开。

源码：

- [`src/compaction/hook.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/hook.ts)

如果找不到满足预算同时又保持 structural closure 的 cut，Fabric 可以使用：

```text
compact-all
```

而不是留下半个 tool interaction。

这个细节很工程化，但非常重要。

---

# 9. “Source-lossless”是什么意思

官方用了一个很值得注意的表达：

> source-lossless and addressably lossless, not byte-for-byte lossless inside the model's bounded continuation view

可以拆成两件事。

### 模型当前 Context 不是无损的

旧的：

- 大段自然语言
- tool output body
- thinking
- 任意历史细节

不保证全部继续 inline 出现在模型 context。

否则就不叫 compaction 了。

### 但原始 Session Log 仍然是 Ground Truth

Fabric compaction：

```text
不会删除 raw session JSONL
不会把旧 raw entry 改写成 summary
```

summary 是新的 derived view。

而被省略的信息会尽量保留：

```text
entry id
source range
operation address
```

以后可以通过 memory / exact source expansion 找回。

所以整体模型是：

```text
                 Raw Session Log
                   Source of Truth
                         │
             ┌───────────┴───────────┐
             │                       │
     Deterministic Summary      Recent Raw Tail
             │                       │
             └───────────┬───────────┘
                         │
                    Main Context
                         │
                  exact detail needed
                         ↓
                  source expansion
```

这也是为什么它会说：

> Context is a cache, not the store.

---

# 10. 自动 Compaction Threshold

Fabric 还可以给不同模型配置单独 threshold：

```json
{
  "compaction": {
    "thresholds": {
      "anthropic/claude-sonnet-4-5": 0.8,
      "openai/gpt-5.4": 0.9
    }
  }
}
```

源码用 canonical：

```text
provider/model
```

作为 key。

每次 Main 到：

```text
agent_settled
```

Fabric 会检查当前 context usage；达到配置值时调用 `context.compact()`。

源码：

- [`src/compaction/threshold.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/threshold.ts)
- [`src/index.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/index.ts)

为什么选 `agent_settled`？

因为这是一个比较明确的安全边界：

```text
当前 turn 已结束
自动 retry / queued continuation 已经 settle
没有一半正在跑的 tool call
```

---

# 11. Programmatic Compaction：模型也可以主动说“现在该压缩了”

除了被 token threshold 被动触发，Fabric 还提供：

```ts
compact.request(...)
compact.status()
compact.cancel()
```

例如：

```ts
await compact.request({
  reason: "架构探索已经完成，接下来只需要修改 auth service",
  instructions: "保留 auth flow、待修改文件和失败测试。",
  preserve: [
    "当前 failing test: auth refresh regression",
    "主要文件: src/auth/service.ts",
  ],
})
```

但这里有一个非常重要的约束：

> `compact.request()` **不会立刻 compact**。

它只是：

```text
record intent
```

真正流程：

```text
LLM / Fabric Program
       ↓
compact.request
       ↓
CompactController.pending
       ↓
当前 turn 正常跑完
       ↓
agent_settled
       ↓
CompactController.maybeCommit()
       ↓
ExtensionContext.compact()
       ↓
Fabric deterministic compaction hook
```

源码：

- [`src/core/compact-controller.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/compact-controller.ts)
- [`src/providers/compact-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/compact-provider.ts)
- [`docs/programmatic-compaction.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/docs/programmatic-compaction.md)

Fabric 把这个模式叫：

> **advisory → committed**

也就是：

```text
模型决定：我认为现在值得 compact
Host 决定：什么时候安全地真正 compact
```

---

# 12. 为什么不能让模型在程序中直接立即 Compact

假设：

```ts
await pi.read(...)
await compactNow()
await pi.edit(...)
```

如果 `compactNow()` 真的能直接修改当前正在运行的 conversation/context，就会产生非常麻烦的 race：

```text
当前模型 turn 还没结束
Fabric guest 还在执行
nested tool 可能还没 settle
与此同时 session context 被重写
```

因此 Fabric 的原则是：

```text
model = advisory
host = enforcement
```

这和 Fabric 其他很多设计一致：

> Prompt 可以建议，但真正的生命周期安全性放在 Harness 里执行。

`CompactController` 自己的源码注释就直接强调：

```text
never mid-turn
never while a turn is in flight
```

---

# 13. Child Agent 也可以被要求 Compact

对于 Pi child，Fabric 还有：

```ts
agents.compact({
  id: handle.id,
  instructions: "保留 finding list，丢掉早期探索。"
})
```

它的逻辑同样不是：

```text
现在立刻打断 child → compact
```

而是把 compact request 放进 child control channel，等待 child 自己到：

```text
agent_settled
```

然后通过 Pi RPC 的 `compact` command 执行。

因此 child 可以：

```text
继续保留同一个 Agent session
+
缩小自己的 context
```

而不需要：

```text
stop old child
→ spawn new child
→ 重建任务上下文
```

需要注意：当前实现里这属于 **Pi runner 能力**。

Claude Code CLI 没有对应 compact RPC，所以 Claude-backed child 会明确拒绝 `agents.compact`。

---

# 14. Programmatic Compaction 和自动 Compaction 的关系

可以把它们理解成同一个底层 transition 的不同 trigger。

```text
                     context.compact()
                           │
                     Fabric Hook
                           │
              deterministic projection
                           │
             summary + recent raw tail
                           ▲
             ┌─────────────┴─────────────┐
             │                           │
     threshold trigger            model request
     context 太大                compact.request
             │                           │
      agent_settled                agent_settled
```

也就是说：

- 自动 threshold 解决 **“空间快不够了”**；
- programmatic request 解决 **“任务阶段已经切换，现在压缩更合适”**。

后者很有意思，因为它把 compaction 从：

```text
OOM prevention
```

提升成：

```text
agent context lifecycle primitive
```

---

# 15. Compaction 和 Context Economy 不是一回事

这两个概念很容易混。

[`context-economy.md`](./context-economy.md) 讲的是：

```text
尽量让无意义的大量中间数据
从一开始就不要进入 Main LLM context
```

比如：

```text
100 次 read result
→ QuickJS 内部 filter
→ 只 return 5 个 finding
```

而 Compaction 处理的是：

```text
已经进入 Main Conversation 的长期历史越来越大
```

所以：

```text
Context Economy
→ 少制造 context

Compaction
→ 管理已经积累的 context
```

两者组合起来才完整：

```text
          少输入噪音
             ↓
       Context Economy
             ↓
       长期运行以后
             ↓
         Compaction
             ↓
       继续保持可用窗口
```

---

# 16. 它会丢东西吗？会，但丢法是明确的

Compaction 不可能完全不丢当前模型可见内容。

Fabric 明确不保证旧的：

- thinking
- 任意 prose
- 完整 tool output bodies
- 所有历史 assistant wording

继续 inline 存在。

所以不要把：

```text
source-lossless
```

理解成：

```text
model context 100% 原样无损
```

它真正保证的方向是：

```text
raw source 仍在
+
summary 有稳定地址
+
重要 typed operational facts 被机械投影
+
近期 raw tail 保持自然连续性
```

这是一种很不同的 trade-off：

> **牺牲旧 context 的完整可见性，换取可持续的 bounded context，同时把 exact recall 的责任交回 source log。**

---

# 17. 最终心智模型

```text
                   Pi Session JSONL
                    Ground Truth
                         │
          ┌──────────────┴──────────────┐
          │                             │
     old cumulative history        recent history
          │                             │
     normalize/project                   │
          │                             │
 deterministic summary              raw tail
          │                             │
          └──────────────┬──────────────┘
                         │
                  Active Context
                         │
              context keeps growing
                         │
             ┌───────────┴───────────┐
             │                       │
        threshold trigger       compact.request
             │                       │
             └────── agent_settled ──┘
                         │
                    compact again
```

所以 Fabric compaction 最核心的设计并不是“摘要写得更聪明”，而是：

> **把 Context 当成从 Session Log 派生出来、可以安全重建的 bounded working set。**

---

## 相关源码

- [`docs/compaction.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/docs/compaction.md)
- [`docs/programmatic-compaction.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/docs/programmatic-compaction.md)
- [`src/compaction/hook.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/hook.ts)
- [`src/compaction/normalize.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/normalize.ts)
- [`src/compaction/projections.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/projections.ts)
- [`src/compaction/render.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/render.ts)
- [`src/compaction/threshold.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/compaction/threshold.ts)
- [`src/core/compact-controller.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/core/compact-controller.ts)
- [`src/providers/compact-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/compact-provider.ts)
- [`src/agents/compact-control.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/agents/compact-control.ts)
- [`src/index.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/index.ts)
