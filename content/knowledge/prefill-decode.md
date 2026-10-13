---
title: "Prefill 与 Decode 的瓶颈为什么不同？"
description: "从计算形状与数据复用出发，解释首 token 延迟和逐 token 生成的性能差异。"
category: inference
tags: [Transformer, Prefill, Decode]
date: 2026-10-13
order: 10
status: ready
---

## 一分钟回答

Prefill 一次处理多个输入 token，通常形成较大的矩阵计算；小 batch Decode 每步处理一个新 token，需要读取权重与已有 KV，往往更受内存带宽限制。

这不是固定结论：长上下文注意力、跨设备通信和 SSD KV 加载都可能改变瓶颈。

## 分阶段看数据流

| 阶段 | 输入与工作 | 常用指标 |
| --- | --- | --- |
| Prefill | 处理输入，构建 KV，生成首 token | TTFT |
| Decode | 读取历史 KV，逐步生成新 token | ITL、TPOT |

TTFT 还可能包含排队、预处理和 KV 恢复，不能只用模型计算时间代替。

## Batch size 的作用

增大 Decode batch 可以让多个请求摊薄权重读取开销，也能扩大矩阵计算规模。但 KV 内存、排队时间和单步耗时也会增长。

## 常见追问

- 为什么 Chunked Prefill 能减少长请求对已有 Decode 的干扰？
- Prefix Cache 命中后，Prefill 会不会转为 I/O 瓶颈？
- 怎样同时观察吞吐与延迟，而不是只比较 tokens/s？

## 继续阅读

[KV Cache 容量计算](./kv-cache-size.md)
