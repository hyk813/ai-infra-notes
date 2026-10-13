---
title: "KV Cache 到底占多少显存？"
description: "从层数、序列长度和 KV heads 推导容量，理解 GQA 为什么能节省缓存。"
category: inference
tags: [KV Cache, GQA, 显存]
date: 2026-10-13
updated: 2026-10-13
order: 10
status: ready
---

## 一分钟回答

KV Cache 保存每层已经生成的 Key 和 Value，避免 Decode 时重复计算历史 token 的 K/V。其容量随层数、序列长度、batch size、KV heads 和数据类型的字节数增长。

## 容量公式

对普通 Transformer，近似容量为：

$$
M = 2 L B S H_{KV} D_{head} b
$$

| 符号 | 含义 |
| --- | --- |
| $L$ | Transformer 层数 |
| $B$ | batch size |
| $S$ | 已缓存的序列长度 |
| $H_{KV}$ | KV heads 数量 |
| $D_{head}$ | 每个 head 的维度 |
| $b$ | 每个元素占用的字节数 |

前面的 2 分别对应 K 和 V。公式不包含权重、激活、元数据与内存对齐开销。

## 一个具体例子

32 层、8 个 KV heads、head dimension 为 128、FP16、序列长 8192，batch size 为 1：

```python
layers, batch, seq = 32, 1, 8192
kv_heads, head_dim, bytes_per_element = 8, 128, 2
size = 2 * layers * batch * seq * kv_heads * head_dim * bytes_per_element
print(size / 1024**3)  # 1.0 GiB
```

## 常见追问

- GQA 减少的是 KV heads，不一定减少 Query heads。
- Prefix Cache 可以共享前缀块，但不同请求的后缀仍需要独立存储。
- 显存碎片、未填满 Block 和元数据可能使实际占用高于公式估算。

## 继续阅读

[MHA、MQA 与 GQA](./attention-heads.md) · [PagedAttention 的块映射](./paged-attention.md)
