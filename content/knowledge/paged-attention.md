---
title: "PagedAttention：逻辑连续，物理分块"
description: "理解 Block Table、块共享和 Copy-on-Write，区分 KV 分块与操作系统分页。"
category: inference
tags: [PagedAttention, vLLM, 内存管理]
date: 2026-10-13
order: 20
status: review
---

## 面试问题

为什么 KV Cache 不必在物理显存中连续？PagedAttention 如何找到一个 token 的 K/V？

## 核心原理

把序列拆成固定 token 数的逻辑块，通过 Block Table 映射到物理 KV 块。Kernel 根据逻辑块号和块内偏移定位数据。

```text
token position
  → logical block = position // block_size
  → physical block = block_table[logical block]
  → offset = position % block_size
```

分块可以减少连续大块分配的要求，也方便多个请求共享前缀。共享块通过引用计数管理，修改共享可写部分时需要 Copy-on-Write。

## 与操作系统分页的区别

| 维度 | PagedAttention | 操作系统分页 |
| --- | --- | --- |
| 管理对象 | token 的 KV 数据 | 一般内存页 |
| 映射执行 | 软件数据结构与 GPU Kernel | MMU 与操作系统 |
| SSD 换页 | 需要额外实现 | 操作系统可提供交换机制 |

PagedAttention 本身不等于 KV 自动卸载到 SSD。

## 常见追问

- Block 大小怎样影响碎片、索引开销和 Kernel 效率？
- 部分填满的 Block 能否安全共享？
- 请求被抢占时如何回收和恢复 KV？

## 参考资料

- [vLLM：PagedAttention](https://blog.vllm.ai/2023/06/20/vllm.html)
