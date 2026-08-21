这个问题已经进入“真正要写可运行规范”的层级了，我直接给你们**工程可落地版定义（不再是概念）**，并且会明确：

> ✔ adTTL 和 LQB 不是同一个机制
> ✔ 但可以共享同一个“段落状态结构体”
> ✔ 两者是 pipeline 的两个不同阶段

---

# 🧠 一、先给结论（避免再混）

## ✔ LQB 和 adTTL 的关系

| 模块    | 本质          | 阶段                       | 是否共享       |
| ----- | ----------- | ------------------------ | ---------- |
| LQB   | 低质量连续检测（窗口） | scoring前                 | ✔ 共享 state |
| adTTL | 广告衰减传播      | scoring后 / structFilter后 | ✔ 共享 state |

---

# 🧱 二、统一数据结构（必须先定义）

所有机制基于同一个结构：

```js
ps[i] = {
    score: 0,
    isAd: false,

    // ===== LQB =====
    lowScoreStreak: 0,

    // ===== adTTL =====
    adTTL: 0,
    adFlag: 0
}
```

---

# 🧠 三、LQB（Low Quality Buffer）规范实现

## 📌 目标

检测：

> 连续“低质量段落流”

用于：

* 识别“软广告区”
* 防止 Kadane 被噪声拖断

---

## 📌 参数定义（固定）

```js
LQB_LOW_THRESHOLD = 120   // 低质量阈值
LQB_WINDOW_LIMIT   = 3     // 连续3段触发
```

---

## 📌 规则

### ✔ 更新逻辑（逐段扫描）

```js
if (ps[i].score < LQB_LOW_THRESHOLD) {
    ps[i].lowScoreStreak = ps[i-1]?.lowScoreStreak + 1 || 1;
} else {
    ps[i].lowScoreStreak = 0;
}
```

---

## 📌 触发行为（关键）

```js
if (ps[i].lowScoreStreak >= 3) {
    ps[i].isLowQualityRegion = true;
}
```

---

## 📌 LQB作用（只做“标记”）

❌ 不删除
❌ 不改 score
✔ 只做“区域标签”

---

# 📡 四、adTTL（广告衰减机制）规范实现

## 📌 目标

处理：

> 广告段落“污染扩散”

---

## 📌 参数

```js
AD_TTL_INIT = 3
AD_DECAY = 1
AD_BOOST_NEAR_AD = 0.15
```

---

## 📌 初始化（来自 structFilter）

```js
if (ps[i].isAd) {
    ps[i].adTTL = AD_TTL_INIT;
}
```

---

## 📌 衰减规则（每段执行）

```js
if (ps[i-1]?.adTTL > 0) {
    ps[i].adTTL = ps[i-1].adTTL - AD_DECAY;
} else {
    ps[i].adTTL = 0;
}
```

---

## 📌 广告影响传播（核心）

```js
if (ps[i].adTTL > 0) {
    ps[i].score *= 0.85; // 轻度压制
}
```

---

## 📌 adTTL扩散（关键行为）

```js
if (ps[i].score < 80 && ps[i-1]?.adTTL > 0) {
    ps[i].isAdCandidate = true;
}
```

---

# 🔗 五、LQB + adTTL 如何共用（重点）

## ✔ 共享机制：同一个“段落状态层”

```text
extractP
   ↓
structFilter
   ↓
baseScore
   ↓
🧠 LQB（连续性检测）
   ↓
📡 adTTL（污染扩散）
   ↓
smooth
   ↓
Kadane
```

---

## ✔ 两者分工

| 模块    | 作用              |
| ----- | --------------- |
| LQB   | 判断“这一片是不是低质量区域” |
| adTTL | 判断“广告是否污染扩散”    |

---

# ⚠️ 六、关键设计边界（非常重要）

## ❌ 不允许

* LQB 修改 score
* adTTL 删除节点
* LQB 和 Kadane 直接耦合
* adTTL 参与排序

---

## ✔ 允许

* LQB → 标记区域
* adTTL → 调整 score（轻权重）
* Kadane → 只做区间选择

---

# 🧪 七、为什么这样拆是正确的

## ✔ LQB负责“结构判断”

👉 连续性问题（是不是垃圾区域）

## ✔ adTTL负责“污染传播”

👉 广告是否影响周围内容

## ✔ Kadane负责“最终选区”

👉 找最大子数组

---

# 📌 八、一句话工程定义

> LQB = “检测连续低质量结构”
> adTTL = “模拟广告影响扩散”
> Kadane = “最终选取正文区间”

---

# 🧾 九、最终总结（给 Mimo 可直接写进报告）

✔ LQB 与 adTTL 必须共存
✔ 但职责完全不同
✔ 共享 ps[] 状态结构
✔ 不允许影响排序与 Kadane 结构
✔ 只做“标记 + 轻权重调整”

---

如果你们下一步要做工程收敛，我可以帮你们再补一版：

> 🔬 “Tecko-R 状态机完整时序图（extract → LQB → adTTL → Kadane）”

那一版会直接能画架构图进文档。
