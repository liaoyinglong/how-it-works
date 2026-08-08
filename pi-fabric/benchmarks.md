# 如何验证 Fabric 是否真的更快、更省 Token

前面的文档可以从架构上解释 Fabric **为什么可能**减少 Main LLM 的 tool round-trip、model-visible result volume 和部分 context 占用。

但这些都不能直接等价成：

> “Fabric 一定更快”

或者：

> “Fabric 一定更省总 Token”。

真正要回答这两个问题，必须做 paired benchmark。

这篇文档分成两部分：

1. 上游 `pi-fabric` 已经提供了哪些 benchmark infrastructure；
2. 如果我们专门想验证 repo search / bulk read / code review 这些 Fabric 最典型的场景，应该怎么设计实验。

> **当前这份分析没有伪造一组新的 paid benchmark 数值。** 固定源码快照里已经有真实 benchmark harness，但本仓库目前还没有记录一轮我们自己控制变量跑出来的结果。因此下面会明确区分“已有测量框架”“历史参考数据”和“待实测结果”。

本文仍然基于固定源码快照：[`08019b6138e90466d2b4ebd1acedd3d2523eb164`](https://github.com/monotykamary/pi-fabric/tree/08019b6138e90466d2b4ebd1acedd3d2523eb164)。

---

# 1. 先明确到底要测什么

如果只看：

```text
总 Token 少了多少
```

很容易得出错误结论。

Fabric 的价值至少要同时观察四类指标。

## A. 任务质量

```text
solve / reward
partial reward
known findings recall
false positive
测试是否通过
```

这是第一优先级。

如果：

```text
Token -40%
但正确率明显下降
```

那不叫优化。

---

## B. Token / Context

至少区分：

```text
总 Token
fresh input
cached input
output
peak context
model-visible result chars
```

尤其要区分：

> **Main Context 变小** 和 **系统总 Token 变少** 不是一回事。

例如 RLM / child agent 可能让 Main 只看到 5 KB summary，但 child 自己又消费了 50K tokens。

所以：

```text
Main context ↓
```

不自动推出：

```text
Total tokens ↓
```

---

## C. Control-flow 开销

Fabric 最直接应该改善的指标包括：

```text
Main turns
outer tool calls
nested tool calls
tool round-trips
```

例如：

```text
Baseline:
LLM → grep → LLM → read → LLM → read → LLM

Fabric:
LLM → fabric_exec(grep/read/read/filter) → LLM
```

这里即使总 filesystem operation 数量一样：

```text
3 次工具操作
```

Main model round-trip 仍然可能显著下降。

---

## D. Wall-clock / I/O Pathology

要观察：

```text
agent wall time
whole-file read rate
bounded read rate
results > 50 KB
max result chars
```

因为 Fabric 的 `Promise.all` 能否带来速度收益，本质取决于任务能否并行。

同样：

```text
read 很多文件
```

本身不是问题。

真正的问题可能是：

```text
大量无界 whole-file read
+
大结果反复送进 Main model
```

---

# 2. 上游其实已经有一套 paired benchmark

固定源码快照里存在：

```text
bench/
```

官方描述是：

> Local, paired before/after benchmark for measuring Fabric's token-efficiency regressions against plain Pi.

入口：

- [`bench/README.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/README.md)

它不是简单跑：

```text
time pi ...
```

而是给 baseline 和 Fabric 相同任务，然后用 verifier 判断最终结果。

典型 cell：

```text
(task, config, rep)
```

其中：

```text
config = baseline | fabric-local | fabric-<version>
```

---

# 3. Baseline 是真的 stock Pi

`bench/run-cell.sh` 中：

```text
baseline
→ --no-skills --no-extensions

fabric-local
→ -e <pi-fabric repo>
```

并且每个 cell 都会：

```text
fresh checkout
→ run agent
→ 保存 session JSONL
→ 保存 patch
→ run verifier
→ 提取 metrics
```

源码：

- [`bench/run-cell.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-cell.sh)
- [`bench/run-matrix.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-matrix.sh)

这种 paired 设计比随便比较两次聊天可靠很多，因为至少能固定：

- repo base ref
- task prompt
- model
- thinking level
- verifier
- config difference

---

# 4. 上游 Benchmark 当前测哪些指标

固定快照的 `bench/README.md` 列出了：

```text
reward_binary
reward_partial
combined_total_tokens
input/cached/output token breakdown
combined_cost_usd
agent_wall_s
turns
tool_calls
patch_bytes
```

另外还有 read pathology：

```text
total reads
whole-file read share
results over 50 KB
```

Fabric cell 比普通 baseline 多一个重要的数据源：

```text
fabric_exec details.trace.operations
```

所以即使 Main conversation 里只出现：

```text
1 次 fabric_exec
```

分析脚本仍然可以知道内部实际上执行了多少：

```text
pi.read
pi.grep
pi.bash
...
```

对应分析：

- [`bench/analyze.py`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/analyze.py)

这点很关键，否则只数 Main tool calls 会误以为：

```text
Fabric 只调用了 1 个 Tool
```

而忽略它内部可能做了 30 个 nested operation。

---

# 5. 它甚至做 Paired Delta，而不是只看平均数

`analyze.py` 会按：

```text
(task, rep)
```

把 baseline 和 Fabric 配成 pair。

然后分析：

```text
solve flips
McNemar test
median token delta
mean token delta
```

这比：

```text
Baseline 平均 100K
Fabric 平均 80K
```

更有意义，因为不同 coding task 的 token 规模差异可能非常大。

Paired comparison 看的是：

> **同一个任务、同一个 repetition 下，打开 Fabric 后发生了什么变化。**

---

# 6. 官方还准备了 DeepSWE / Pier Matrix

`bench/README.md` 还提供了更完整的 DeepSWE matrix。

入口：

- [`bench/run-deepswe-matrix.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-deepswe-matrix.sh)
- [`bench/analyze_pier.py`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/analyze_pier.py)

固定快照中的默认：

```text
3 attempts
1 concurrent trial
```

并且有：

```text
8-task canary
36-task full matrix
```

两种规模。

在两个 config：

```text
baseline
fabric-local
```

都跑 3 attempts 时，对应：

```text
8 × 3 × 2 = 48 cells
36 × 3 × 2 = 216 cells
```

源码也专门规定：

```text
>24 paid cells
```

需要显式 confirmation，防止不小心烧掉大量预算。

---

# 7. Pier 版本记录的指标更接近我们真正关心的问题

`analyze_pier.py` 里可以看到：

```text
reward
partial
tokens
fresh_tokens
cache_tokens
output_tokens
cost_usd
peak_context_tokens
agent_wall_s
steps
outer_calls
nested_calls
fabric_failures
whole_reads
bounded_reads
visible_result_chars
max_result_chars
results_over_50kb
```

这里最值得关注的是：

```text
outer_calls
nested_calls
peak_context_tokens
visible_result_chars
```

因为它们可以真正回答：

> Fabric 是不是只是“把 Tool Call 藏起来了”，还是 Main 的 context / orchestration 开销真的变小了？

---

# 8. 还有一个专门测 Compaction Resume 的 Benchmark

上游还有：

```text
scripts/benchmark-real-resume.mjs
```

package script：

```bash
pnpm benchmark:real-resume
```

源码：

- [`scripts/benchmark-real-resume.mjs`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/scripts/benchmark-real-resume.mjs)
- [`package.json`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/package.json)

这个 benchmark 会比较：

```text
baseline
fabric compactor
pi-vcc
```

然后在一个 seeded resume task 上测：

```text
summaryBytes
tokens
costUsd
toolCalls
recallCalls
wallMs
oracle / diff
```

它更偏验证：

> compact 以后，Agent 是否还能正确恢复任务并完成工作。

和单纯测 `fabric_exec` 的速度不是同一个 benchmark。

---

# 9. 不应该直接拿 README 里的历史数字当“当前 Fabric 成绩”

上游 `bench/README.md` 提到过一组 archived trajectory 的 read-pathology 数字：

```text
1505 reads
78.5% whole-file reads
79 results over 50 KB
```

但 README 里的语义是：

> 当前 analyzer 能复现那份历史 trajectory 中已经发布的统计。

它不是在说：

```text
当前 0.40.3 Fabric 比 baseline 改善了 X%
```

所以这份仓库不会把这三个数字拿来证明当前 Fabric 的收益。

要证明当前版本收益，还是应该跑当前：

```text
baseline vs fabric-local
```

paired matrix。

---

# 10. 我们真正应该补的 Microbench

DeepSWE 很完整，但它比较重，而且一个 coding task 中混合了：

```text
理解
搜索
编辑
测试
修复
重试
```

如果目的是理解 Fabric 的 programmatic tool calling 到底有没有优势，建议另外做一组更小、更可解释的 microbenchmark。

我建议至少有 4 类。

---

## A. Repo Search

任务例子：

> 找出这个 repo 中 authentication flow 的入口、service、token issuance 和 middleware，并给出文件 + symbol 证据，不修改代码。

观察：

```text
正确文件召回率
Main turns
outer tool calls
nested calls
total tokens
peak context
wall time
visible result chars
```

这个任务主要测试：

```text
grep/find
→ 根据结果动态 read
→ 再 grep/read
→ 汇总
```

也就是 Fabric 最典型的：

```text
deterministic exploration stage
```

---

## B. Bulk Read / Aggregation

任务例子：

> 扫描 200 个 component，统计哪些使用 useEffect、哪些有 cleanup、哪些调用 fetch，并只返回聚合表。

这里非常适合验证：

```text
Promise.all
+
QuickJS map/filter/reduce
+
compact return
```

需要观察：

```text
whole-file read ratio
bounded read ratio
nested read count
Main-visible chars
Main turns
wall time
```

如果 Fabric 在这种任务上都没有明显减少 Main-visible intermediate data，那么 Context Economy 的核心假设就需要重新检查。

---

## C. Code Review

准备一个固定 commit，里面已知有 N 个问题。

Prompt：

> Review this diff/repo for concrete bugs. Return only issues with file/line/evidence.

Oracle：

```text
known issue recall
false positive count
```

同时测：

```text
tokens
wall
reads
result volume
turns
```

这个任务重要是因为它同时包含：

```text
程序化搜索
+
真正的 LLM 语义判断
```

它能测试 Fabric 的边界：

> 能省掉多少调度型往返，而不损伤真正需要模型 reasoning 的步骤？

---

## D. Simple Edit Control Group

必须有一个 Fabric 理论上不占优势的 control task。

例如：

> 把一个组件中的按钮文案从 A 改成 B，并运行一个指定测试。

这里大概只需要：

```text
read
edit
test
```

这种任务如果 Fabric 多了：

```text
生成 TS
TypeScript check
QuickJS startup
Host Bridge
```

反而可能：

```text
持平
或稍慢
```

这是正常的。

没有 control group，就很容易做出：

> “Fabric 在我们特意挑的 Fabric-friendly workload 上更好，所以所有 coding task 都应该用 Fabric。”

这种过度结论。

---

# 11. 推荐的 Microbench Matrix

| Task | Baseline | Fabric | Reps | 主要观察 |
|---|---:|---:|---:|---|
| repo-search | ✓ | ✓ | ≥5 | round-trip / context / recall |
| bulk-read | ✓ | ✓ | ≥5 | parallelism / result volume |
| code-review | ✓ | ✓ | ≥5 | quality / token / search behavior |
| simple-edit | ✓ | ✓ | ≥5 | Fabric overhead control |

如果成本允许，可以增加：

```text
Fabric code mode only
Fabric + child agent
Fabric + RLM
```

但不要第一轮就把这些混在一起。

第一轮最重要的是单独验证：

> **programmatic tool execution 本身**。

否则：

```text
Fabric + RLM token 变高
```

你无法判断到底是 `fabric_exec` 的问题，还是 recursive agent 的额外模型开销。

---

# 12. 控制变量

每一对 baseline/Fabric 必须尽量固定：

```text
同一个 model
同一个 thinking level
同一个 prompt
同一个 repo commit
同一个 tool permission
同一个 verifier
同一类 cache 条件
```

最好每个 repetition 都：

```text
fresh checkout
fresh session
```

并随机/交替运行顺序：

```text
rep1: baseline → fabric
rep2: fabric → baseline
rep3: baseline → fabric
...
```

避免：

- provider 负载变化
- network 时段变化
- cache warming
- OAuth/session 状态

全部单向偏向某一组。

---

# 13. Cold Cache 和 Warm Cache 最好分开

现代模型调用中：

```text
fresh input token
cached input token
```

价格和延迟可能完全不同。

所以应该至少记录：

```text
fresh_input
cache_read
cache_write
```

不要只看：

```text
totalTokens
```

一个方案如果：

```text
总 token 一样
但大量变成 cache read
```

成本可能下降。

反过来，一个方案如果靠不断 spawn child：

```text
重复 system prompt
重复 tool schemas
```

则 fresh token 可能增加。

---

# 14. 我最关心的 8 个指标

如果最后只保留一个 benchmark summary table，我建议是：

| Metric | 为什么重要 |
|---|---|
| Solve / Reward | 优化不能牺牲质量 |
| Total Tokens | 总模型资源开销 |
| Fresh Input Tokens | 真正新增输入成本 |
| Peak Context Tokens | Main / Agent context 压力 |
| Main Outer Tool Calls | 主模型作为 scheduler 的程度 |
| Nested Tool Calls | Fabric 实际做了多少底层操作 |
| Model-visible Result Chars | 中间数据是否真的被挡在 runtime 内 |
| Wall Time | 用户最终感受到的速度 |

补充诊断：

```text
whole-file read rate
results > 50KB
Fabric failures
compactions
```

---

# 15. Result Table 模板

在真正跑完之前，应该保持 `TBD`，不要填猜测数字。

### Repo Search

| Metric | Baseline | Fabric | Delta |
|---|---:|---:|---:|
| Success / Recall | TBD | TBD | TBD |
| Median total tokens | TBD | TBD | TBD |
| Median peak context | TBD | TBD | TBD |
| Median outer calls | TBD | TBD | TBD |
| Median nested calls | N/A / direct | TBD | TBD |
| Median visible result chars | TBD | TBD | TBD |
| Median wall time | TBD | TBD | TBD |

### Bulk Read

| Metric | Baseline | Fabric | Delta |
|---|---:|---:|---:|
| Correct aggregate | TBD | TBD | TBD |
| Total reads | TBD | TBD | TBD |
| Whole-file read rate | TBD | TBD | TBD |
| Main turns | TBD | TBD | TBD |
| Total tokens | TBD | TBD | TBD |
| Wall time | TBD | TBD | TBD |

### Code Review

| Metric | Baseline | Fabric | Delta |
|---|---:|---:|---:|
| Known issue recall | TBD | TBD | TBD |
| False positives | TBD | TBD | TBD |
| Total tokens | TBD | TBD | TBD |
| Peak context | TBD | TBD | TBD |
| Wall time | TBD | TBD | TBD |

---

# 16. 运行上游本地 Matrix

以下命令是在 **pi-fabric 上游源码仓库** 中运行，不是本 `how-it-works` 文档仓库。

例如：

```bash
./bench/run-matrix.sh \
  --tasks scc-bounded-memory-spilling \
  --configs baseline,fabric-local \
  --reps 3 \
  --run-id fabric-current
```

固定快照中的一个任务定义示例：

- [`bench/tasks/scc-bounded-memory-spilling/task.json`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/tasks/scc-bounded-memory-spilling/task.json)

最后：

```text
bench/results/<run-id>/analysis-summary.json
```

会得到 paired summary。

---

# 17. DeepSWE 先 Dry Run

上游提供：

```bash
PIER_DRY_RUN=1 \
./bench/run-deepswe-matrix.sh \
  bench/subsets/deepswe-canary-8.txt \
  both
```

确认 cell 数、task 和 command 没问题后，再决定是否执行 paid matrix。

因为完整 matrix 成本可能不低，源码也刻意给大矩阵加了显式 confirmation gate。

---

# 18. 在真正得到数字之前，哪些结论可以说，哪些不能说

### 从源码可以合理推断

对于：

```text
大量独立 read / grep / MCP
```

Fabric 能：

```text
在一次 guest program 内并行
+
减少 Main LLM round-trip
+
把中间 raw result 留在 runtime
```

所以这类 workload **有明确的优化机会**。

---

### 不能仅从源码推出

不能直接声称：

```text
总 token 一定下降 X%
wall time 一定提升 X%
所有 repo task 都更快
质量一定不下降
```

因为：

- 模型可能生成很差的 Fabric program；
- Fabric 自己有 typecheck / QuickJS / bridge overhead；
- 某些 read 可能还是 whole-file；
- 真正需要语义判断的任务仍要 model turn；
- RLM / child agents 会额外消费 token；
- parallel calls 可能受磁盘 / server / MCP 限流影响。

---

# 19. 当前最合理的 Hypothesis

在还没跑我们自己的 paired microbench 之前，可以保留以下**待验证假设**：

### Hypothesis 1

```text
Bulk deterministic exploration
```

应该是 Fabric 最强的场景。

原因：

```text
并行
程序 filter
少 Main round-trip
少 model-visible raw output
```

### Hypothesis 2

```text
Simple one-file edit
```

Fabric 收益可能很小，甚至有 runtime overhead。

### Hypothesis 3

```text
Complex semantic review
```

Fabric 主要优化信息获取和调度，真正 reasoning token 不会凭空消失。

### Hypothesis 4

```text
RLM / Council / Swarm
```

可能降低 Main Context 压力，但系统总 token 不一定下降，甚至可能增加。

这些都应该由 benchmark 验证，而不是写成产品结论。

---

# 20. 最终我们真正想回答的问题

Benchmark 最终不是为了证明：

> Fabric 好不好。

而是建立一个 workload map：

```text
什么任务
   ↓
使用 Fabric 的哪一层
   ↓
会带来什么收益 / 成本
```

最后理想结果应该类似：

```text
simple edit
→ direct tools

repo-wide deterministic search
→ fabric_exec

large semantic decomposition
→ fabric_exec + selective agent/RLM

long-lived coordination
→ actor + mesh
```

也就是说，最有价值的 benchmark 不是一个总分，而是帮我们找到：

> **什么时候应该让 Agent 直接 Tool Call，什么时候应该 Program，什么时候才值得启动 Recursive / Multi-Agent。**

---

## 上游 Benchmark 源码索引

- [`bench/README.md`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/README.md)
- [`bench/run-cell.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-cell.sh)
- [`bench/run-matrix.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-matrix.sh)
- [`bench/analyze.py`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/analyze.py)
- [`bench/run-deepswe-matrix.sh`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/run-deepswe-matrix.sh)
- [`bench/analyze_pier.py`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/bench/analyze_pier.py)
- [`scripts/benchmark-real-resume.mjs`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/scripts/benchmark-real-resume.mjs)
- [`scripts/benchmark-memory-heads.mjs`](https://github.com/monotykamary/pi-fabric/blob/08019b6138e90466d2b4ebd1acedd3d2523eb164/scripts/benchmark-memory-heads.mjs)
