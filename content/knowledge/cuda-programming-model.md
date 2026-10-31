---
title: "CUDA Programming Model学习总结"
description: "CUDA 线程组织、Warp Shuffle、同步、Shared Memory Tiling、Occupancy 与访存基础。"
category: fundamentals
tags: [CUDA, Programming Model, Warp, Shared Memory, Occupancy]
date: 2026-10-31
updated: 2026-10-31
order: 30
status: ready
draft: false
---

# CUDA Programming Model学习总结

参考：[CUDA Programming Model](https://infra.seminars.lcpu.dev/wiki/WHFXw13vEiD8Hikfp3ScU33JnXe)

## 1. Grid、Block、Warp 与 SM

一次普通 kernel 启动对应一个 grid，grid 由多个 block 组成，每个 block 包含若干线程。

```cpp
kernel<<<numBlocks, threadsPerBlock>>>(...);
```

第一个参数指定 grid 中的 block 数，第二个参数指定每个 block 的线程数。例如：

```cpp
kernel<<<4, 128>>>(...);
```

这次启动共有 4 个 block、512 个线程。线程总数表示逻辑上创建了多少线程，不表示这些线程会同时执行。

SM（Streaming Multiprocessor）是 GPU 上实际执行线程的硬件单元。普通 block 的线程在同一个 SM 上执行，block 不会被拆到多个 SM；一个 SM 可以同时驻留多个 block，一个 grid 的 block 则可以分布在多个 SM 上。若存在资源余量、设备支持并发 kernel，不同 kernel 的 block 也可能驻留在同一个 SM。

执行过程是：kernel 启动后，block 被分配到可用的 SM；SM 根据线程数、寄存器和共享内存等资源接收 block，再由 warp 调度器从已经驻留的 warp 中选择可执行者。block 较多时，SM 完成一批后再接收后续 block。block 的执行顺序没有保证。

| 层次 | 含义 |
| --- | --- |
| Thread | 执行 kernel 的线程，有自己的寄存器和局部状态 |
| Warp | 同一个 block 内连续的 32 个线程，是调度和指令执行的重要单位 |
| Block | 线程协作单位，内部可共享 shared memory、进行 block 级同步 |
| Grid | 一次 kernel 启动的全部 block |
| SM | 驻留 block、调度 warp、执行指令的硬件单元 |

GPU 依靠大量并行线程提高吞吐量。一个 warp 等待数据时，调度器可以发射其他就绪 warp 的指令；驻留线程的寄存器状态保留在硬件中，不需要像操作系统线程那样反复保存、恢复上下文。能否隐藏延迟，取决于是否有足够的就绪工作。

warp 使用 SIMT 执行模型。线程走向不同分支时，不同路径通常需要分开执行，降低有效并行度。现代 GPU 支持独立线程调度，不能仅凭“处在同一个 warp”就假定共享内存访问已经同步。

## 2. `dim3`、线程编号与数据覆盖

`dim3` 用 x、y、z 三个分量描述 grid 或 block 的形状，省略的维度默认为 1。

```cpp
dim3 block(16, 16);  // 16 × 16 × 1，共 256 个线程
dim3 grid(8, 4);     // 8 × 4 × 1，共 32 个 block
```

grid 中的 block 数是 `grid.x * grid.y * grid.z`，block 中的线程数是 `block.x * block.y * block.z`。二维、三维只是编号方式，不代表线程在物理硬件上也排成同样的形状。

| 内置变量 | 含义 |
| --- | --- |
| `gridDim` | grid 各维的 block 数 |
| `blockDim` | block 各维的线程数 |
| `blockIdx` | 当前 block 在 grid 中的位置 |
| `threadIdx` | 当前线程在 block 中的位置 |
| `warpSize` | warp 大小，当前 NVIDIA CUDA GPU 上为 32 |

一维数据通常使用下面的全局编号：

```cpp
int i = blockIdx.x * blockDim.x + threadIdx.x;
```

二维矩阵常把 x 对应列、y 对应行：

```cpp
int col = blockIdx.x * blockDim.x + threadIdx.x;
int row = blockIdx.y * blockDim.y + threadIdx.y;

if (row < rows && col < cols) {
    C[row * cols + col] = ...;
}
```

对应的启动配置为：

```cpp
dim3 block(16, 16);
dim3 grid((cols + 15) / 16, (rows + 15) / 16);
```

向上取整保证线程覆盖全部元素，多出的线程通过边界判断跳过访问。x、y 与矩阵行列的对应可以交换，前提是 grid 大小与所有索引计算保持一致。

### 线程数少于元素数

若每个线程只处理一个元素，线程总数不足就会遗漏数据。使用 grid-stride loop 后，每个线程可以处理多个元素：

```cpp
__global__ void vecAdd(const float* A, const float* B, float* C, int n) {
    int start = blockIdx.x * blockDim.x + threadIdx.x;
    int stride = gridDim.x * blockDim.x;

    for (int i = start; i < n; i += stride) {
        C[i] = A[i] + B[i];
    }
}
```

相邻线程在同一轮处理相邻元素，下一轮整体向后移动 `stride` 个位置。数据量大于线程总数时，仍然能够覆盖所有元素。

## 3. Lane 与 Warp Shuffle 归约

### Lane 的编号

lane 是线程在 warp 内的位置，范围为 0–31。对于一维 block：

```cpp
int lane = threadIdx.x % 32;
int warpId = threadIdx.x / 32;
```

线程 0–31 属于第一个 warp，线程 32–63 属于第二个 warp；每个 warp 内都重新从 lane 0 编号。

多维 block 先按 x 最快变化的顺序展开：

```cpp
int tid = threadIdx.x
        + blockDim.x * (threadIdx.y + blockDim.y * threadIdx.z);
int lane = tid % 32;
int warpId = tid / 32;
```

因此，`16 × 16` block 的第一个 warp 包含第 0 行和第 1 行的线程，每行 16 个；`32 × 32` block 的一个 warp 则对应一整行。

### `__shfl_down_sync` 交换什么

```cpp
other = __shfl_down_sync(mask, val, offset, width);
```

这条指令返回同一个 warp 内另一个 lane 持有的 `val`。在一个宽度为 `width` 的分组内，目标是当前相对 lane 编号加上 `offset`。省略 `width` 时，默认值为 32；显式指定时必须是 1–32 之间的 2 的幂。

例如 `width = 32, offset = 16` 时，lane 0 读取 lane 16，lane 1 读取 lane 17。如果目标越过该分组的上界，返回调用者自己的 `val`。

`mask` 指定参与这次操作的 lane，不会把未执行指令的线程自动拉来参与。所有被 mask 指定且尚未退出的线程，必须使用相同 mask 执行对应的 shuffle；被读取的源线程也必须参与，否则读取结果未定义。

### 归约为什么只取 lane 0

完整的 32-lane warp 可以这样求和：

```cpp
// 前提：完整 warp 的 32 个 lane 都参与这段代码。
for (int offset = 16; offset > 0; offset /= 2) {
    val += __shfl_down_sync(0xffffffff, val, offset);
}

if (lane == 0) {
    // val 是这个 warp 的总和。
}
```

每轮 shuffle 读取的是其他 lane 在本轮加法之前传入的值。归约经过 16、8、4、2、1 五轮，逐步合并部分和。

把 warp 划分为宽度为 8 的分组，使用 `width = 8`、`offset = 4, 2, 1`，可以看清第一个分组的变化。这里仍要求完整 warp 执行指令，各个 8-lane 分组独立计算：

```text
初始值：  [ 1,  2,  3,  4,  5,  6,  7,  8]
offset=4：[ 6,  8, 10, 12, 10, 12, 14, 16]
offset=2：[16, 20, 20, 24, 24, 28, 28, 32]
offset=1：[36, 40, 44, 48, 52, 56, 60, 64]
```

第一轮中，lane 0 得到 `1 + 5`，lane 2 得到 `3 + 7`；第二轮 lane 0 再读 lane 2，得到 `1 + 3 + 5 + 7`。与此同时，lane 1 得到 `2 + 4 + 6 + 8`。最后一轮，lane 0 将两部分相加，得到 36。

高位 lane 在目标越界时会把自己加一遍，但 lane 0 的归约依赖链不会使用这些重复累加的部分。所有调用满足参与条件时，其他 lane 的数值也有定义，只是这套算法没有让它们得到整个分组的总和。

shuffle 直接交换线程持有的寄存器值，省去了显式的 shared memory 写入、读取和 block 屏障。它自身不提供共享内存访问的排序保证，不能替代内存同步。

block 级归约常分两步完成：先在每个 warp 内归约，由各 warp 的 lane 0 把结果写到 shared memory；经过 `__syncthreads()` 后，再由一个 warp 归约这些部分和。最后一轮未使用的 lane 应填入加法单位元 0，并保证 shuffle 的参与条件成立。

## 4. Block 协作与 `__syncthreads()`

### 协作范围

普通 block 的线程共享一份 shared memory，可以通过 `__syncthreads()` 协调读写。其他普通 block 不能直接访问这份 shared memory，block 之间也没有执行顺序保证。

不同 block 可以访问同一片 global memory，但这不意味着它们已经同步。普通 kernel 中不能依靠 block 屏障完成跨 block 同步；常用做法是拆成前后两个 kernel，在同一 stream 内依次启动。

原子操作、内存栅栏和屏障解决的问题不同：原子操作保证指定读改写操作的原子性；`__threadfence_block()` 约束调用线程的内存操作顺序；`__syncthreads()` 则让 block 内线程在同步点会合，并提供相应的内存可见性。内存栅栏本身不会等待其他线程到达。

### 屏障保证什么

`__syncthreads()` 等待 block 内所有尚未退出的线程到达对应同步点。屏障之前的 shared/global memory 访问，对屏障之后的 block 内线程可见。

最常见的用途是先协作写 shared memory，再读取其他线程写入的数据：

```cpp
shared[threadIdx.x] = value;
__syncthreads();
// 从这里开始，可以读取其他线程在屏障前写入的 shared 数据。
```

线程到达屏障的时间可以不同，较早到达的线程会等待。需要保证的是参与线程到达对应的同步点，且调用满足一致的控制流要求。

### 条件分支中的屏障

```cpp
if (blockIdx.x > 0) {
    __syncthreads();
}
```

`blockIdx.x` 在同一个 block 内相同，所以每个 block 都是整体执行或整体跳过屏障。不同 block 的选择可以不同，因为它们使用各自的屏障。

下面的写法在 block 内同时存在 `threadIdx.x < 64` 和 `threadIdx.x >= 64` 的线程时不合法：

```cpp
if (threadIdx.x < 64) {
    __syncthreads();
}
```

条件屏障的判断结果必须在整个 block 内一致。判断式中是否出现 `threadIdx` 并不是判定依据，例如 `threadIdx.x < blockDim.x` 对所有线程都为真。

下面这种循环也不满足条件屏障的使用要求：

```cpp
for (int i = 0; i < blockDim.x; ++i) {
    if (i == threadIdx.x) {
        __syncthreads();
    }
}
```

`i` 是每个线程自己的循环变量。线程 0 在 `i = 0` 时进入屏障，线程 1 在 `i = 1` 时进入；每一轮的分支条件都在 block 内分化。即使从源代码上看，每个线程最终都会调用一次，也不足以满足屏障要求，不能依赖这种写法的运行结果。

处理部分有效数据时，应将边界判断与屏障分开，让线程一致地执行屏障：

```cpp
shared[threadIdx.x] = (i < n) ? input[i] : 0.0f;
__syncthreads();

// 后续计算；0 是求和操作的单位元。
```

## 5. GEMM 的 Shared Memory Tiling

矩阵乘法的目标是：

$$
A\in\mathbb{R}^{n\times k},\quad
B\in\mathbb{R}^{k\times m},\quad
C\in\mathbb{R}^{n\times m}
$$

$$
C_{r,c}=\sum_{p=0}^{k-1}A_{r,p}B_{p,c}.
$$

一个 block 负责 C 的一个 `T × T` 子块。沿 k 维分段，每轮把 A、B 中需要的两个 tile 载入 shared memory，block 内线程复用它们，累加当前分段的结果。

### 索引与计算过程

下面的示例取 `T = 32`，假设 n、m、k 都是 32 的正整数倍，矩阵按行存储。每个线程计算 C 中的一个元素。此处保留一种 x 对应 block 行、y 对应 block 列的映射：

```cpp
constexpr int T = 32;

__global__ void gemmTiled(float* __restrict__ C,
                          const float* __restrict__ A,
                          const float* __restrict__ B,
                          int n, int m, int k) {
    __shared__ float aTile[T][T];
    __shared__ float bTile[T][T];

    int tx = threadIdx.x;
    int ty = threadIdx.y;
    int row = blockIdx.x * T + ty;
    int col = blockIdx.y * T + tx;
    float sum = 0.0f;

    for (int t = 0; t < k / T; ++t) {
        aTile[ty][tx] = A[row * k + t * T + tx];
        bTile[ty][tx] = B[(t * T + ty) * m + col];
        __syncthreads();

        for (int p = 0; p < T; ++p) {
            sum += aTile[ty][p] * bTile[p][tx];
        }
        __syncthreads();
    }

    C[row * m + col] = sum;
}

// 假设设备和 kernel 资源允许每 block 使用 1024 个线程。
dim3 block(T, T);
dim3 grid(n / T, m / T);
gemmTiled<<<grid, block>>>(C, A, B, n, m, k);
```

两个 tile 的内容为：

| Shared memory 位置 | 对应的矩阵元素 |
| --- | --- |
| `aTile[ty][tx]` | `A[row][t*T + tx]` |
| `bTile[ty][tx]` | `B[t*T + ty][col]` |

计算阶段中，`aTile[ty][p]` 和 `bTile[p][tx]` 对应同一个 k 维位置 `t*T + p`。内层循环完成当前分段的点积，外层循环走完全部 k 维，寄存器中的 `sum` 就是 `C[row][col]`。

### 两个屏障各自保护什么

第一个屏障位于加载之后。一个线程计算时会读取其他线程搬入 shared memory 的元素，必须等这些写入全部完成，避免读到旧数据或未初始化数据。

第二个屏障位于计算之后。同一组 shared memory 数组会被下一轮复用，必须等所有线程读完当前 tile，才能覆盖。否则，较快的 warp 可能已经写入下一块数据，较慢的 warp 却还在使用上一块。

因此，循环内的顺序是：**加载当前 tile → 等待加载完成 → 使用当前 tile → 等待使用完成 → 加载下一 tile**。最后一轮之后没有下一次覆盖，末尾那次屏障可以省略；保留它的写法更统一。

### 为什么能减少加载

朴素版本中，每个线程计算一个 C 元素，需要读取 k 个 A 元素和 k 个 B 元素。忽略缓存复用，整个矩阵乘法的全局加载次数约为：

$$
2nmk.
$$

tiling 版本中，一个 block 每轮加载 `2T²` 个元素，执行 `T³` 次乘加；共有 `nm/T²` 个 block，每个 block 处理 `k/T` 轮。因此，全局加载次数为：

$$
\frac{nm}{T^2}\cdot\frac{k}{T}\cdot 2T^2
=\frac{2nmk}{T}.
$$

A 的一个元素可以被用于计算同一 tile 中的 T 个输出列，B 的一个元素可以被用于计算 T 个输出行。数据复用使源代码层面的全局加载次数降到朴素版本的约 `1/T`。

对于 FP32，忽略 C 写回，当前 tile 的算术强度约为：

$$
\frac{2T^3\ \text{FLOPs}}{2T^2\times4\ \text{Bytes}}
=\frac{T}{4}\ \text{FLOP/Byte}.
$$

取 `T = 32` 时为约 8 FLOP/Byte。加载次数减少不等于执行时间按同样比例缩短：实际显存流量还受缓存影响，性能也受同步、寄存器、指令吞吐和驻留资源限制。

### 合并访问与 Bank Conflict

这个 `32 × 32` block 中，一个 warp 的 ty 相同、tx 为 0–31。加载 A、B 以及写回 C 时，相邻 lane 访问行内连续的 FP32 元素，适合合并为较少的全局内存事务。具体事务数还受地址对齐等因素影响。

计算时，同一 warp 读取的 `aTile[ty][p]` 地址相同，可以广播；读取的 `bTile[p][tx]` 是连续 32 个 FP32 元素，在常见的 32-bank、4 字节映射下分别落到不同 bank。

bank conflict 指多个线程访问同一个 bank 中不同地址，导致一次 shared memory 访问需要分批服务；读取同一地址的广播不属于这种冲突。

`__restrict__` 是对指针别名关系的承诺，使编译器能够减少保守的重复加载、重排部分访问。调用者必须满足相应约束，例如这里输出 C 不应覆盖输入 A、B；它不提供线程同步。

若矩阵尺寸不是 T 的倍数，应向上取整启动 grid；越界的 A、B 加载填 0，写回 C 时检查边界，同时让 block 内线程继续一致地执行屏障。

## 6. Shared Memory 容量与 Block 大小

两个 `32 × 32` 的 int 或 float 数组共使用：

$$
2\times32\times32\times4=8192\ \text{Bytes}=8\ \text{KiB}.
$$

这是每个 block 的用量。多个 block 同时驻留一个 SM 时，各自使用独立的 shared memory，并共同占用该 SM 的总容量。

容量需要区分三个层次：

| 查询项 | 含义 |
| --- | --- |
| `cudaDevAttrMaxSharedMemoryPerBlock` | 每个 block 默认可使用的 shared memory 上限 |
| `cudaDevAttrMaxSharedMemoryPerBlockOptin` | 显式 opt-in 后，每个 block 可使用的上限 |
| `sharedMemPerMultiprocessor` | 一个 SM 的 shared memory 总容量 |

CUDA 文档中，超过 48 KiB 的单 block 分配需要使用动态 shared memory，并在支持的架构上显式 opt-in。不能把 48 KiB 当成 SM 的总容量；实际设备能力应通过属性查询。资源超限可能在编译、加载或启动阶段被发现，不能依赖某一种固定报错。

动态 shared memory 的声明、配置和启动分别如下：

```cpp
__global__ void myKernel() {
    extern __shared__ float s[];
    // 按需要将 s 划分为多个区域。
}

int bytes = 64 * 1024;  // 示例：设备必须支持这一大小。
cudaFuncSetAttribute(myKernel,
                     cudaFuncAttributeMaxDynamicSharedMemorySize,
                     bytes);
myKernel<<<grid, block, bytes>>>();
```

`cudaFuncSetAttribute` 设置该 kernel 允许申请的动态容量，启动配置的第三个参数指定本次实际分配量。静态与动态 shared memory 的合计也必须满足单 block 上限，相关 API 返回值需要检查。

block 线程数同样受设备和 kernel 限制。当前常见设备每个 block 最多支持 1024 个线程，各维还有限制，应查询 `maxThreadsPerBlock`、`maxThreadsDim` 等属性。满足线程数上限，也可能因寄存器或 shared memory 不足而无法启动。

128、256 等 32 的倍数是常见配置，可以避免最后一个 warp 留下过多空闲 lane。`32 × 32` 已经达到 1024 个线程，并不天然优于较小 block。

## 7. Occupancy 与资源约束

occupancy 表示一个 SM 上驻留的活跃 warp 数，占该 SM 最大支持 warp 数的比例：

$$
\text{Occupancy}
=\frac{\text{驻留的活跃 warp 数}}{\text{SM 最大支持 warp 数}}.
$$

这里的“活跃”指已经驻留、尚未完成，不表示正在执行指令。驻留 warp 仍可能等待访存、数据依赖或屏障。

一个 SM 能同时驻留多少 block，主要受到以下资源约束：

| 资源 | 每个 block 的占用或约束 |
| --- | --- |
| 线程／warp 数 | block 内线程数和所需 warp 数 |
| block 数 | 硬件允许同时驻留的 block 数上限 |
| 寄存器 | 编译后每线程寄存器需求，以及硬件分配粒度 |
| Shared memory | 每 block 的静态与动态分配量，以及分配粒度 |

驻留 block 数受到最紧的约束限制。例如，某 SM 可驻留 2048 个线程，每个 block 256 个线程，仅按线程数估算可驻留 8 个 block；若 shared memory 总量为 64 KiB、每个 block 使用 24 KiB，就至多只能驻留 2 个。寄存器等约束还可能进一步降低这个数量。

相关 API：

```cpp
int minGridSize, blockSize;
cudaOccupancyMaxPotentialBlockSize(
    &minGridSize, &blockSize, myKernel, dynamicBytes, 0);

int blocksPerSM;
cudaOccupancyMaxActiveBlocksPerMultiprocessor(
    &blocksPerSM, myKernel, blockSize, dynamicBytes);
```

第一个 API 根据资源占用推荐 block 大小，并给出达到该理论 occupancy 所需的最小 grid 规模；第二个 API 对指定 block 大小计算每个 SM 可驻留的 block 数。若动态 shared memory 随 block 大小变化，应使用对应的 variable-shared-memory 接口。

`SM 数 × blocksPerSM` 可以估算一批驻留 block 的规模，但不能保证 kernel 已达到最高吞吐。非 grid-stride kernel 还必须先保证线程覆盖全部数据。

occupancy 较高通常能提供更多隐藏延迟的机会，但性能不只由 occupancy 决定。每个线程使用更多寄存器可能增加数据复用、减少访存，即使 occupancy 降低也可能更快；为了提高 occupancy 强行限制寄存器，则可能产生 spill，使数据落入由显存支持的 local memory。

## 8. 数据依赖、并行 Scan 与 Memory Bound

逐元素运算如 `x[i] = a[i] + b[i]`，不同位置之间没有依赖，容易直接分配给不同线程。

递推形式是否能并行化，要看运算结构。对于：

$$
x_i=x_{i-1}+a,\qquad i\ge1,
$$

虽然逐步求值存在依赖，但数学上可以改写成 `x_i = x_0 + i*a`，各位置独立计算。浮点数下，改写后的舍入结果不一定与逐项累加完全一致。

对于：

$$
x_i=x_{i-1}+b_i,
$$

可以改写为 `x_i = x_0 + Σ(j=1..i) b_j`，通过并行前缀和（scan）计算。scan 利用可结合的运算，将一条长依赖链组织成树形合并，使并行深度降到 `O(log n)`。工作高效的 scan 可以保持 `O(n)` 总工作量；不能把所有并行 scan 都理解为 `O(n log n)` 次全局访存。

浮点加法不严格满足结合律，因此改变归约或 scan 的顺序，也可能改变最后几位数值。

算术强度是计算量与数据搬运量的比值，常用单位为 FLOP/Byte。一个粗略的性能下界为：

$$
t\gtrsim\max\left(
\frac{\text{计算量}}{\text{有效计算吞吐}},
\frac{\text{数据量}}{\text{有效内存带宽}}
\right).
$$

当数据传输带宽成为主要限制时，称为 memory bound。scan 每个元素通常只做少量加法，却需要读写数据并协调线程，因而可能受内存带宽、通信或同步限制。具体瓶颈取决于算法、数据规模及实现，不能只看“是否存在递推”。

## 9. Host / Device 内存与编译执行

### 显式分配与拷贝

```cpp
int n = 1000000;
size_t bytes = static_cast<size_t>(n) * sizeof(float);

float* h_a = static_cast<float*>(malloc(bytes));
for (int i = 0; i < n; ++i) {
    h_a[i] = 1.0f;
}

float* d_a;
cudaMalloc(&d_a, bytes);
cudaMemcpy(d_a, h_a, bytes, cudaMemcpyHostToDevice);
cudaMemcpy(h_a, d_a, bytes, cudaMemcpyDeviceToHost);

cudaFree(d_a);
free(h_a);
```

这里分别分配 CPU 内存和设备内存，每份 4,000,000 字节，约 4 MB。`d_a` 是保存在 CPU 变量中的设备指针，普通独立显存配置下不能由 CPU 直接解引用。

这段代码只演示数据往返拷贝，没有启动 kernel，也没有进行 GPU 计算。实际执行通常是：CPU 准备数据 → 拷入设备 → 启动 kernel → 等待必要的依赖完成 → 拷回结果。

`cudaMallocManaged` 分配的统一内存允许 CPU、GPU 使用同一指针，系统按平台能力管理驻留和数据迁移，但仍需满足访问、同步要求，也仍然存在数据移动成本。

### 函数修饰符与编译产物

| 修饰符 | 执行位置与调用方式 |
| --- | --- |
| `__host__` | 在 CPU 执行，普通 C++ 函数默认属于这一类 |
| `__device__` | 在 GPU 执行，由设备代码调用 |
| `__global__` | 在 GPU 执行的 kernel，通常由 CPU 使用启动语法调用；设备端启动需要动态并行支持 |

`__host__ __device__` 可以为同一函数分别生成 host、device 版本。

`.cu` 文件通常由 nvcc 编译，host 与 device 部分交给相应编译流程。PTX 是虚拟指令集形式的中间表示，可由驱动 JIT 为目标 GPU 生成机器码；CUBIN 包含针对指定架构的设备机器码。fat binary 可以同时包含多种架构的 CUBIN 和 PTX。

## 10. 其他接口与执行机制

- **错误检查**：CUDA Runtime API 通常返回 `cudaError_t`，可用 `cudaGetErrorString` 解释错误。kernel 启动后可用 `cudaGetLastError()` 检查启动错误；异步执行错误可能在后续同步或其他 API 调用时才显现。
- **事件计时**：在目标 stream 中记录起止 CUDA Event，等待结束事件完成后，用 `cudaEventElapsedTime` 获取设备端经过时间。单纯测量 CPU 发起 kernel 调用的时间，通常只测到提交开销。
- **Stream**：同一 stream 中的命令遵循顺序依赖。不同 stream 的操作在依赖关系、硬件资源和内存传输条件允许时可以重叠执行，并不保证并发。
- **多 GPU**：`cudaSetDevice` 设置当前设备，`cudaMemcpyPeer` 用于设备间复制。直接访问另一设备的内存需要设备支持相应 P2P 能力并进行必要配置。
- **Thread Block Cluster**：从计算能力 9.0 起，在支持的设备上可以把多个 block 组成 cluster，保证其协同调度到同一 GPC。cluster 内通过 distributed shared memory 访问其他 block 的 shared memory，并可使用 `cluster.sync()` 同步；访问还需要保证相关 block 和数据的生命周期。cluster 大小与可驻留数量受设备、配置和资源限制。
- **矩阵乘法的进一步优化**：寄存器 blocking 让一个线程计算多个输出以增加复用；double buffering 与异步拷贝将数据加载和计算重叠；Tensor Core 使用专用矩阵乘加指令。这些机制分别改变数据复用、流水重叠或计算吞吐，收益取决于实际瓶颈。

参考：[CUDA C++ Programming Guide](https://docs.nvidia.com/cuda/archive/12.6.3/cuda-c-programming-guide/index.html)、[CUDA Runtime API — Occupancy](https://docs.nvidia.com/cuda/cuda-runtime-api/group__CUDART__OCCUPANCY.html)。
