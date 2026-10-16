---
title: "Prefix Cache与RadixAttention和PagedAttention"
description: "RadixAttention 学习总结与 16 组模拟面试问答，涵盖 KV 索引、并发、淘汰、vLLM APC 和性能分析。"
category: inference
tags: [Prefix Cache, RadixAttention, PagedAttention, SGLang, vLLM]
date: 2026-10-17
updated: 2026-10-17
order: 20
status: ready
draft: false
isExample: true
---

# Prefix Cache与RadixAttention和PagedAttention

## 一、原文讲了什么

[原文](https://forceinjection.github.io/09_inference_system/kv_cache/01_concepts/prefix_caching/radix_attention.html)围绕“怎样复用已经算过的前缀 KV”展开，主要介绍：

- **背景**：System Prompt、多轮对话和公共上下文会产生重复 Prefill，Prefix Cache 可以省去这部分计算。
- **SGLang RadixAttention**：用 Radix Tree 组织前缀与 KV 索引，通过匹配、分裂、引用保护和叶子淘汰管理缓存，并与分页 KV 管理结合。
- **vLLM APC**：使用包含前缀身份的块哈希查找缓存，与树方案对比；Router 则用近似前缀树辅助路由。
- **扩展与性能**：讨论多租户、跨实例共享、chunked prefill 等协同方式，以及命中收益、Prompt 组织和预热策略。

> [!NOTE]
>
> 注意一定是tokenize之后的内容精确匹配，之前做FlexGen项目的时候就拿文本来做前缀匹配了，实际上是错误的

## 二、面试问答

### 1. SGLang 的 Radix Cache 怎样维护元信息、定位 KV，并保证插入和分裂正确？

**面试官：** 节点里保存了什么？拿到一个节点内的 token 后，怎样找到实际 KV？插入时有哪些情况？

**面试者：** 节点主要保存 `key`、`value`、父子关系、`lock_ref` 和访问时间。其中 `key` 是 token 片段，`value` 是对应的 KV pool 槽位索引。对于普通 KV pool，同一槽位对应各层的 K/V 存储位置，具体地址由层号、槽位和后端布局确定。

例如，按 token 粒度管理时：

```text
key   = [A, B, C, D, E]
value = [40, 7, 91, 12, 63]
```

这里 C 的 KV 位于槽位 91。完整请求的索引由路径上各节点的 value 拼接得到，再写入请求到 KV 的映射，供 attention 后端访问。

插入可以分成三类：

1. **没有对应分支**：创建新节点，保存剩余 tokens 与索引。
2. **整个节点匹配**：跳过这一段，继续匹配后面的节点；若新序列已经结束，则不必创建重复节点。
3. **节点内部部分匹配**：按公共前缀长度切分 key 和 value，再挂接新分支。

```text
插入 [A,B,C,X]：

root → P:[A,B,C]，value=[40,7,91]
         ├─ N:[D,E]，value=[12,63]
         └─ X:[X]，  value=[新槽位]
```

分裂只调整索引元数据，不搬迁实际 K/V。原节点保留为后缀节点，新增公共父节点，更新 parent/children。若原节点 `lock_ref=2`，分裂后 P、N 都为 2，因为原来两份引用都需要这两段；新请求锁定到 P 后，P 变为 3，N 仍为 2。

还要处理重复计算：两条请求可能在缓存插入前都算出了同一前缀。插入发现重复后，应保留已有缓存索引，释放新增的重复槽位，并将请求映射改为规范的共享索引，避免泄漏或重复释放。`page_size>1` 时，匹配和分裂还要遵守页对齐。[SGLang 插入与索引更新](https://github.com/sgl-project/sglang/blob/c7fb57d990416dd86c64e698bdb7bab58d68ca2d/python/sglang/srt/mem_cache/radix_cache.py#L450)

<!--由于之前实现过Radix Tree，这里不详细展开。后续总结一下我感兴趣的sglang的操作-->

### 2. SGLang 的 Radix Tree 怎样支持并发访问？

**面试官：** 多条请求同时命中一段前缀，会不会互相覆盖？引用计数是不是锁？

**面试者：** 已完成的公共前缀可以被多个请求只读共享，新增后缀使用各自分配的槽位，因此不会直接覆盖公共 KV。

需要区分两件事：

- `lock_ref` 保护缓存生命周期。使用某节点时，沿祖先路径增加计数；释放时对应减少，防止活跃 KV 被淘汰。
- 树结构修改和 GPU 读写需要正确的执行顺序。SGLang 常规路径由单线程 Scheduler 事件循环组织管理操作，CPU/GPU 重叠时仍需保证写入完成后才能读取、读取结束后才能释放复用。

所以 `lock_ref` 不是互斥锁，不能单靠它实现线程安全。若自行设计多个线程共同修改一棵树，还需要互斥锁、读写锁或串行化更新机制。[Scheduler 事件循环](https://github.com/sgl-project/sglang/blob/c7fb57d990416dd86c64e698bdb7bab58d68ca2d/python/sglang/srt/managers/scheduler.py#L1940)

### 3. SGLang 的 KV Cache 怎样淘汰？

**面试官：** 为什么从叶子开始？淘汰叶子之后，父节点怎么办？

**面试者：** 基础 RadixCache 从未锁定叶子中选择候选。采用 LRU 时，优先回收最久未访问的叶子，释放其 KV，并删除父节点中的分支。

若父节点因此没有子节点，且 `lock_ref=0`，它也成为候选，可以继续向上回收。过程持续到释放足够空间，或没有可淘汰节点。

从叶子开始，是为了保留缓存路径的连续性。中间前缀删除后，剩余后缀不能继续被视为完整的可用前缀。活跃后缀依赖的祖先应始终被引用保护。[淘汰与路径引用](https://github.com/sgl-project/sglang/blob/c7fb57d990416dd86c64e698bdb7bab58d68ca2d/python/sglang/srt/mem_cache/radix_cache.py#L552)

**追问：** 长前缀只剩一个活跃叶子，是不是“幽灵依赖”？

**面试者：** 普通 Full Attention 的后续生成仍需读取全部有效历史 KV，所以这段前缀有真实用途。若剩下的只是冷缓存，则可以先淘汰叶子，再逐级淘汰前缀。合并树节点只减少元数据，不会减少历史 KV 的大小。

### 4. SGLang 的树维护有哪些开销？

**面试官：** 查找、分裂、引用管理和淘汰分别有什么成本？

**面试者：** 设输入长度为 m、访问路径包含 d 个节点：

- **查找和插入**：token 比较最坏为 O(m)，另有节点跳转和字典访问。
- **分裂**：分配节点、修改父子关系、切分 key/value。该实现会复制索引张量，成本与被复制的索引长度有关，不只是改几个指针；但不会复制全层 K/V。
- **引用管理**：沿祖先路径增减计数，约为 O(d)。
- **淘汰**：维护候选、构建或更新优先队列，以及释放槽位。所查版本先对 E 个候选建堆，约 O(E)，之后每次取候选约 O(log E)，还可能加入新的父节点候选。

短请求、低命中率、大量分支时，CPU 管理成本更容易占据显著比例。分析时应看 Scheduler 的 CPU 时间、索引操作和 GPU 等待，不能只看树的渐进复杂度。[查找与分裂实现](https://github.com/sgl-project/sglang/blob/c7fb57d990416dd86c64e698bdb7bab58d68ca2d/python/sglang/srt/mem_cache/radix_cache.py#L651)

### 5. RadixAttention 和 vLLM APC 有什么区别？

**面试官：** 从数据结构、粒度、开销和并发管理比较两种方案。

**面试者：** 原文的对比如下：

| **维度**      | **RadixAttention (SGLang)** | **APC (vLLM)**                     |
| :---------- | :-------------------------- | :--------------------------------- |
| **数据结构**    | Radix Tree（压缩前缀树）           | Hash Table（哈希表）                    |
| **索引粒度**    | Token 级别                    | Block 级别（16-32 tokens）             |
| **查找方式**    | 树遍历，天然支持最长前缀匹配              | 逐 Block 哈希查找                       |
| **内存开销**    | 较高（树节点、指针）                  | 较低（仅哈希表条目）                         |
| **动态前缀**    | 任意位置分支，灵活性高                 | 需 Block 对齐，灵活性稍低                   |
| **内存碎片化倾向** | 低（Block 连续分配）               | 中（Block 离散分配，依赖 PagedAttention 回收） |
| **实现复杂度**   | 较高（节点分裂、合并）                 | 较低（标准哈希表操作）                        |
| **并发支持**    | 需要细粒度锁                      | 通过引用计数管理                           |

> 表格按原文保留。实际使用时，SGLang 复用也受 page size 约束，vLLM 的块大小取决于后端配置；离散物理块不等于更多碎片，`lock_ref` 也不等于互斥锁。不能仅由这张表推导实际内存占用或吞吐高低。

### 6. per-tenant 访问时间怎样用于多租户淘汰？

**面试官：** 同一个前缀对租户 A 很冷，对租户 B 很热，怎么处理？

**面试者：** 按文中的扩展思路，可以给节点维护租户访问表：

```python
last_access = {tenant_id: timestamp}
```

租户命中前缀时更新相应记录。做租户 A 的缓存清理时，根据 A 的访问时间、容量预算等，决定是否移除 A 对冷缓存的保留记录。

但移除 A 的记录，不代表马上释放共享物理 KV。如果 B 仍在活跃使用，或缓存策略仍决定为 B 保留，那么物理数据应继续存在。最终回收要同时满足没有活跃引用、没有需要继续保留的共享用途，以及树的淘汰条件。

此外还要定义共享内存怎样计入租户预算，例如按共享者分摊或设公共缓存池。per-tenant 时间只是策略输入，隔离通常还要靠 namespace、salt 或独立缓存池完成；这是一种扩展设计，不能当成基础 RadixCache 默认已有的完整租户策略。vLLM 的 `cache_salt` 是共享域隔离的一个具体例子。[缓存身份与 salt](https://github.com/vllm-project/vllm/blob/7cd7982dfda0d29c68f73c54cd343b674b290a47/docs/design/prefix_caching.md)

### 7. 跨实例共享 KV Cache，怎样处理一致性、传输和索引问题？

**面试官：** 分别给出简单方案。

**面试者：** 可以将内容发现、数据传输和生命周期保护分开：

| 问题 | 可用方案 |
|---|---|
| 一致性 | 已完成 KV 按只读对象发布；使用包含模型版本、上下文和适配器身份的内容键；传输中用 pin/ref/lease 保护源数据，目标完成后才发布为可用 |
| 传输开销 | 先比较远程取回和本地重算；批量传输、异步预取，并尽量与其他工作重叠；支持时采用 RDMA 或直接的数据通路减少拷贝 |
| 索引同步 | 用目录服务记录“内容键 → 实例/存储位置”，通过新增、淘汰事件和心跳更新；查询失败时重新计算或换来源 |

目录可以有短暂陈旧，但实际取回必须确认对象仍有效；陈旧信息应造成回退，而不能读到已复用的错误槽位。通常不必同步所有实例的完整 Radix Tree，只要能定位所需缓存块即可。

还要处理布局兼容：相同语义的 KV 如果 dtype、页大小或 TP 切分不同，可能需要转换或重分片；本地槽位 ID 也不能直接当成远端地址。[vLLM KV transfer](https://github.com/vllm-project/vllm/blob/7cd7982dfda0d29c68f73c54cd343b674b290a47/vllm/distributed/kv_transfer/README.md)、[LMCache P2P](https://docs.lmcache.ai/kv_cache/p2p_sharing.html)

### 8. 怎样实际分析 Prefix Cache 的性能收益？

**面试官：** 你会怎么做对照实验？看哪些指标？怎样避免命中率很高但结论错误？

**面试者：** 我会先在同一个引擎里比较开关 Prefix Cache，固定模型、硬件、KV dtype、并行方式、调度配置和请求负载，避免把其他系统差异算作缓存收益。

先做低并发实验，分清查找成本与 Prefill 节省；再做在线到达负载下的并发测试，观察排队和容量压力。测试分三组：

1. **关闭缓存**：得到不复用的基线。
2. **冷缓存**：缓存为空但功能开启，观察首次计算与建缓存成本。
3. **热缓存**：高频前缀已经存在，观察稳定复用收益。

模型加载和 kernel 预热应保持一致。数据覆盖不同共享长度、复用频率、输出长度和并发，并加入工作集超过缓存容量的情况，观察淘汰抖动。性能对照尽量固定生成长度；正确性另用确定性设置比较缓存与重算结果，必要时检查 logits 容差。

主要指标包括：

| 指标 | 分析用途 |
|---|---|
| token 命中比例、命中长度分布 | 实际省掉多少输入计算，不能只统计“是否命中” |
| Prefill 执行时间、Scheduler/查找时间 | 节省的计算有没有被管理成本抵消 |
| TTFT 的 P50/P95/P99 | 首 token 延迟与尾延迟是否改善 |
| ITL/TPOT、请求完成时间 | Decode 与整条请求是否受影响 |
| 固定延迟目标下的请求吞吐 | 系统实际多承载了多少有效工作 |
| 活跃 KV、可回收容量、淘汰与重算量 | 是否因容量压力反复淘汰、重新 Prefill |

例如，100 个请求都只命中开头 16 tokens，请求命中率可以是 100%，但对长 prompt 的收益很小。长输出场景则可能 Prefill 明显加速，整条请求改善仍有限。

对多实例系统，还要区分收益来自本地复用、路由亲和性还是远程传输，并记录 worker 排队和 KV 获取时间。[vLLM APC 的收益范围](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/)

## 三、进一步追问

### 9. RadixAttention 与 PagedAttention 分别解决什么问题？

**面试官：** 已经有 PagedAttention，为什么还需要前缀缓存？

**面试者：** PagedAttention 让逻辑连续的 KV 可以位于不连续物理块中，主要解决动态分配、访存和物理共享。前缀缓存则识别“这些 KV 以前算过，可以直接使用”。分页本身不会自动完成跨请求前缀查找。

组合后，树或哈希先找到共享 KV，再将它们映射到请求的逻辑位置，由 attention kernel 读取。多个请求可以指向同一物理块；若需要改写共享数据，必须分配私有空间或采用写时复制。[PagedAttention](https://vllm.ai/blog/2023-06-20-vllm)

### 10. 为什么 vLLM 的块哈希必须包含父块哈希？

**面试官：** 只哈希当前块的 token 不行吗？

**面试者：** 不行。同一段 token 接在不同上文之后，其各层隐藏状态及 KV 通常不同。父块哈希把完整前缀身份递归编码进来，防止相同后缀、不同上下文之间错误复用。

此外，LoRA、多模态内容等也会影响结果，需要纳入额外身份或由缓存命名空间隔离。哈希算法还要考虑碰撞风险，不能把“哈希相同”理解成数学上的绝对无碰撞。[vLLM APC 哈希设计](https://github.com/vllm-project/vllm/blob/7cd7982dfda0d29c68f73c54cd343b674b290a47/docs/design/prefix_caching.md)

### 11. APC 能否和 chunked prefill 协同？

**面试官：** KV block 和 prefill chunk 是同一个概念吗？

**面试者：** 可以协同，两者不是同一个单位。KV block 是存储与复用单位，prefill chunk 是每轮安排的新 token 数。

例如 prompt 有 160 tokens，前 64 tokens 命中，每轮分配 32 个 prefill tokens，就先复用 `[0,64)`，再依次计算 `[64,96)`、`[96,128)`、`[128,160)`。新计算出的完整块按引擎时序进入缓存。更小 chunk 便于穿插 Decode，但会增加调度次数；更大 chunk 可能提高 Prefill 效率，也可能增加 Decode 等待。[vLLM Chunked Prefill](https://github.com/vllm-project/vllm/blob/7cd7982dfda0d29c68f73c54cd343b674b290a47/docs/configuration/optimization.md#L49)

### 12. 整个 prompt 都命中，为什么还可能需要计算？

**面试官：** 有了所有 KV，能否直接生成第一个新 token？

**面试者：** 仅有 KV 不一定有最后位置的 logits。如果只缓存 KV，没有缓存可直接输出所需的末位置结果，就需要重算末 token。所查 vLLM 实现把最大命中长度限制为 `prompt_length-1`，完整块约束还可能导致重算最后一个块。[相关实现](https://github.com/vllm-project/vllm/blob/7cd7982dfda0d29c68f73c54cd343b674b290a47/vllm/v1/core/kv_cache_manager.py#L289)

### 13. 为什么命中 90% 的 tokens 不等于快 10 倍？

**面试官：** 命中后还有哪些工作？

**面试者：** 剩余 token 仍要执行模型各层，并读取已经命中的前缀 KV；输入处理、缓存查找、排队和 Decode 也没有全部消失。各部分耗时还不与 token 数简单成比例。

设命中前缀为 P，新后缀为 Q，仅看因果 attention 的有效位置对：

```text
无缓存：(P+Q)(P+Q+1)/2
有缓存：PQ + Q(Q+1)/2
```

`PQ` 就是新后缀对前缀的 attention。此外还有线性随 token 数增长的投影、MLP 等成本。端到端收益也受 Prefill 原有占比限制：若 Prefill 占总耗时 40%，它加速 5 倍而其他部分不变，总加速约为 `1/(0.6+0.4/5)=1.47` 倍。这是估算示例，实际用测量判断。

### 14. 怎样估算 KV 容量和共享的显存收益？

**面试官：** 给定模型配置，怎么算每 token 的 KV 大小？

**面试者：** 对普通未压缩 Full Attention：

```text
每 token KV 字节数 m = 2 × 层数 × KV heads × head_dim × 元素字节数
```

例如 32 层、8 个 KV heads、head_dim=128、BF16，对应每 token 128 KiB，8192 tokens 约为 1 GiB。这是全模型总量，单卡要按实际分片与复制情况计算。

n 个请求共享长度为 P 的前缀，相比各存一份，理想节省 `(n-1)Pm`。还要考虑尾页、索引等开销。淘汰后 `nvidia-smi` 不一定下降，因为预分配的 KV pool 通常只是回收槽位；应观察池内可分配容量。

### 15. 缓存感知路由为什么不能只选命中最长的实例？

**面试官：** Router 的前缀树是不是实例缓存的准确镜像？

**面试者：** 通常不是。vLLM Router 的 `cache_aware` 使用近似前缀信息估计缓存亲和性，后端淘汰、重启都可能使估计过时。它不存实际 KV。

命中最长的实例如果排队很长，可能比无缓存但空闲的实例更慢。因此路由要同时看等待时间和未命中部分的处理成本。该策略在负载相近时偏向前缀匹配，在失衡时转向更空闲的 worker。热门前缀也可以在多个副本保留，用一些存储换负载分散。[vLLM Router](https://github.com/vllm-project/router/blob/main/docs/load_balancing/README.md#cache-aware)

### 16. 相同文档换个顺序，能直接复用 KV 吗？

**面试官：** RAG 中 `[Doc1,Doc2]` 改成 `[Doc2,Doc1]`，内容没变，为什么不能继续复用？

**面试者：** 因为位置和前面的上下文变了，后续层的隐藏状态及 KV 也会变化。普通 Prefix Cache 只能复用从开头连续一致的部分，不能按文档内容任意拼接 KV。文本前缀相同也不够，分词边界可能受后续文本影响，必须检查 token 序列。

实践中可以在语义允许时保持模板、工具列表、文档排序和序列化方式稳定，把时间戳、随机 ID 等动态字段放后面。但不能为了提高命中率随意改变任务输入；非前缀复用需要额外机制和正确性或质量验证。

## 参考

- [原文：RadixAttention 技术详解](https://forceinjection.github.io/09_inference_system/kv_cache/01_concepts/prefix_caching/radix_attention.html)
- [SGLang RadixCache 源码](https://github.com/sgl-project/sglang/blob/c7fb57d990416dd86c64e698bdb7bab58d68ca2d/python/sglang/srt/mem_cache/radix_cache.py)
- [vLLM APC 设计](https://github.com/vllm-project/vllm/blob/7cd7982dfda0d29c68f73c54cd343b674b290a47/docs/design/prefix_caching.md)

实现细节以链接版本的基础缓存路径和普通因果 Full Attention 为主。
