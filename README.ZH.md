# 小刀电子表格 (Xiaodao Spreader)

[中文](./README.ZH.md) | English

基于 Canvas 的高性能 Vue 3 电子表格组件，在网页中提供类 Excel 的编辑体验。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.4+-42b883.svg)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.0+-646CFF.svg)](https://vitejs.dev/)

![预览](./img/preview.png)

---

## 目录

- [功能特性](#功能特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [基础用法](#基础用法)
- [Props 属性](#props-属性)
- [数据模型](#数据模型)
- [架构设计](#架构设计)
- [键盘快捷键](#键盘快捷键)
- [公式引擎](#公式引擎)
- [数字格式](#数字格式)
- [主题与国际化](#主题与国际化)
- [开发指南](#开发指南)
- [构建发布](#构建发布)
- [路线图](#路线图)
- [贡献指南](#贡献指南)
- [开源协议](#开源协议)
- [English Version](./README.md)

---

## 功能特性

### 核心电子表格

- **Canvas 2D 渲染** — 高 DPI 自适应（DPR 缩放），虚拟视口渲染，支持 200 行 × 26 列
- **多 Sheet 工作簿** — 标签栏支持新建、重命名、复制、删除、拖拽排序
- **公式引擎** — 支持 `=SUM()`、`=AVERAGE()`、`=COUNT()`、`=IF()`、`=VLOOKUP()`、`=CONCATENATE()`，支持依赖追踪与循环引用检测；工具栏与右键菜单提供一键求和/平均值/计数
- **合并单元格** — 合并居中、跨列合并、取消合并，边框自动同步
- **丰富单元格格式** — 字体、字号（5–72）、加粗、斜体、下划线、删除线、文字颜色、填充颜色、水平/垂直对齐、自动换行
- **边框** — 上/下/左/右/全部/无，5 种预设样式及自定义颜色
- **撤销 / 重做** — 单元格、列宽、行高的完整状态快照（50 步）
- **格式刷** — 复制并应用单元格格式到任意区域
- **数字格式** — Excel 风格数字格式（常规 / 文本 / 数值 / 货币 / 会计 / 百分比 / 科学计数 / 日期 / 时间 / 日期时间 / 持续时间），提供自定义格式对话框；仅影响显示，绝不修改底层单元格值

### 交互体验

- **智能选区** — 点击、拖拽、Shift+点击、行/列标题选择、全选按钮
- **双击编辑** — 行内编辑器，使用 `<textarea>` 支持多行输入
- **编辑栏** — 专用编辑栏，带单元格地址标签及实时公式显示
- **完整键盘导航** — 方向键、Tab、Enter、Home、End、Ctrl+Home、Ctrl+End
- **上下文菜单** — 智能识别当前区域（单元格、行、列、Sheet 标签），支持多级子菜单
- **行/列操作** — 右键菜单插入、删除、剪切、复制、粘贴
- **列宽/行高** — 拖拽调整，实时预览，双击自动适配
- **触摸支持** — 滑动滚动，双击进入编辑模式
- **响应式** — ResizeObserver 监听容器尺寸变化

### 视觉体验

- **明/暗双主题** — 完整的调色板，50+ CSS 自定义属性
- **国际化** — 内置中文（zh-CN）与英文（en-US）
- **溢出工具栏** — 响应式工具栏，自动将溢出按钮折叠到下拉菜单
- **自定义滚动条** — 仿原生滚动条，带箭头按钮及可拖拽滑块

---

## 安装

```bash
# pnpm（推荐）
pnpm add xiaodao-spreader

# npm
npm install xiaodao-spreader

# yarn
yarn add xiaodao-spreader
```

### Peer 依赖

- `vue` ^3.4.0

---

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/xiaodaozhi/xiaodao-spreader.git
cd xiaodao-spreader

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

访问 `http://localhost:5173` 查看演示应用。

---

## 基础用法

```vue
<template>
  <Spreader
    v-model:data="myData"
    :row-count="100"
    :col-count="12"
    theme="light"
    locale="zh-CN"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Spreader from 'xiaodao-spreader';
import type { SheetModelData } from 'xiaodao-spreader';

const myData = ref<SheetModelData[]>([
  {
    name: 'Sheet1',
    cells: {
      '0,0': { value: '姓名' },
      '0,1': { value: '年龄' },
      '1,0': { value: '张三', style: { fontSize: 14, fontWeight: 'bold' } },
      '1,1': { value: '28' },
    },
    colWidths: { 0: 120, 1: 80 },
  },
]);
</script>
```

---

## Props 属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `data` (v-model) | `SheetModelData[]` | `[]` | 多 Sheet 数据（双向绑定） |
| `rowCount` | `number` | `200` | 每个 Sheet 的总行数 |
| `colCount` | `number` | `26` | 每个 Sheet 的总列数 |
| `width` | `number \| string` | — | 组件宽度（像素；传 `string` 或省略则自适应） |
| `height` | `number \| string` | — | 组件高度（像素；传 `string` 或省略则自适应） |
| `theme` | `'light' \| 'dark'` | `'light'` | 主题模式 |
| `locale` | `string` | `'zh-CN'` | 语言 — `'zh-CN'` \| `'en-US'` |

---

## 数据模型

### `SheetModelData`

用于 v-model 双向绑定的外部数据格式：

```typescript
interface SheetModelData {
  name: string;
  cells: Record<string, {
    value: string;
    style?: Record<string, unknown>;
  }>;
  merges?: Record<string, SelectionRange>;
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
}
```

- **`cells`**：键为 `"列,行"` 格式（如 `"0,0"` 代表 A1 单元格）。
- **`style`**：类 CSS 样式属性（`fontSize`、`fontWeight`、`color`、`background` 等）。
- **`merges`**：合并单元格定义，以合并锚点单元格为键。
- **`colWidths` / `rowHeights`**：稀疏映射 — 仅存储非默认值。

### 类型导出

```typescript
import type {
  CellCoord,       // { col: number; row: number }
  SelectionRange,  // { startCol; startRow; endCol; endRow }
  CellData,        // { value: string; style: Record<string, unknown> | null }
  Range,           // { start: number; end: number }
  SpreadsheetOptions,
  SpreadsheetData,
  SheetModelData,  // ← 主要数据接口
  SheetState,      // 内部运行时状态
  UndoSnapshot,
  ContextMenuItem,
  ThemeColors,
  Point,
} from 'xiaodao-spreader';
```

---

## 架构设计

```
src/
├── index.ts                          # 库入口 — 从 spreader/ 统一 re-export
├── App.vue                           # 演示应用
└── components/
    └── spreader/
        ├── index.ts                  # 统一导出口 — 组件 + 类型（barrel）
        ├── components/
        │   ├── spreader.vue          # 入口组件 — 模板 + 样式 + 组合
        │   ├── toolbar.vue           # 工具栏（含溢出下拉）
        │   ├── tabbar.vue            # Sheet 标签栏
        │   ├── dropdown.vue          # 通用下拉组件
        │   └── pickers/
        │       ├── colorPicker.vue
        │       ├── borderPicker.vue
        │       ├── mergePicker.vue
        │       └── numberFormatDialog.vue
        ├── composables/
        │   ├── core-state.ts        # Props、cells/merges/selection、字体度量、导航
        │   ├── undo-styles.ts       # 撤销重做、格式刷、字体/对齐/颜色
        │   ├── borders-merge.ts     # 边框同步、合并操作、剪贴板、求和
        │   ├── sheets-ops.ts        # 行列增删、多 Sheet、v-model 发射、主题、refs
        │   └── interactions.ts      # 渲染器、编辑栏、标签栏、右键菜单、滚动条、事件
        └── core/
            ├── constants.ts         # 布局常量、国际化、主题调色板
            ├── types.ts             # 全部类型定义
            ├── formula.ts          # 公式引擎（解析、计算、依赖、缓存）
            ├── number-format.ts    # 数字格式引擎（Excel 风格显示格式化）
            ├── theme.ts             # 主题 CSS 变量构建
            └── utils.ts            # 纯工具函数（列标签、命中测试、尺寸解析）
```

### 设计原则

- **组合式 API**：所有业务逻辑抽取到 `composables/`，保持单一职责
- **Barrel 导出**：`spreader/index.ts` 集中导出组件和全部类型，`src/index.ts` 再统一 re-export，外部统一从 `xiaodao-spreader` 引入
- **Canvas 2D 渲染**：仅绘制可视区域（虚拟渲染），大表流畅
- **无脏标记**：在交互结束点手动调用 `scheduleRender()`；`requestAnimationFrame` 自动合并同一帧的多次调用
- **共享状态**：将 `CoreState` 注入每个 composable，实现跨模块通信而不产生紧耦合
- **Reactive 包装**：composable 返回值通过 `reactive()` 包装，模板中自动解包 ref/computed

---

## 键盘快捷键

### 导航

| 按键 | 功能 |
|------|------|
| `↑` `↓` `←` `→` | 移动活动单元格 |
| `Tab` / `Shift+Tab` | 向右 / 向左移动 |
| `Enter` / `Shift+Enter` | 向下 / 向上移动 |
| `Home` / `End` | 跳到首列 / 末列 |
| `Ctrl+Home` / `Ctrl+End` | 跳到 A1 / 右下角 |
| `PageUp` / `PageDown` | 向上 / 向下翻页 |

### 编辑

| 按键 | 功能 |
|------|------|
| `F2` / `双击` / `直接输入` | 进入编辑模式 |
| `Enter`（编辑中） | 提交并向下移动 |
| `Tab`（编辑中） | 提交并向右移动 |
| `Escape`（编辑中） | 取消编辑 |
| `Ctrl+Enter` | 多行单元格内换行 |
| `Delete` / `Backspace` | 清除选区内容 |

### 剪贴板与历史

| 按键 | 功能 |
|------|------|
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | 复制 / 剪切 / 粘贴 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+A` | 全选 |

### 格式

| 按键 | 功能 |
|------|------|
| `Ctrl+B` | 加粗 |
| `Ctrl+I` | 斜体 |
| `Ctrl+U` | 下划线 |

---

## 公式引擎

### 支持的公式

| 公式 | 语法 | 说明 |
|------|------|------|
| `SUM` | `=SUM(A1:B5)` | 区间求和 |
| `AVERAGE` | `=AVERAGE(A1:B5)` | 区间平均值 |
| `COUNT` | `=COUNT(A1:B5)` | 统计区域内数值单元格数 |
| `IF` | `=IF(A1>5, A1*2, 0)` | 条件分支；支持比较运算符（`> < >= <= = <>`）与四则运算 |
| `VLOOKUP` | `=VLOOKUP(value, A1:C5, 2, FALSE)` | 垂直查找；默认精确匹配，`TRUE` 为近似匹配 |
| `CONCATENATE` | `=CONCATENATE(A1, " ", B1)` | 将多个值拼接为字符串 |
| 绝对引用 | `$A$1` | 锁定列与行 |
| 混合引用 | `$A1`、`A$1` | 仅锁定列或行 |

### 依赖追踪

`FormulaDeps` 类维护双向依赖图：

- **正向**：`formulaKey` → `[depKey, ...]` — 公式引用了哪些单元格
- **反向**：`depKey` → `Set<formulaKey>` — 哪些公式依赖此单元格

单元格变更时，脏标记通过反向图传播。循环引用通过独立的 `inProgress` 集合检测，返回 `#ERROR`。

### 粘贴时的引用偏移

`shiftFormulaRefs()` 在粘贴时自动调整公式中的单元格引用，支持 `$` 绝对引用锁定。

---

## 数字格式

一套 Excel 风格的数字格式引擎（`spreader/core/number-format.ts`），控制**单元格值的显示方式**——绝不修改存储的 `value`（始终保持原始字符串）。

### 分类

| 分类 | 示例显示 | 格式代码 |
|------|----------|----------|
| 常规 General | 自动（数值；极大/极小用科学计数法） | ``（空串） |
| 文本 Text | 原样显示 | `@` |
| 数值 Number | `1,234.56` | `#,##0.00` |
| 百分比 Percent | `12.34%` | `0.00%` |
| 科学计数 Scientific | `1.23E+03` | `0.00E+00` |
| 货币 Currency | `¥1,234.56` / `$1,234.56` | `¥#,##0.00` |
| 货币（取整）Currency (rounded) | `¥1,235` | `¥#,##0` |
| 会计 Accounting | 负数 `(¥1,234.56)` | `¥#,##0.00;(¥#,##0.00);¥"-"` |
| 财务 Financial | 负数 `[Red](#,##0.00)` | `#,##0.00;[Red](#,##0.00)` |
| 日期 Date | `2026年8月24日` / `8/24/2026` | `yyyy"年"m"月"d"日"` |
| 时间 Time | `13:45:30` | `h:mm:ss` |
| 日期时间 Date & Time | `2026年8月24日 13:45:30` | `yyyy"年"m"月"d"日" h:mm:ss` |
| 持续时间 Duration | `26:30:00` | `[h]:mm:ss` |
| 自定义 Custom | 用户自定义 Excel 风格代码 | — |

### 工作原理

- **存储**：格式代码按单元格存入 `cell.style.numberFormat`（字符串）。省略该属性（或空串）即常规格式。
- **界面**：工具栏数字格式下拉框将预设应用到当前选区；**「格式…」** 项打开 `numberFormatDialog.vue`，可自定义格式代码、小数位数与千位分隔符。
- **显示**：`formatNumber(value, format, locale)` 解析代码（带缓存），应用千位分隔 / 小数位 / 百分比缩放 / 日期序列号转换，返回显示字符串。非法的日期/持续时间序列号渲染为 `###`。
- **对齐**：数值类格式默认右对齐；文本及常规下的非数值保持左对齐——与 Excel 语义一致。
- **国际化**：货币符号（`¥` / `$`）、月份与星期名称随 `locale` 属性变化。

---

## 主题与国际化

### 内置主题

```typescript
import type { ThemeColors } from 'xiaodao-spreader';

const lightTheme: ThemeColors = { /* 50+ 颜色字段 */ };
const darkTheme: ThemeColors = { /* 50+ 颜色字段 */ };
```

### CSS 变量注入

主题颜色通过 CSS 自定义属性（`--sp-*`）注入：

```css
--sp-bg, --sp-gridBg, --sp-gridLine, --sp-selectionBg,
--sp-headerBg, --sp-headerBorder, --sp-headerText,
--sp-formulaBarBg, --sp-formulaBarInputBorder,
--sp-wrapperBg, --sp-cellEditorBorder,
/* ... 以及更多 */
```

### 自定义主题

传入 `theme="dark"` 启用暗色模式，或通过包装组件覆盖 CSS 变量实现完全自定义：

```vue
<template>
  <div style="--sp-bg: #1a1a2e; --sp-cellText: #e0e0e0;">
    <Spreader v-model:data="myData" theme="dark" />
  </div>
</template>
```

### 国际化

内置语言：`'zh-CN'`、`'en-US'`。通过 `locale` 属性传入。右键菜单和工具栏标签自动本地化。

---

## 开发指南

```bash
# 安装依赖
pnpm install

# 启动开发服务器（自动热更新）
pnpm dev

# 仅做类型检查
pnpm type-check
```

开发服务器默认运行在 `http://localhost:5173`。

---

## 构建发布

```bash
# 生产构建（类型检查 + vite build）
pnpm build

# 预览生产构建
pnpm preview

# 演示/测试构建
pnpm build:demo
```

### 构建产物

| 文件 | 说明 |
|------|------|
| `dist/xiaodao-spreader.es.js` | ES 模块（供打包器使用） |
| `dist/xiaodao-spreader.umd.js` | UMD 包（供 `<script>` 直接引用） |
| `dist/style.css` | 提取的样式表 |
| `dist/types/` | TypeScript 声明文件 |

### CI/CD

项目包含 GitHub Actions 工作流（`.github/workflows/publish.yml`），用于自动发布到 npm。

---

## 路线图

### 近期

- [x] 更多公式：`COUNT`、`IF`、`VLOOKUP`、`CONCATENATE`
- [ ] 单元格背景颜色选择器
- [x] 数字格式（货币、百分比、日期、小数位数）—— *见 [数字格式](#数字格式)*
- [ ] 条件格式规则
- [ ] 自动填充拖拽手柄
- [ ] 查找与替换

### 中期

- [ ] 冻结窗格（冻结行/列）
- [ ] 数据验证（下拉列表、输入约束）
- [ ] 行列分组与折叠
- [ ] 排序与筛选
- [ ] 单元格批注
- [ ] 打印布局

### 远期

- [ ] OffscreenCanvas + Web Worker 多线程渲染
- [ ] Shared Worker 跨标签页协作
- [ ] 插件系统（自定义单元格渲染器）
- [ ] Excel / CSV 导入导出
- [ ] 图表引擎（嵌入式迷你图表）

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Vue 3（Composition API + `<script setup>`） | ^3.4 |
| 构建 | Vite | ^5.0 |
| 语言 | TypeScript（严格模式） | ~5.4 |
| 渲染 | Canvas 2D API | — |
| 类型检查 | vue-tsc | ^2.2 |
| 包管理 | pnpm | — |
| CSS | Scoped CSS + CSS 自定义属性 | — |

---

## 贡献指南

欢迎贡献代码！请按以下步骤操作：

1. Fork 仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'feat: add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 提交 Pull Request

提交前请确保类型检查通过（`pnpm type-check`）且构建成功（`pnpm build`）。

---

## 开源协议

本项目基于 MIT 协议 — 详见 [LICENSE](LICENSE) 文件。

---

**由 [xiaodaozhi](https://github.com/xiaodaozhi) 精心打造**
