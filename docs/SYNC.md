# SYNC.md — 与上游长期同步的方案

本仓库是 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 的 fork，同时还会从源扩展
[YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine)
取移植内容（莱茵生命 / 卡兹戴尔 / 雷姆必拓）。这份文档回答一个问题：

> **上游更新了，我该怎么把它拿进来，而不是每次手工搬一遍？**

结论先写在这里：**没有一种方案能「一键全自动」**。原因是本 fork 与两边的**门控机制不兼容**（见 §1），所以
可长期维护的做法是「**自动筛出可采纳的部分 + 手工合剩下的**」，配套一个只读体检器（§3）。

---

## 1. 为什么不能整体 merge

实测（不是推测）：

```bash
git fetch https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine codex/rhine-upstream-021
git merge --no-commit --no-ff FETCH_HEAD
# → 108 个冲突文件
```

而且这不是「冲突多」的问题，是**机制冲突**：

| | 上游 / 源扩展 | 本 fork |
|---|---|---|
| 内容门控 | `rhineEnabled` 一个布尔（142 处引用）+ `data/vanilla/` 一整套 profile（26 个 JSON） | `packId` 字段 + `packEnabled()`，逐记录 strip（`shared/packData.js`） |
| 「关闭 = 原版」怎么表达 | 换一份数据 profile | 提交**全开真相**，运行时**剥掉**（strip 语义） |
| 数据从哪来 | 手改 / profile 覆盖 | **绝不手改** `data/*.json`，一律走 `tools/fork-overrides.mjs` → `tools/fork-data.mjs` |

⇒ 上游的一处功能改动，在本 fork 里往往要**换一种接线方式**才能落地。整体 merge 会同时带进大量未要求的改动，
并打断已经跑通的自定义功能。

**但两边是同一个仓库的兄弟 fork**，这一点很重要：实测同根于提交 `01a44cd2`，**merge-base 就是本 fork 打过的
`v0.3.0` 标签（`c24e17ee`）**。所以：

- 历史是连通的 ⇒ 可以 `git show` / `git diff` / `cherry-pick` 直接取上游的实现，而**不是**照文档手抄；
- 也让§3 的三方比对成为可能。

---

## 2. 四条路，各自的取舍

按「自动化程度 × 冲突可控性」排序。**推荐 A + D 组合**。

### A. 选择式移植（推荐，日常主用）

用 `tools/upstream-sync.mjs` 算出「哪些文件可以直接采纳、哪些必须手工合」，然后分批搬。

```bash
git remote add rhine https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine
git fetch rhine codex/rhine-upstream-021:refs/remotes/rhine/tip

node tools/upstream-sync.mjs doctor --remote rhine/tip    # 先看规模
node tools/upstream-sync.mjs list --class ADOPT --remote rhine/tip   # 可直接采纳的清单
node tools/upstream-sync.mjs fetch server/sim/content/kazdel.js --remote rhine/tip  # 打印取件命令
```

**优点**：冲突范围在动手前就确定；`ADOPT` 类可以放心采纳；每批是一个可审的 PR；不会打断自定义功能。
**缺点**：`BOTH` 类仍需手工合；要懂两边的门控差异。
**适用**：**日常所有上游更新**。

### B. 整体 merge 上游

```bash
git remote add upstream https://github.com/sganggs/Stronghold-Protocol
git fetch upstream --tags
git merge upstream/master
```

**优点**：一次拿全；拿到的历史最完整。
**缺点**：本 fork 实测**必然大量冲突**（自定义功能分布在数据层、服务端规则、客户端渲染三处）；解错一次就
静默破坏功能。
**适用**：**只在你确认这批上游改动很小**（比如纯文档、纯测试）时；或作为**反面参照**——先 `merge --no-commit`
数一下冲突数，再决定。

> ⚠️ 源扩展（Rhine）**不要**用这条。它的 `data/vanilla/` profile 与本 fork 的 strip 语义直接对立，merge 会把
> 两套门控同时带进来。

### C. GitHub Actions 定时开同步 PR

`.github/workflows/` 里加一个定时任务：fetch 上游 → 试 merge → **只开 PR，绝不自动 merge**。

**优点**：上游一动你就收到提醒，不用自己盯。
**缺点**：见 §5 —— 本仓库**不开 GitHub CI**（用户长期约束），而且这个 fork 的冲突需要人来判断，自动 PR 只能
当「有新东西了」的提醒，不能当结果。
**适用**：**想被提醒**时。若用，务必只开 PR、不自动合。

### D. Tracked-fork / Pull App（把上游同步当成外部服务）

GitHub 上有第三方 App（如 **Pull App**、`aormsby/Fork-Sync-With-Upstream-action`）可以在上游更新时把上游
**合并进你的 fork**。配置大致是：装 App → 选 `upstream` 与目标分支 → 它定期开一个 merge commit 到你的仓库。

**优点**：零维护，纯点选。
**缺点**：它做的正是 §1 判定「不可行」的那件事——**机械 merge**。对本 fork，结果是每次都产生一大坨冲突或
（更糟）在冲突处的自动选择里丢掉自定义功能。
**适用**：**仅当 fork 与上游的分歧很小**。本仓库不适合，这里列出只为让你知道它为什么不适合。

---

## 3. `tools/upstream-sync.mjs` —— 只读体检器

它不替你合代码，只把边界算清楚。三方比对：

| 类 | 判据 | 处置 |
|---|---|---|
| `ADOPT` | 本仓没动过、上游动了 | **可直接采纳**（`git checkout <remote>/HEAD -- <path>`） |
| `BOTH` | 两边都动过 | **必须手工合**（本仓的改动要保住） |
| `ADDED` | 本仓还没有 / 上游新增 | 按需新增 |
| `GONE` | 上游删了 | 确认本仓是否也要删 |
| `KEEP` | 本仓独有改动 | 与本次同步无关 |
| `SAME` | 两边一致 | 无需动作 |

```bash
node tools/upstream-sync.mjs doctor                          # 体检：四类各多少、可自动采纳比例
node tools/upstream-sync.mjs doctor --only kazdel,rem        # 只看某个功能的面
node tools/upstream-sync.mjs list --class BOTH               # 冲突清单
node tools/upstream-sync.mjs files <revA> <revB>             # 一批要同步的文件
```

实测（源扩展最新 `codex/rhine-upstream-021`，本 fork 的 `HEAD` 对它，`docs/test` 之外的口径）：

| 类 | 文件数（代码） |
|---|---|
| `ADOPT` | 171（111） |
| `ADDED` | 255（126） |
| `BOTH` | **150（91）** |
| `GONE` | 5（0） |
| `SAME` | 3（3） |

也就是说在「本仓与上游都存在的代码文件」里，**约 55% 可以直接采纳，45%（91 个）必须手工合** —— 这就是
「不能一键全自动」的量化依据。（`ADDED` 那 255 个是上游多出来的文件，多数属于上游自己的发行/文档/测试面，
要按需挑，不能整批倒进来。）

### 循环用例：搬一个功能

```bash
# 1. 先看清边界
node tools/upstream-sync.mjs doctor --only kazdel --remote rhine/tip

# 2. 可直接采纳的，逐个过一眼再 checkout（不要脚本批量 checkout 后不看）
git checkout rhine/tip -- server/sim/content/kazdel/cannon.js

# 3. 要改接线的（数据层、MOD_KEYS、packEnabled），按本仓约定改写：
#    - 数据一律走 tools/fork-overrides.mjs，不手改 data/*.json
#    - 门控用 packId + packEnabled（不是 rhineEnabled / data profile）
#    - 开关默认关闭 ⇒ 生成物与上游逐字节相同

# 4. 只跑定向测试（用户约束），再开一个主题单一的 PR
node --test test/pack-*.test.js
```

---

## 4. 落地清单（照这个顺序做）

1. `git remote add rhine <源扩展地址>` + `git fetch`（**已做**，ref 为 `rhine/tip`）。
2. 每次同步前跑 `node tools/upstream-sync.mjs doctor`，把 `ADOPT` 与 `BOTH` 分开。
3. `ADOPT` 逐个采纳；`BOTH` 手工合，每合一个就记下**为什么本仓不能照抄**（这是最有价值的记录）。
4. 数据层永远走 `tools/fork-overrides.mjs` + `node tools/fork-data.mjs`，用 `test/fork-data.test.js` 当漂移守卫。
5. 每个功能一个 PR，base 永远是 `master`。
6. 部署目录没有 `.git`，master 一动要手动同步，并**单独核删除集**。

---

## 5. 与本仓库其它约束的关系

- **不开 GitHub CI**（用户长期约束）⇒ §2C 的 Actions 只能当提醒，不能当门禁；所有验证在本地跑定向测试。
- **绝不手改 `data/*.json`**（`AGENTS.md`）⇒ 任何从上游取来的数据改动都要**翻译成 override**，不能直接
  `git checkout` 数据文件。`upstream-sync` 把 `data/*.json` 也列出来，正是为了让你看见它们并**绕开**。
- **开关默认关闭 ⇒ 生成物与上游逐字节相同**（`docs/FORK.md`）⇒ 移植来的内容必须带自己的 `packId`，由
  `packEnabled` 门控，而不是无条件写进数据。
