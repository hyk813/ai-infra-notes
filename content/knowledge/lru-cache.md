---
title: "LRU Cache：哈希表与双向链表的组合"
description: "解释平均 O(1) 查询与更新，以及并发访问和迭代器生命周期的边界。"
category: programming
tags: [数据结构, C++, LRU]
date: 2026-10-13
order: 10
status: ready
---

## 核心结构

哈希表负责定位 key，双向链表维护访问顺序。链表头是最近访问的元素，链表尾是最久未访问的元素。

## 操作流程

1. 查询命中：把对应节点移到头部。
2. 更新已有 key：修改 value，再移到头部。
3. 插入新 key：插入头部并加入哈希表。
4. 超过容量：移除尾部节点和哈希记录。

```cpp
// 索引指向链表节点，移动节点时保持节点自身有效。
std::list<std::pair<Key, Value>> order;
std::unordered_map<Key, decltype(order)::iterator> index;

// 命中后移到最近访问的位置。
order.splice(order.begin(), order, index.at(key));
```

## 复杂度与边界

哈希查询平均 O(1)，节点移动与删除 O(1)。哈希表最坏情况并不保证 O(1)。

并发访问时，查询也可能修改链表，因此不能将 get 简单当作只读操作。容量为0、重复插入、异常和对象所有权也需要考虑。

## 常见追问

- LRU 与 LFU 的适用场景有什么区别？
- 如何测试淘汰顺序和更新行为？
- 缓存里的指针指向外部资源时，谁负责释放？
