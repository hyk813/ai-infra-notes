---
title: "MHA、MQA、GQA：到底共享了什么？"
description: "从 Query head 到 KV head 的映射，理解注意力结构与 KV 内存之间的关系。"
category: models
tags: [GQA, 注意力, 模型架构]
date: 2026-10-13
order: 20
status: ready
---

## 三种结构

- **MHA**：每个 Query head 有对应的 KV head。
- **MQA**：所有 Query heads 共享一个 KV head。
- **GQA**：多个 Query heads 组成一组，共享一个 KV head。

减少 KV heads 可以降低 KV Cache 容量与读取量，Query heads 数量不一定改变。

## 头索引映射

假设 32 个 Query heads、8 个 KV heads，则每4个 Query heads 共享一组 KV。对于按连续组组织的实现：

```python
q_heads, kv_heads = 32, 8
group_size = q_heads // kv_heads
kv_head_id = query_head_id // group_size
```

实际实现需要检查模型的头排列和张量布局，不应在所有模型上无条件套用同一个索引公式。

## 实现时需要注意

- 保留 K/V 的共享结构，避免物理重复展开抵消内存收益。
- RoPE 作用于 Q/K，位置编号影响 KV 复用条件。
- 模型适配不仅是改 head 数，还需要检查权重形状和数值一致性。

## 常见追问

GQA 对 attention 计算量、KV 读取量和模型质量分别有什么影响？
