# Actors、Mesh 与 Participant Topology

这一篇专门拆 Fabric 里比较容易混在一起的三个概念：

- **Agent**：一次性或有明确生命周期的任务执行者。
- **Actor**：有身份、有持续上下文、有串行 mailbox，并且可以被事件长期唤醒的参与者。
- **Mesh**：让 Main、Agent、Actor、其他 Pi session 之间进行持久协调的项目级基础设施。

如果只记一句话：

> **Agent 更像一次 run，Actor 更像长期存在的 participant，而 Mesh 是这些 participant 之间的 durable coordination substrate。**

本文仍然基于固定源码快照：[`08019b6138e90466d2b4ebd1acedd3d2523eb164`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164)。

---

## 1. Agent 和 Actor 的区别

普通 child agent 的核心生命周期比较简单：

```text
spawn / run
   ↓
执行任务
   ↓
completed / failed / stopped / timed_out
   ↓
结束
```

它当然可以保留 run directory、日志、worktree，也可以通过 `agents.steer()` 在运行中继续给消息，但它的本质仍然是一个任务 run。

Actor 不一样。

`ActorManager` 里的一个 managed actor 会长期保存：

- `id / name / rootId`
- `instructions`
- `status`
- 订阅的 Pi host `events`
- 订阅的 Mesh `topics`
- `delivery / responseMode / triggerTurn`
- `coalesce`
- `residency`
- 固定的 `runner / model / thinking / tools / transport`
- 自己的 `sessionFile`
- 串行 `queue`
- 历史 `messages`

源码：

- [`src/actors/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/actors/manager.ts)
- [`src/actors/types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/actors/types.ts)

所以更准确地说：

```text
Agent
= task + process/run lifecycle

Actor
= identity
+ persistent session
+ serial mailbox
+ event/topic subscriptions
+ repeated activations
```

---

## 2. Actor 是怎么被唤醒的

Actor 的 activation 大体有三种来源：

```text
hostEvent
  Pi 生命周期事件

direct
  tell / ask / steer / followUp 等直接消息

mesh
  某个 durable topic 上出现事件
```

`FabricActorActivation` 在源码里也直接区分为：

```ts
type FabricActorActivation =
  | { kind: "hostEvent"; ... }
  | { kind: "direct"; ... }
  | { kind: "mesh"; ... }
```

例如一个 Actor 可以订阅：

```ts
await agents.create({
  name: "review-supervisor",
  instructions: "持续关注 review 结果，并在需要时提醒 Main。",
  events: ["agent_settled", "tool_error"],
  topics: ["team.review"],
})
```

以后无论是：

```text
Main 产生 agent_settled
```

还是：

```text
mesh.publish({ topic: "team.review", ... })
```

都可以成为这个 Actor 的 activation。

这也是 Actor 和普通 `agents.run()` 最大的语义区别之一：

> **Actor 不是“调用一次模型”，而是“定义一个以后还能继续被唤醒的参与者”。**

---

## 3. 为什么 Actor 要有串行 Mailbox

Actor 内部维护自己的 queue，并且按顺序处理。

可以把它理解成经典 Actor Model 的简化工程实现：

```text
message A ─┐
message B ─┼─► mailbox
message C ─┘
                ↓
             一次处理一个
                ↓
           同一个 actor session
```

这样做最重要的好处不是性能，而是**状态连续性和顺序性**。

如果同一个 Actor 同时处理 3 个 activation，并且都在修改自己的上下文，就很容易产生：

- session 竞争
- 消息顺序不稳定
- 同一状态被并发覆盖
- 两个 model turn 都以为自己是“最新状态”

所以 Actor 更接近：

```text
persistent state machine
+
LLM-backed handler
```

而不是一个普通 Promise worker pool。

Actor 默认还支持 `coalesce`，对于重复 host event 可以减少无意义的重复 activation。

---

## 4. Actor 的 Context 为什么能持续

Actor 有自己的 `sessionFile`。

Pi runner 的 Actor 后续 activation 会继续使用 Fabric 管理的 Pi session；Claude runner 则保存 Claude session id，后续通过 Claude Code 的 resume 能力继续。

因此它不是：

```text
事件来了
→ 新开一个完全空白 LLM
→ 把所有历史重新塞一遍
```

而更像：

```text
Actor Session
  turn 1
  turn 2
  turn 3
     ↑
新的 activation 继续进入这里
```

这使得 Actor 更适合：

- supervisor
- 长期 review/watch
- release coordinator
- migration coordinator
- 收集多个 Agent 输出之后再逐步处理

如果任务就是一次性的，通常没必要创建 Actor，直接 `agents.run()` / `agents.spawn()` 更简单。

---

## 5. Session Residency 和 Durable Residency

Fabric 把 participant 的 residency 分成：

```ts
"session" | "durable"
```

### `session`

默认行为。

Actor / Agent 的执行 ownership 绑定当前 Pi host。

```text
Main Pi process
   ├─ Agent
   └─ Actor
```

当前 host 结束后，它们不会继续作为独立常驻后台工作。

### `durable`

如果指定：

```ts
residency: "durable"
```

Fabric 可以把 participant 的实际执行 ownership 转移到一个隐藏的 resident host。

```text
Main Pi
  │
  │ 创建 durable actor/agent
  ▼
Resident Host
  ├─ Durable Agent
  └─ Durable Actor

Main Pi 可以退出
```

真正负责这个能力的是 residency 子系统：

- [`src/residency/client.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/residency/client.ts)

它会按需启动一个隐藏 host，并通过文件 + Mesh participant directory 管理 owner、request、response 和 delivery。

这意味着：

> **“Actor 是 persistent”不等于“一定有 daemon 永远运行”。**

Actor 的定义、session、mailbox 可以持久化；是否让执行真正脱离当前 Main host 继续运行，由 residency 决定。

---

# 6. Mesh 到底是什么

Mesh 不是 Multi-Agent Planner。

它更接近一个非常小的、本地项目级：

```text
Event Log
+
Versioned Shared State
+
Participant Directory
+
Control Plane
```

官方 model-facing reference 直接把它定义成：

> project-scoped, event-sourced coordination substrate

参考：

- [`skills/fabric-exec/references/mesh.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/skills/fabric-exec/references/mesh.md)

默认数据位于：

```text
<project>/.pi/fabric/mesh/
```

底层 `MeshStore` 使用的核心文件包括：

```text
events.jsonl
state.json
sequence
generation
.lock
```

源码：

- [`src/mesh/store.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/mesh/store.ts)

所以它本质上并不是 Redis、NATS 或数据库服务器。

它是 Fabric 为本地 Agent 协作提供的一套文件系统 durable coordination layer。

---

## 7. Mesh Topics：持久事件通道

Guest API 暴露：

```ts
mesh.publish(...)
mesh.read(...)
```

例如：

```ts
await mesh.publish({
  topic: "team.auth",
  kind: "finding",
  text: "refresh token rotation 可能存在竞争条件",
  data: { path: "src/auth/refresh.ts" },
})
```

底层会产生带 sequence 的事件：

```ts
{
  id,
  sequence,
  topic,
  kind,
  from,
  to?,
  text?,
  data?,
  createdAt
}
```

因为有单调 sequence，所以另一个 participant 可以：

```ts
mesh.read({
  after: lastSequence,
  topic: "team.auth"
})
```

继续消费后续事件。

这比单纯内存中的 EventEmitter 多了一件很关键的东西：

> **事件可以在 participant 生命周期之外继续存在。**

这也是 persistent actors 能够跨 session 恢复后继续接着处理 topic 的基础之一。

---

## 8. Mesh Shared State：带版本的共享状态

除了 event log，Mesh 还有：

```ts
mesh.get(...)
mesh.put(...)
mesh.delete(...)
mesh.list(...)
```

每个 state entry 结构大致是：

```ts
{
  key,
  value,
  version,
  updatedAt,
  updatedBy,
}
```

其中比较重要的是：

```ts
ifVersion
```

也就是 optimistic compare-and-swap。

例如两个 Agent 都想领取一个任务：

```ts
const task = await mesh.get({ key: "tasks/auth-review" })

await mesh.put({
  key: task.key,
  value: {
    status: "claimed",
    owner: self.id,
  },
  ifVersion: task.version,
})
```

只有基于当前 version 的写入能成功。

所以 Mesh state 可以用来表达：

- task claim
- lease
- reservation
- shared decision
- distributed progress

而不需要模型通过自然语言猜“是不是已经有人做了”。

这也是 Fabric 比“多个 sub-agent 然后 Promise.all”更进一步的地方：

> 它开始具备真正的 coordination state。

---

# 9. Participant Directory：统一描述 Main、Agent 和 Actor

Fabric 后来的设计里，Main / Peer / Agent / Actor 并不是四套完全不同的注册系统。

内部 canonical participant kind 是：

```ts
type FabricParticipantKind =
  | "root"
  | "agent"
  | "actor"
```

源码：

- [`src/topology/types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/types.ts)

Participant record 包含几个特别重要的字段：

```text
id
kind
rootId
parentId?
ownerHostId
ownerIdentityId
residency
status
capabilities
```

其中要区分两种关系。

### Lineage

```text
rootId
parentId
```

描述：

> “它属于哪个 Agent 树？”

例如：

```text
Main root
  └─ Agent A
       └─ Recursive Agent B
```

### Execution ownership

```text
ownerHostId
ownerIdentityId
```

描述：

> “现在究竟哪个进程负责执行和控制它？”

这两个关系不是一回事。

例如一个 durable actor：

```text
逻辑 lineage:
Main Root
  └─ Actor

实际 execution owner:
Resident Host
```

这是理解 Fabric distributed topology 最关键的一点。

---

## 10. Main 和 Peer 其实只是 Root Participant 的 View

源码里的 participant kind 并没有：

```text
main
peer
```

canonical kind 是：

```text
root
```

而：

```ts
agents.main()
agents.peers()
```

是从 root participant 派生出来的兼容 / UI view。

`ParticipantDirectory` 会维护 participant records 和 host records：

```text
topology/participants/*
topology/hosts/*
```

源码：

- [`src/topology/participant-directory.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/participant-directory.ts)

所以另一份 Pi session 出现在 `agents.peers()` 里，本质上是：

> ParticipantDirectory 发现了另一个 live root。

而不是 Fabric 单独维护了一个“Peer Agent 类型”。

---

# 11. Host Lease：怎么知道一个 Participant 还活着

Participant Directory 把：

```text
participant record
```

和：

```text
execution host lease
```

分开。

当前源码默认有：

```text
heartbeat: 5s
lease: 15s
```

如果一个 host crash，lease 过期，那么它拥有的 participant 会被统一视为 stale。

这比：

```text
每个 agent 自己写一个 alive=true/false
```

可靠一些，因为 crash 时进程通常来不及逐一把所有 child 标记成 dead。

Fabric 的做法相当于：

```text
Host X expired
   ↓
所有 ownerHostId = X 的 participant
   ↓
stale
```

因此 normal discovery 默认排除 stale participant，而诊断场景可以：

```ts
agents.members({ includeStale: true })
```

查看。

---

# 12. Cross-process control 不是简单 `mesh.publish("stop")`

如果要控制另外一个 host 拥有的 participant，Fabric 不建议自己发布一个普通 topic。

应该调用：

```ts
agents.steer(...)
agents.followUp(...)
agents.stop(...)
```

内部会走 `FabricControlPlane`：

```text
Sender
  ↓
ParticipantDirectory
  ↓ resolve ownerHostId
fabric.control.command
  ↓
Owner Host
  ↓ execute locally
fabric.control.ack
  ↓
Sender
```

源码：

- [`src/topology/control-plane.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/control-plane.ts)

它不是 fire-and-forget broadcast，而是：

- 指向具体 owner host
- 带 command id
- 验证 target / owner identity
- 等待 acknowledgement
- 对已处理 command 做 seen/claim 记录

因此：

> **Mesh 是数据通道；ControlPlane 是建立在 Mesh 上的、带 ownership/ACK 语义的控制协议。**

---

# 13. Lifecycle Broker：Participant 可以订阅另一个 Participant 的生命周期

Fabric 还在 Mesh 上构建了 `LifecycleBroker`。

例如：

```ts
await agents.subscribe({
  from: worker.id,
  events: ["pi.agent_settled"],
  to: "main",
  delivery: "followUp",
  triggerTurn: true,
})
```

这意味着：

```text
Worker settled
   ↓
lifecycle event
   ↓
Mesh
   ↓
subscription
   ↓
Main follow-up
```

而不需要主模型不断：

```text
status?
status?
status?
```

源码：

- [`src/lifecycle/broker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/lifecycle/broker.ts)

这个能力其实和 Context Economy 是同一类工程思想：

> 能让 runtime 用事件和状态解决的事情，就不要让主 LLM 反复轮询。

---

# 14. 最终的心智模型

可以把这一套画成：

```text
                    Project
                      │
          ┌───────────┴────────────┐
          │                        │
 Participant Topology            MeshStore
          │                        │
  ┌───────┼────────┐          ┌────┴─────┐
  │       │        │          │          │
 Root    Agent     Actor     Events     State
  │       │        │       topics      CAS
  │       │        │          │          │
  └───────┴────────┘          └────┬─────┘
          │                         │
          └──────────┬──────────────┘
                     │
               ControlPlane
             steer/followUp/stop
                     │
                ownerHostId
```

从职责看：

```text
ParticipantDirectory
→ 谁存在、属于谁、谁负责执行

Mesh Topics
→ 发生了什么

Mesh State
→ 当前共享状态是什么

ControlPlane
→ 如何可靠控制另一个 participant

ActorManager
→ 如何让一个 LLM participant 长期存在并持续接收事件

Residency
→ 当前 Main 退出后，谁继续负责 durable participant
```

这就比简单的“Multi-Agent”三个字具体得多。

---

## 15. 什么时候该用哪一个

| 需求 | 更合适的能力 |
|---|---|
| 一次性分析一个模块 | `agents.run()` |
| 后台执行一个耗时任务 | `agents.spawn()` |
| 同一个角色需要长期积累上下文 | Actor |
| 需要监听 Pi 生命周期或某个 Topic | Actor |
| 多个 Agent 要交换 finding | Mesh Topic |
| 多个 Agent 要竞争任务 ownership | Mesh State + CAS |
| Main 要控制远端 participant | `agents.steer/followUp/stop` + ControlPlane |
| Main 退出后仍需要继续执行 | Durable residency |
| 等另一个 Agent 完成后自动继续 | Lifecycle subscription |

所以并不是所有任务都应该上 Actor + Mesh。

很多普通 coding task：

```text
fabric_exec
+
agents.run
```

已经足够。

Actor / Mesh 真正开始有价值，是当任务从：

> “完成一次工作”

变成：

> “多个长期参与者需要跨 turn / session 协调状态和事件”。

---

## 相关源码

- [`src/actors/manager.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/actors/manager.ts)
- [`src/actors/types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/actors/types.ts)
- [`src/mesh/store.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/mesh/store.ts)
- [`src/providers/mesh-provider.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/providers/mesh-provider.ts)
- [`src/topology/types.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/types.ts)
- [`src/topology/participant-directory.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/participant-directory.ts)
- [`src/topology/control-plane.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/topology/control-plane.ts)
- [`src/lifecycle/broker.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/lifecycle/broker.ts)
- [`src/residency/client.ts`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/src/residency/client.ts)
- [`docs/agents.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/docs/agents.md)
- [`skills/fabric-exec/references/mesh.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/skills/fabric-exec/references/mesh.md)
