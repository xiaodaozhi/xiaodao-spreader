# xiaodao-spreader — 设计文档

**中文** | [English](./DOC.md)

基于 Canvas 2D 的 Vue 3 电子表格组件。

---

## 1. 技术栈

| 层级 | 选型 | 版本 |
|---|---|---|
| 框架 | Vue 3 (Composition API + `<script setup>`) | ^3.4 |
| 构建 | Vite | ^5.0 |
| 语言 | TypeScript (strict) | ~5.4 |
| 渲染 | Canvas 2D API | — |
| 类型检查 | vue-tsc | ^2.2 |
| 包管理 | pnpm | — |

---

## 2. 文件结构

```
xiaodao-spreader/
├── index.html                          # 入口 HTML，全屏高度布局
├── package.json
├── tsconfig.json                       # strict 模式
├── tsconfig.build.json                 # 声明文件输出配置
├── vite.config.ts                      # @vitejs/plugin-vue
└── src/
    ├── main.ts                         # createApp(App).mount('#app')
    ├── index.ts                        # 库入口 — 从 spreader/ 统一转出
    ├── App.vue                         # 根组件，flex 全高容器
    ├── vite-env.d.ts
    └── components/
        └── spreader/
            ├── index.ts                # 统一桶导出 — 组件 + 类型
            ├── components/
            │   ├── spreader.vue        # 主组件（Canvas 渲染 + 全部交互逻辑）
            │   ├── toolbar.vue         # 带溢出下拉的工具栏
            │   ├── tabbar.vue          # Sheet 标签栏
            │   ├── dropdown.vue        # 通用下拉组件
            │   └── pickers/
            │       ├── colorPicker.vue
            │       ├── borderPicker.vue
            │       ├── mergePicker.vue
            │       └── numberFormatDialog.vue
            ├── composables/
            │   ├── core-state.ts      # Props、cells/merges/selection、字体度量、导航
            │   ├── undo-styles.ts      # 撤销/重做、格式刷、字体/对齐/颜色
            │   ├── borders-merge.ts    # 边框操作、合并操作、剪贴板、求和/平均/计数
            │   ├── sheets-ops.ts      # 行列操作、多 Sheet、v-model emit、主题、refs
            │   ├── find-replace.ts    # 查找/替换状态与交互（依赖 Vue）
            │   └── interactions.ts    # 渲染器、公式栏、标签栏、右键菜单、滚动条、事件
            └── core/
                ├── constants.ts       # 布局常量、i18n 文案、主题配色
                ├── types.ts           # 全部类型定义
                ├── style-pool.ts      # 样式池：去重、注册、解析、迁移、GC
                ├── border-pool.ts     # 边框池：去重、注册、解析、迁移、GC
                ├── border-resolve.ts  # 公共边冲突解析（resolveSharedBorder）
                ├── formula.ts         # 公式引擎（解析、求值、依赖追踪）
                ├── find-replace-core.ts # 查找/替换纯算法（零 Vue 依赖，可单测）
                ├── number-format.ts    # 数字格式引擎（Excel 风格显示格式化）
                ├── theme.ts           # 主题 CSS 变量构建
                └── utils.ts           # 纯工具函数（列标转换、命中测试等）
```

**依赖方向**：`App.vue → spreader/index.ts → spreader.vue → composables/* + core/*`

---

## 3. 类型系统

全部类型定义位于 `spreader/core/types.ts`。

```typescript
// 单元格坐标（0 基）
interface CellCoord { col: number; row: number }

// 选区范围（min/max 归一化）
interface SelectionRange {
  startCol: number; startRow: number
  endCol: number; endRow: number
}

// 单边边框
interface BorderSide {
  width?: number; color?: string; style?: string;  // style 预留：solid/dashed/dotted
}

// 四边边框组合
interface BorderStyle {
  top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide;
}

// 边框来源标识
type BorderSource = 'cell' | 'merge';

// 单元格样式 — 所有样式属性的类型化接口
interface CellStyle {
  fontFamily?: string; fontSize?: number | string; fontWeight?: string;
  fontStyle?: string; underline?: string; strikethrough?: string;
  color?: string; backgroundColor?: string;
  textAlign?: string; verticalAlign?: string; wrap?: string;
  borderId?: number;  // sheet 级 borders[] 池的下标；0 或省略 = 无边框
  // borderTopWidth / borderBottomWidth / borderLeftWidth / borderRightWidth / borderColor
  //   @deprecated — 旧版内联边框属性，仅为迁移历史数据保留
  numberFormat?: string;
  numberFormatCategory?: 'custom';  // 标记常规单元格经小数位按钮自动生成的格式（自定义分类）
  [key: string]: unknown;  // 可扩展
}

// 单元格数据 — value 恒为字符串；样式通过 styleId 引用
interface CellData {
  value: string
  styleId?: number  // sheet 级 styles[] 池的下标；0 或省略 = 默认样式
}

// 范围工具类型（start/end 跨度）
interface Range {
  start: number
  end: number
}

// 表格操作外部数据格式
interface SpreadsheetOptions {
  rowCount?: number
  colCount?: number
  colWidths?: Record<number, number>
  rowHeights?: Record<number, number>
}

// 导入导出用单元格引用映射
interface SpreadsheetData {
  [cellRef: string]: { value: string; styleId?: number; style?: CellStyle }
}

// v-model 双向绑定外部数据格式
interface SheetModelData {
  name: string
  styles?: CellStyle[]  // 样式池；styles[0] 恒为 {}
  borders?: BorderStyle[]  // 边框池；borders[0] 恒为 {}
  cells: Record<string, { value: string; styleId?: number; style?: CellStyle }>
  colWidths?: Record<number, number>
  rowHeights?: Record<number, number>
  /** 逻辑列数（0 基，不含）。省略时默认为 26。 */
  colCount?: number
  /** 逻辑行数（0 基，不含）。省略时默认为 200。 */
  rowCount?: number
}

// 工作表内部运行时状态
interface SheetState {
  id: string; name: string
  cells: Record<string, CellData>
  styles: CellStyle[]  // 样式池；styles[0] 恒为 {}
  borders: BorderStyle[]  // 边框池；borders[0] 恒为 {}
  merges: Record<string, SelectionRange>
  selection: SelectionRange | null
  activeCell: CellCoord
  scrollX: number; scrollY: number
  colWidths: number[]; rowHeights: (number | undefined)[]
  /** 响应式逻辑尺寸 —— 通过 ensureCapacity 动态增长 */
  colCount: number; rowCount: number
}

// 撤销快照
interface UndoSnapshot {
  cells: Record<string, CellData>
  styles: CellStyle[]
  borders: BorderStyle[]
  colWidths: number[]; rowHeights: (number | undefined)[]
  /** 撤销/重做的逻辑尺寸快照 */
  colCount: number; rowCount: number
}

// 右键菜单项
interface ContextMenuItem {
  label: string; action?: () => void; disabled?: boolean; children?: ContextMenuItem[]
}

// 坐标点工具类型
interface Point {
  x: number; y: number
}

// 主题配色（50+ 颜色字段）
interface ThemeColors { /* 完整列表见第 10 节 */ }
```

---

## 4. 数据模型

### 4.1 核心状态

| 状态 | 类型 | 说明 |
|---|---|---|
| `cells` | `reactive<Record<string, CellData>>` | 当前 sheet 单元格数据 |
| `styles` | `reactive<CellStyle[]>` | 当前 sheet 样式池；`styles[0]` 恒为默认 `{}` |
| `borders` | `reactive<BorderStyle[]>` | 当前 sheet 边框池；`borders[0]` 恒为默认 `{}`；样式通过 `borderId` 引用边框 |
| `dims` | `reactive<{colCount: number; rowCount: number}>` | **动态逻辑尺寸** —— 由 props 初始化（默认 26/200），通过 `ensureCapacity()` 增长 |
| `selection` | `ref<SelectionRange \| null>` | 当前选区 |
| `activeCell` | `ref<CellCoord>` | 活动单元格 |
| `scrollX/Y` | `ref<number>` | 网格区滚动偏移 |
| `editingCell` | `ref<CellCoord \| null>` | 正在编辑的单元格 |
| `freeze` | `reactive<FreezePane>` | 冻结窗格视图状态 `{ rows, cols }`（值为 `{0,0}` 表示无冻结）。通过 CoreState 暴露 `setFreeze(rows, cols)` / `clearFreeze()` / `getFreeze()`。详见[第 21 节](#21-冻结窗格) |
| `editValue` | `ref<string>` | 编辑浮层实时文本 |
| `colWidths` | `ref<number[]>` | 各列宽度（默认 100px），随 `dims.colCount` 自动扩展 |
| `rowHeights` | `ref<number[]>` | 各行高度（默认 24px），随 `dims.rowCount` 自动扩展 |
| `sheets` | `ref<SheetState[]>` | 全部工作表 |
| `activeSheetIndex` | `ref<number>` | 当前激活工作表索引 |
| `undoStack` / `redoStack` | `ref<UndoSnapshot[]>` | 撤销/重做栈（最多 50 步） |

### 4.2 计算属性

| 属性 | 说明 |
|---|---|
| `colPositions` | 列位置累计前缀和 `pos[i]` = 第 i 列起始 x |
| `rowPositions` | 行位置累计前缀和 |
| `totalWidth` / `totalHeight` | 全部列/行尺寸之和 |
| `maxScrollX` / `maxScrollY` | 最大滚动范围 |
| `themeColors` | 根据 `theme` prop 选择亮/暗配色 |
| `outerStyle` | 以 CSS 变量注入主题配色 |

### 4.3 多 Sheet 切换

切换 sheet 时执行 `saveSheet()` → `loadSheet(i)`：
- `saveSheet()` 将当前 `cells`、`styles`、`borders`、`selection`、`scrollX/Y`、`colWidths`、`rowHeights` 以及 `dims`（colCount/rowCount）序列化到 `sheets[activeSheetIndex]`
- `loadSheet(i)` 从 `sheets[i]` 恢复全部状态，包括通过 `setDims()` 恢复 `dims`、通过 `syncStyles()` 同步 `styles` 池、通过 `syncBorders()` 同步 `borders` 池，并重建公式依赖图

### 4.4 v-model 数据同步

`emitModelData()` 将全部 sheet 序列化为 `SheetModelData[]`（单元格携带 `styleId` 引用 + `styles` 池数组），通过 `modelData.value = out` 触发双向绑定。使用 `lastEmittedData` 字符串比对去重，避免循环更新。

---

## 5. 布局常量与坐标系

```
HEADER_WIDTH  = 52   (行头宽度)
HEADER_HEIGHT = 24   (列头高度)
SB_SIZE       = 11   (滚动条宽/高)
ARROW_SIZE    = 11   (滚动条箭头按钮尺寸)
SCROLL_STEP   = 50   (每次点击滚动量)
DEFAULT_COL_WIDTH  = 100
DEFAULT_ROW_HEIGHT = 24
MIN_COL_WIDTH  = 30
MIN_ROW_HEIGHT = 24

默认逻辑范围：200 行 × 26 列
通过 ensureCapacity(minCol, minRow) 动态扩展，缓冲步长（8 列 / 32 行）
```

### 5.1 Canvas 布局平面

```
┌──────────┬──────────────────────────────────┐
│ 角方块    │  列头（A, B, C... Z, AA...）        │
│ 52×24    │  y: [0, 24)  x: [52, W)          │
│ 全选按钮  │                                  │
├──────────┼──────────────────────────────────┤
│          │                                  │
│ 行头      │  网格区（可滚动）                   │
│ 1,2,3... │  y: [24, H)  x: [52, W)         │
│          │                                  │
│          │                                  │
│ x: [0,52)│                                  │
├──────────┴──────────────────────────────────┤
│  横向滚动条（底部 11px）  │  纵向滚动条（右侧 11px） │
└──────────────────────────────────────────────┘
```

当工作表存在冻结窗格时，左上角 `freeze.cols × freeze.rows` 区块（及其表头边）固定在滚动网格之上/之侧 —— 详见 [第 21 节](#21-冻结窗格)。

### 5.2 坐标变换

```
鼠标客户端坐标 (e.clientX, e.clientY)
        │
        ▼  getCanvasXY(e) → canvas.getBoundingClientRect()
Canvas CSS 坐标（逻辑像素）
        │
        ▼  gridX = x - HEADER_WIDTH + scrollX
        │  gridY = y - HEADER_HEIGHT + scrollY
网格内容坐标 → 二分查找 → col/row
```

---

## 6. 渲染管线

### 6.1 调度机制

```
状态变更 → scheduleRender()
          │
          ▼
     renderPending? ──是──▶ 直接返回（合并）
          │ 否
          ▼
     renderPending = true
     requestAnimationFrame(render)
```

无脏标记、无 watcher。每次交互结束后手动调用 `scheduleRender()`。rAF 保证同一帧内多次调用只执行一次绘制。

### 6.2 render() 绘制顺序

1. Canvas 尺寸同步 + DPR 设置（`ctx.setTransform(dpr,0,0,dpr,0,0)`）
2. 背景填充 + 网格区白底
3. 可视范围计算（逐列累计判定，不用二分 — 渲染循环内直接遍历）
4. 网格区单元格（裁剪到 `[52,24]` - `[W,H]`）
   - 选区高亮 / 活动单元格边框 / 网格线 / 文本
   - 单元格边框 + 合并边界分段 + 角方块（统一经 `resolveSharedBorder` 解析）
5. 列头（含选中列高亮 + 加粗底边框）
6. 行头（含选中行高亮 + 加粗右边框）
7. 角方块
8. 滚动条由 HTML/CSS 独立渲染（非 Canvas 绘制）

### 6.3 虚拟渲染

可视范围通过遍历 `colPositions`/`rowPositions` 确定起止行列，只绘制屏幕内单元格。平均可视约 15-20 列 × 25-40 行 = 每帧 375-800 个单元格。

### 6.4 DPR 处理

全部绘制使用逻辑像素（CSS 像素），通过 `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` 统一缩放。`getCanvasXY()` 返回的鼠标坐标同样是逻辑像素。

---

## 7. 公式引擎

位于 `spreader/core/formula.ts`。

### 7.1 支持的公式

- `=SUM(A1:B5)` — 区间求和，支持绝对引用 `$A$1`
- `=AVERAGE(A1:B5)` — 区间平均值
- `=COUNT(A1:B5)` — 统计区间内数值单元格个数
- `=IF(条件, 真值, 假值)` — 条件逻辑，支持比较运算符（`> < >= <= = <>`）与分支内算术
- `=VLOOKUP(value, range, col_index, [approx])` — 垂直查找，默认精确匹配，`TRUE` 为近似匹配
- `=CONCATENATE(A1, " ", B1)` — 多值拼接为字符串

公式结果可为 `number`、`string` 或 `null`（错误）。`null` 渲染为 `#ERROR`。

### 7.2 依赖追踪

`FormulaDeps` 类维护双向依赖图：
- **正向**：formulaKey → [depKey, ...]（公式引用了哪些单元格）
- **反向**：depKey → Set<formulaKey>（哪些公式依赖该单元格）

修改单元格时，脏标记沿反向图传播。求值期间使用缓存避免重复计算。循环引用通过独立的 `inProgress` 集合检测（成环返回 `null`）。

### 7.3 求值缓存

模块级 `evalCache: Map<string, FormulaValue>` 缓存已计算的公式结果（数字、字符串或 null）。独立的 `inProgress: Set<string>` 追踪正在求值的单元格用于环检测。求值过程中：
- 若单元格在 `inProgress` 中，返回 `null`（检测到循环引用）
- 若单元格在缓存中，直接返回缓存结果
- 否则标记为进行中，求值、缓存结果、取消标记

### 7.4 显示值计算

`computeCellValue(col, row)` 判断单元格值是否以 `=` 开头：
- 是 → 调用 `evalFormula()` 求值
- 否 → 返回原始值

公式求值为 `null` 时返回 `'#ERROR'`。

### 7.5 粘贴时公式引用偏移

`shiftFormulaRefs()` 在粘贴时自动偏移公式中的单元格引用，支持 `$` 绝对引用锁定。

---

## 8. 交互模型

### 8.1 鼠标

| 操作 | 行为 |
|---|---|
| 点击网格区 | 选中单元格 |
| 拖动网格区 | 扩展选区 |
| Shift + 点击 | 从原选区起点扩展到点击位置 |
| 双击网格区 | 进入编辑模式 |
| 点击列头 | 选中整列 |
| 点击行头 | 选中整行 |
| 点击角方块 | 全选 |
| 拖动列头右边缘 | 调整列宽 |
| 拖动行头下边缘 | 调整行高 |
| 鼠标滚轮 | 滚动 |
| 右键 | 上下文菜单（按区域区分） |

### 8.2 键盘（非编辑模式）

| 按键 | 行为 |
|---|---|
| ↑↓←→ | 移动活动单元格 |
| Tab / Shift+Tab | 右移 / 左移 |
| Enter / Shift+Enter | 下移 / 上移 |
| Home | 跳到当前行 A 列 |
| End | 跳到当前行最后一列 |
| Ctrl+Home | 跳到 A1 |
| Ctrl+End | 跳到右下角 |
| F2 | 进入编辑模式 |
| Delete / Backspace | 清除选区内容 |
| Escape | 取消编辑 |
| 可打印字符 | 进入编辑模式并输入该字符 |
| Ctrl+C | 复制 |
| Ctrl+V | 粘贴 |
| Ctrl+X | 剪切 |
| Ctrl+Z | 撤销 |
| Ctrl+Y | 重做 |
| Ctrl+A | 全选 |

### 8.3 编辑模式

- **进入**：双击 / F2 / 直接输入可打印字符 / 点击公式栏
- **浮层**：`<input>` 通过计算样式绝对定位覆盖 Canvas 单元格
- **提交**：Enter（下移）/ Tab（右移）/ 失焦
- **取消**：Escape
- **公式栏**：显示当前单元格公式或值，聚焦时触发编辑模式

### 8.4 触摸

- 单指滑动 → 滚动（位移超过 8px 阈值）
- 单指点按 → 选中单元格
- 双击（300ms 内同一单元格两次点按）→ 进入编辑模式

### 8.5 右键菜单

根据点击区域显示不同的上下文菜单：

| 区域 | 菜单项 |
|---|---|
| 单元格 | 剪切 / 复制 / 粘贴 / 删除 |
| 列头 | 插入列 / 剪切 / 复制 / 粘贴 / 删除 |
| 行头 | 插入行 / 剪切 / 复制 / 粘贴 / 删除 |
| 角方块 | 剪切 / 复制 / 粘贴 / 清除全部 |
| 标签栏空白 | 新建工作表 |
| 标签项 | 新建 / 复制 / 重命名 / 删除 / 左移 / 右移 |

---

## 9. 剪贴板协议

- **格式**：TSV（Tab 分隔），行间以 `\n` 分隔
- **复制**：遍历选区 → 构建 TSV → `navigator.clipboard.writeText()`（降级：textarea + execCommand）
- **粘贴**：`navigator.clipboard.readText()` → 按行列拆分 → 以 activeCell 为左上角逐格写入，公式引用自动偏移
- **剪切**：复制后清除选区内容

---

## 10. 主题系统

### 10.1 配色

`lightTheme` 与 `darkTheme` 定义于 `spreader/core/constants.ts`，包含 50+ 颜色字段，覆盖全部 UI 元素：背景、文本、边框、滚动条、公式栏、标签栏、编辑浮层等。

`ThemeColors` 接口包含：
- 网格：`bg`、`gridBg`、`gridLine`、`selectionBg`、`activeCellBorder`、`cellText`
- 表头：`headerBg`、`headerBorder`、`headerText`、`headerSep`、`cornerBg`
- 公式栏：`formulaBarBg`、`formulaBarBorder`、`formulaBarLabelText`、`formulaBarLabelBg`、`formulaBarLabelBorder`、`formulaBarInputBg`、`formulaBarInputBorder`、`formulaBarInputText`、`formulaBarInputFocusBorder`、`formulaBarInputFocusShadow`
- 标签：`tabBarBg`、`tabBarBorder`、`tabActiveBg`、`tabActiveText`、`tabActiveBorder`、`tabInactiveBg`、`tabInactiveText`、`tabInactiveBorder`、`tabHoverBg`、`tabAddBtnColor`、`tabAddBtnHoverBg`、`tabScrollBtnColor`、`tabScrollBtnHoverBg`
- 滚动条：`scrollTrack`、`scrollThumb`、`scrollbarThumb`、`scrollbarThumbHover`、`scrollBtnBg`、`scrollBtnColor`、`scrollBtnHoverBg`、`scrollBtnActiveBg`、`scrollTrackBg`
- 编辑器：`cellEditorBorder`、`cellEditorText`、`cellEditorBg`、`cellEditorShadow`
- 容器：`wrapperBg`

### 10.2 CSS 变量注入

`buildOuterStyle()` 将主题配色转换为 CSS 自定义属性（`--sp-*`），通过 `outerStyle` 绑定到根元素。组件内的 scoped 样式引用这些变量。

---

## 11. 响应式适配

`ResizeObserver` 监听 wrapper 尺寸变化，更新 `viewSize` 并重新钳制滚动范围。若 `width`/`height` prop 为固定像素值，则跳过 ResizeObserver。

---

## 12. 撤销/重做

- **快照**：`takeSnap()` 深拷贝当前 `cells`、`styles`、`borders`、`colWidths`、`rowHeights` 以及 `dims`（colCount/rowCount）
- **入栈**：每次修改前调用 `saveUndo()`，与栈顶去重（JSON 比对）
- **撤销**：`undoStack.pop()` → `restoreSnap()`（通过 `setDims()` 恢复 dims）并重建公式依赖图
- **重做**：`redoStack.pop()` → `restoreSnap()`（通过 `setDims()` 恢复 dims）并重建公式依赖图
- **上限**：`UNDO_MAX = 50`，超出时移除最旧快照

---

## 13. 扩展点 / 路线图

### 13.1 数据层
- **更多公式**：AVERAGE、COUNT、IF、VLOOKUP 等
- **单元格样式**：样式通过 sheet 级样式池（`styles: CellStyle[]`）管理；单元格通过 `styleId`（数组下标）引用样式，相同样式自动去重。详见[第 17 节](#17-样式池)。
- **单元格边框**：边框通过独立的 sheet 级边框池（`borders: BorderStyle[]`）管理；样式通过 `borderId` 引用边框，公共边在渲染时解析。详见[第 18 节](#18-边框系统)。
- **合并单元格**：扩展数据模型存储合并信息

### 13.2 渲染层
- **冻结窗格** —— *已实现，见 [第 21 节](#21-冻结窗格)*
- **条件格式**：渲染循环中加入样式规则匹配
- **自动填充**：活动单元格右下角拖拽手柄

### 13.3 交互层
- **查找/替换** — *已实现，见[第 16 节](#16-查找与替换)*
- **数据排序/筛选** — *已实现，见[第 19 节](#19-排序)*
- **图表**

### 13.4 性能优化
- **OffscreenCanvas + Web Worker**：渲染下沉到 worker 线程
- **脏矩形重绘**：当前为全量重绘，可优化为只重绘变化区域

---

## 14. 开发注意事项

1. **Canvas DPR 一致性**：全部绘制与鼠标坐标均使用逻辑像素，由 `ctx.setTransform(dpr,0,0,dpr,0,0)` 统一缩放。

2. **状态变更后手动 `scheduleRender()`**：无自动 watcher 机制，在每个交互处理器结尾调用一次。rAF 自动合并同帧内多次调用。

3. **编辑浮层 blur 与 keydown 时序**：Enter/Tab 的 keydown 中先触发 `commitEdit`，`onEditBlur` 使用 `setTimeout(0)` 延迟，确保键盘提交不被失焦打断。

4. **命中测试**：`hitTestCol`/`hitTestRow` 使用二分查找实现（O(log n)），依赖 `colPositions` 计算属性更新。

5. **v-model 防抖**：`lastEmittedData` 字符串比对避免循环更新，单元格变更通过 `watch` 在 `nextTick` 批量 emit。

6. **TypeScript Strict**：全部函数参数与返回值均有类型标注。构建前自动执行 `vue-tsc --noEmit`。

7. **跨平台兼容**：Ctrl 键使用 `e.ctrlKey || e.metaKey` 兼容 Mac。剪贴板使用异步 API + 同步降级。

---

## 15. 数字格式引擎

位于 `spreader/core/number-format.ts`，Excel / Univer 风格的"显示格式化"引擎。

### 15.1 设计原则

- **只负责显示，绝不修改 `Cell.value`**：`Cell.value` 恒为原始字符串，格式只影响 Canvas 渲染时的显示文本。
- **按格式代码缓存解析结果**：`parseNumberFormat()` 内部用 `Map` 缓存，避免 Canvas 每帧重复解析（性能）。
- **纯函数，零 Vue 依赖**：便于测试与复用。

### 15.2 存储

格式代码存储在解析后样式的 `numberFormat` 属性中（字符串），按单元格存储。存储约定：

- 属性缺失 / 空字符串 = 常规（General）。
- 文本 = `'@'`。
- 常规格式下，若原始值可解析为有限数字，则按"数字"语义自动决定显示（极大/极小用科学计数），默认右对齐。
- **日期/时间输入自动识别（仅常规单元格，对齐 Excel）**：通过 `setCellValue` 提交值时，若单元格当前格式为常规且输入命中常见模式，会自动转换为 Excel 序列值并套用对应格式代码——日期（`yyyy-m-d`、`yyyy/m/d`、`yyyy年m月d日`、`m-d`/`m/d` 补当前年）、时间（`h:mm`、`h:mm:ss`）、日期时间（日期 + 空格/`T` + 时间）。非法日期（如 `2023-2-29`、月/日越界）与不匹配的文本保持纯文本。套用的代码为 locale 日期/日期时间预设与 `h:mm:ss`，因此工具栏下拉会回显对应预设。序列号遵循 1900 日期系统，含 1900 闰年修正（`core/number-format.ts` 的 `parseDateTimeInput`）。

### 15.3 分类与格式代码

支持 常规 / 文本 / 数值 / 货币 / 会计 / 财务 / 百分比 / 科学计数 / 日期 / 时间 / 日期时间 / 时长 / 自定义。常用格式代码见 README 的数字格式表格。

关键行为：

- **百分比 `%`**：乘以 100 缩放（`scale = 100`）。
- **会计 / 财务**：通过 `;` 分隔的 正数/负数/零 分段实现；财务支持 `[Red]` 条件色。
- **日期 / 时间**：单元格值视为 Excel 1900 日期序列号（1 = 1900-01-01，使用 UTC 构造避免时区偏移）。非法序列号（日期超出 [0, 2958465]、时长 < 0）返回 `__NF_INVALID__`，渲染器将其替换为一串 `#`。
- **时长 `[h]:mm:ss`**：总小时数可超过 24。

### 15.4 渲染与对齐

- `formatNumber(value, format, locale)` 是顶层入口，返回显示字符串（绝不修改 value）。
- `shouldAlignRightByDefault(value, format)`：数字格式与常规下的有限数字默认右对齐；文本与常规下的非数字保持左对齐 — 与 Excel 一致。
- `isFormatOverflowsToHashes(format)` / `isInvalidDisplayValue(value, format)`：供渲染器判断是否以 `#` 填充显示。
- **i18n**：货币符号（`¥` / `$`）、月份与星期名跟随 `locale`。

### 15.5 界面

- 工具栏"数字格式"下拉（`buildNumberFormatPresets`）提供预设：常规、文本、数值、百分比、科学计数、会计、财务、货币、货币（取整）、日期、时间、日期时间、时长，以及"格式…"自定义项（`NF_CUSTOM`）。
- "格式…"打开 `numberFormatDialog.vue`，可输入自定义格式代码、小数位数与千分位分隔符。
- 下拉右侧的「增加/减少小数位数」按钮对数值类格式（数字/百分比/货币等）与值可解析为数字的常规单元格逐格步进小数位，边界 0–30，不支持或达边界时按钮置灰。对常规单元格生成的格式会额外标记 `numberFormatCategory: 'custom'`：下拉回显为"其他数字格式…"（自定义），对话框打开时分类直接显示"自定义"；用户显式选择格式（下拉或对话框应用）会清除该标记。
- 当选区内格式不一致时，`selNumberFormat` 返回 `NF_MIXED`（特殊标记 `0x01`），下拉显示"混合"。
- 下拉回显按分类归一化（`normalizeNumberFormatForDisplay`，仅用于显示）：不在预设列表中的代码（增减小数位产生的非默认小数位、对话框改过的货币符号、非默认日期/时间变体等）映射到对应分类的预设项显示（分类规则与对话框 `detectFromCode` 一致），无法识别的代码显示"其他数字格式…"（自定义）。`selNumberFormat` 保留原始代码供存储/对话框使用，`selNumberFormatDisplay` 仅供工具栏回显。

---

## 16. 查找与替换

位于 `composables/find-replace.ts`（状态与交互）与 `core/find-replace-core.ts`（纯算法，零 Vue 依赖，可单测）。界面由 `find-replace-bar.vue` 提供；工具栏新增查找按钮，通过 `Ctrl/Cmd+F`（也支持 `Ctrl/Cmd+H`）打开。

### 16.1 设计原则

- **基于原始 `Cell.value`**：始终读取单元格 `value`（字符串），**而非** Canvas 格式化后的显示文本，因此独立于数字格式、公式等显示层。
- **算法 / UI 分离**：纯匹配/替换函数（`cellMatches` / `replaceFirst` / `replaceAllOccurrences` / `scanSheetCells`）无 Vue 依赖，便于单测。
- **复用既有能力**：定位复用既有 Selection（`selectCell` / `activeCell` / `ensureVisible`）与多 Sheet（`switchSheet`）；撤销/重做复用 `undo-styles` 快照机制。

### 16.2 搜索范围

| 范围 | 实现 |
|-------|----------------|
| 当前工作表（默认） | 仅扫描 `s.cells`（活动表） |
| 整个工作簿 | 遍历 `so.sheets.value` 中所有工作表的 `cells`，记录 `sheetIndex`；定位时跨表自动 `switchSheet` 并滚动 |
| 当前选区 | 将 `s.selection` 矩形作为 `range` 传入 `scanSheetCells`；定位时仅移动 `activeCell`，保留原选区矩形 |

### 16.3 匹配与替换规则

- **匹配**：默认不区分大小写、非精确（子串）匹配；支持"区分大小写"与"单元格匹配"。
- **替换**：替换只修改 `Cell.value`，经 `String()` 强转保持字符串类型，保留 `styleId` / `numberFormat` / 边框 / 合并。单元格内多处匹配时，单次替换只改第一处；全部替换改全部。
- **`$` 安全**：不区分大小写的全部替换使用正则回调形式 `() => replace`，避免 `replace` 字符串中的 `$&` / `$1` 被当作分组引用。

### 16.4 撤销 / 重做接入

- 单次"替换"仅在内容实际变化时调用 `us.saveUndo()`。
- "全部替换"在循环外调用一次 `us.saveUndo()`（每次操作一个撤销点），并遍历 `results` 快照，避免重算过程中 `results` 变化导致漏改。
- 撤销/重做后，watch `undoStack` / `redoStack` 长度变化触发结果重算，保持搜索状态与匹配高亮同步。

### 16.5 高亮与定位

- 通过 `s.findHighlight(col, row)` 钩子注入渲染：普通匹配返回 `'match'`，当前项返回 `'active'`。`interactions.ts` 在渲染背景阶段填充 `findMatchBg` / `findActiveBg`，并对当前项描边强调。
- 循环查找：取模实现首尾衔接；`Enter` = 下一个，`Shift+Enter` = 上一个，`Esc` 关闭（均在查找栏内处理）。编辑模式下 `onKeydown` 已 `return`，全局 `Ctrl/Cmd+F/H` 不与单元格编辑快捷键冲突。
- 性能：扫描数据模型，零 DOM；重算用 `requestAnimationFrame` 防抖，仅当 关键词 / 范围 / 规则 / 单元格数据 / 替换词 变化时重新搜索。

---

## 17. 样式池

位于 `spreader/core/style-pool.ts`。实现 sheet 级样式去重，降低重复样式数据的存储开销。

### 17.1 核心思路

- 每个 sheet 维护一个 `styles: CellStyle[]` 数组；`styles[0]` 恒为默认空样式 `{}`。
- 单元格通过 `styleId`（数组下标）引用样式，而非内联完整样式对象。
- 相同样式（即使属性顺序不同）自动复用同一 `styleId`。
- 已注册的样式对象不可直接修改（`Object.freeze`）；修改需复制后重新注册。

### 17.2 StylePool 类

| 方法 | 说明 |
|--------|-------------|
| `get(styleId)` | 按 styleId 获取样式对象（只读，`Object.freeze`） |
| `getId(style)` | 查找或注册样式，返回其 styleId（相同内容自动复用） |
| `getStyles()` | 返回 styles 数组浅拷贝（供持久化/快照） |
| `setStyles(styles)` | 直接设置 styles 数组（供恢复快照），重建索引 |
| `compactStyles(cells)` | 样式 GC：扫描 cells 实际使用的 styleId，丢弃未引用样式，重新生成连续 id |

**稳定 key 生成**：属性名排序后 `JSON.stringify`，使内容相同但属性顺序不同的样式产生相同 key。

### 17.3 辅助函数

| 函数 | 说明 |
|----------|-------------|
| `resolveStyle(cell, styles)` | 按 styleId 从 styles 数组获取样式对象；styleId 缺失或为 0 时返回 null |
| `updateCellStyle(cell, patch, pool)` | 读旧样式 → 复制 → 合并 patch → 注册入池 → 更新 styleId |
| `unsetCellStyle(cell, key, pool)` | 移除单元格的单个样式属性 |
| `updateCellsStyle(cells, patch, pool)` | 批量更新多个单元格的样式 |
| `migrateCells(oldCells)` | 迁移旧格式单元格（`{value, style}`）为新格式（`{value, styleId}`），自动去重并生成 styles 数组 |
| `cloneCells(src)` | 深拷贝 cells（保留 styleId 引用） |

### 17.4 CoreState 集成

`CoreState` 持有响应式 `styles: CellStyle[]` 数组与闭包 `styleIndex: Map<string, number>`，对外暴露：

- `registerStyle(style)` → `number`：查找或注册样式，返回 styleId
- `resolveStyle(cell)` → `CellStyle | null`：解析单元格样式
- `syncStyles(styles)`：从外部 styles 数组恢复（重建 styleIndex）
- `rebuildStyleIndex()`：从当前 styles 数组重建索引

### 17.5 序列化格式

`SheetModelData` 包含 `styles?: CellStyle[]`。序列化时：

- `styleId=0` 的单元格省略该字段（默认样式）；只输出 `styleId > 0` 的单元格。
- `styles` 数组仅在长度 > 1（存在非默认样式）时输出。
- `index`（Map）仅运行时使用，不序列化。

### 17.6 旧数据兼容

`migrateCells()` 将旧格式 `{value, style}` 转换为新格式 `{value, styleId}`：

- 扫描每个单元格的 `style` 属性，注册到临时 StylePool。
- 已携带 `styleId` 的单元格保持原样。
- 返回 `{ cells, styles }`；由调用方将 styles 赋给 sheet。

### 17.7 GC 策略

`compactStyles(cells)` 在保存/导出时执行（不在每次编辑时）：

1. 收集 cells 实际使用的全部 styleId。
2. 建立 旧 id → 新 id 映射，丢弃未引用样式。
3. 更新每个单元格的 styleId 为新的连续 id。
4. `styles[0]` 恒保留。

---

## 18. 边框系统

位于 `spreader/core/border-pool.ts` 与 `spreader/core/border-resolve.ts`。边框与普通样式解耦，使用专用池去重存储，并在渲染时对公共边做冲突解析。

### 18.1 数据结构

- `BorderSide`：单边边框 `{ width?, color?, style? }`（`style` 预留：solid/dashed/dotted）。
- `BorderStyle`：四边组合 `{ top?, right?, bottom?, left? }`，各边独立存储。
- `CellStyle.borderId`：样式通过 `borderId`（`borders` 数组下标）引用边框；`0` 或省略表示无边框。
- 旧版内联属性（`borderTopWidth` / `borderBottomWidth` / `borderLeftWidth` / `borderRightWidth` / `borderColor`）标注 `@deprecated`，仅用于迁移历史数据。

### 18.2 BorderPool

与 StylePool 同构的边框池：

| 方法 | 说明 |
|--------|-------------|
| `get(borderId)` | 按 borderId 获取边框对象（只读，`Object.freeze`） |
| `getId(border)` | 查找或注册边框，返回其 borderId（相同内容自动复用） |
| `getBorders()` / `setBorders(borders)` | 返回数组浅拷贝 / 恢复快照并重建索引 |
| `compactBorders(styles)` | 边框 GC：丢弃未被样式引用的边框，重新生成连续 id |

约束：`borders[0]` 恒为默认空边框 `{}`；已注册边框经 `Object.freeze` 冻结 — 修改需复制后重新注册；`index`（Map）仅运行时使用，不序列化。

辅助函数：`getCellBorderSide` / `getCellBorder` / `setCellBorderSide` / `setCellBorder` / `clearCellBorder` / `migrateBordersInStyles` / `cleanupMergeInternalBorders`。

### 18.3 公共边解析（resolveSharedBorder）

`border-resolve.ts` 提供相邻边框的统一冲突解析，产出单一视觉结果：

1. 两边均为空 → 不绘制。
2. 仅一边存在 → 采用该边。
3. 两边均存在：`width` 大者优先；宽度相等 → `first` 侧优先（稳定平局规则）。
4. `firstSource`/`secondSource`（`'cell'`/`'merge'`）为预留参数，当前不影响优先级 — 合并单元格不会无条件覆盖普通单元格。

渲染器绘制边框与角方块时，每条相邻边都经此函数解析。**设置边框不再同步相邻单元格**（旧的 `syncCellBorders` 机制已移除）。

### 18.4 合并单元格边框

- **写入重定向到锚点**：合并区域的边框统一存储在锚点（左上角）单元格；向合并内部单元格写入边框会自动重定向到锚点。
- **内部边屏蔽**：同一合并区域内部不绘制网格线（`isSameMergeInternal`）。
- **边界分段解析**：合并区域的上/下/左/右外边界按列/行切分，逐段与相邻单元格经 `resolveSharedBorder` 解析；四个角单独填充角方块。
- 读取同样经锚点重定向（渲染端 `getBorderSideAt`），保证写入与渲染一致。

### 18.5 序列化与迁移

- `SheetModelData` / `SheetState` / `UndoSnapshot` 均新增 `borders: BorderStyle[]`。
- `migrateBordersInStyles(styles)`：将旧版内联边框属性迁移为 `borders` 池 + `borderId` 机制。
- 加载时：若 `smd.borders` 存在则直接使用；否则对 `styles` 执行迁移。

---

## 19. 排序

逻辑位于 `spreader/composables/sheets-ops.ts`，「排序提醒」对话框由 `SortConfirmDialog.vue` 提供。按选中列范围的**展示内容**对行排序——数值、日期、文本均支持。

### 19.1 基准列与按展示内容比较
- **基准列**（决定行顺序的那一列）是用户*原始*选区的首列。当通过排序提醒对话框扩展选区时，基准列固定为原始选区首列，而**不会**偏移成扩展后最左列。
- 比较键由 `parseSortKeyByDisplay(raw, format, locale)` 产生：
  - 数值 / 日期按**展示数值**比较；百分比格式乘回 100，使 `100%` 按展示值 `100` 排序，符合肉眼所见。
  - 文本（含显式文本格式 `@`）按 `formatNumber` 的渲染串比较。
  - 数值格式列中混入的非数字单元格回退为展示文本，不会抛错。

### 19.2 只移数据，不搬样式
排序仅移动 `Cell.value`；目标位置原有的 `styleId` 原地保留。边框 / 填充 / 字体 / 数字格式等样式不随行重排，排序只改变内容、不改变各单元格样式。

### 19.3 阻断条件
`analyzeSortRange` 在以下情况返回 `blocked: true`（禁用排序）：
- 选区内有**公式单元格**（值以 `=` 开头），因为行置换会破坏公式引用（当前公式架构不支持改写引用）；
- 选区内存在**合并单元格**且其行范围与选区行范围相交（列方向已重叠）。

两者与右键菜单列「排序」项的可用性（`canSortColumns`）一致。

### 19.4 排序提醒对话框（类 Excel）
当选区外存在相邻数据时，排序前弹出类 Excel 的「排序提醒」对话框（`SortConfirmDialog.vue`）：
- **扩展选定区域** —— 排序范围*横向*扩展到相邻有数据的列（行范围与你选中的完全一致）；基准列仍为原始首列。
- **仅对选定区域排序** —— 只排选中的矩形。

检测使用 `getCurrentRegion(sel)`（仅横向扩展）+ `needsSortConfirmation(sel)`，流程由 `prepareSortConfirmation` / `confirmSort(expand)` / `cancelSortConfirmation` 驱动。

### 19.5 输入时自动识别数字
输入 `100%`、`1,234`、`¥1,234.56` 等文本由 `parseNumericText`（`core/number-format.ts`）识别为数值并套用对应格式；该逻辑在日期识别之后接入 `setCellValue`（`composables/core-state.ts`）。因此按展示内容排序时，`100%` 以数值 `1` 参与比较（展示时乘回），与 §19.1 的比较规则一致。

---

## 20. 动态范围扩展

逻辑位于 `composables/core-state.ts` 与 `composables/sheets-ops.ts`。将工作表从固定 26×200 网格转变为类 Excel 的动态可扩展工作表。

### 20.1 核心数据结构

每个 sheet 通过 `dims` 维护**响应式**逻辑范围：

```typescript
// CoreState 中（响应式）
dims: { colCount: number; rowCount: number }
```

- 由 `colCount`/`rowCount` prop 初始化（默认：26 列、200 行）。
- 单调增长——不会自动缩小（仅在显式 sheet 重置/加载时可缩减）。
- 以 `colCount`/`rowCount` 字段持久化到 `SheetModelData`，支持保存/加载往返。

### 20.2 ensureCapacity(minCol, minRow)

`CoreState` 中统一的扩展入口：

```typescript
ensureCapacity(minCol: number, minRow: number): void
```

- 若当前 `dims.colCount` < `minCol`，扩展列；若 `dims.rowCount` < `minRow`，扩展行。
- 扩展使用**缓冲步长**（`COL_EXPAND_STEP = 8`、`ROW_EXPAND_STEP = 32`）以减少频繁调整开销：
  ```
  newColCount = Math.ceil(minCol / 8) * 8   // 向上取整到 8 的倍数
  newRowCount = Math.ceil(minRow / 32) * 32 // 向上取整到 32 的倍数
  ```
- 自动将 `colWidths`/`rowHeights` 数组扩展到新的 dims，填充默认值。
- 无需扩展时立即返回（幂等）。

### 20.3 扩展触发时机

当用户操作将跨越当前边界时，自动触发扩展：

| 触发 | 位置 | 行为 |
|---|---|---|
| **滚动接近边界** | `interactions.ts` → `onWheel` | 滚动到距右/下边界 40px 以内时，估算可视行列数并调用 `ensureCapacity()` |
| **键盘导航跨越边界** | `core-state.ts` → `moveActive()` | 方向键/PgUp/PgDn 将移出当前 dims 时，先扩展范围再钳制 |
| **边界单元格输入** | `core-state.ts` → `setCellValue()` | 向单元格写入非空值时调用 `ensureCapacity(col, row)` 确保目标存在 |
| **粘贴超出范围** | `borders-merge.ts` → `pasteFromClipboard()` | 计算粘贴目标范围，写入前调用 `ensureCapacity()` |
| **插入行列挤出数据** | `sheets-ops.ts` → `insertRows()`/`insertCols()` | 通过 `findLastDataExtents()` 检测最后一行/列数据是否会被挤出当前范围；仅在非默认单元格（有数据或自定义格式）面临风险时扩展，不对空默认单元格扩展 |

### 20.4 插入/删除的条件扩展

插入操作使用 `findLastDataExtents()` 定位实际含有数据或自定义格式的最后列/行：

```typescript
function findLastDataExtents(): { lastCol: number; lastRow: number }
```

- 扫描 `cells` 找到含有非空值或非默认 `styleId`（> 0）的最大列/行。
- 若插入会使 `lastCol + n` 超过当前 `colCount`，触发扩展。
- **在边界插入始终扩展**（因为边缘新增空行列代表用户的明确意图）。
- 默认格式的空单元格被挤出**不**触发扩展——与 Excel 行为一致。

### 20.5 稀疏存储兼容

扩展与现有稀疏单元格存储无缝协作：

- 扩展逻辑范围**不会创建空单元格**——单元格仅在有实际数据时才存储。
- `colWidths`/`rowHeights` 数组以默认值（100px / 24px）填充新范围。
- 撤销/重做快照包含 `colCount`/`rowCount`，确保范围扩展/缩减可正确回退。
- Sheet 序列化（`SheetModelData`）包含 `colCount?`/`rowCount?` 用于持久化。

### 20.6 列名转换

列标签使用 Excel 风格命名（A→Z→AA→AZ→BA→...→ZZ→AAA...），实现于 `core/utils.ts`：

- `colToLabel(col: number): string` —— 将 0 基列索引转换为字母标签
- `labelToCol(label: string): number` —— 将字母标签转换回 0 基索引

这些工具函数处理表头渲染、单元格引用解析以及公式列引用，覆盖完整动态范围。

### 20.7 集成说明

- **所有依赖计算**（`colPositions`、`rowPositions`、`totalWidth`、`totalHeight`、`maxScrollX`、`maxScrollY`）均为计算属性，响应式依赖 `dims.colCount`/`dims.rowCount`，因此范围扩展时自动更新。
- **Canvas 渲染**仅通过虚拟滚动绘制可视区域；扩展不影响渲染性能。
- **选区**（含全选）使用 `dims` 进行边界计算，扩展范围完全可选。
- **复制粘贴**操作遵循动态边界；剪贴板协议（TSV）不变。

---

## 21. 冻结窗格

代码分布于 `composables/core-state.ts`（状态 + `setFreeze` / `clearFreeze` / `getFreeze`）、`composables/sheets-ops.ts`（按工作表持久化 + 行列增删钳制）、`components/spreader.vue`（独立 overlay 画布 + 工具栏事件路由）、`components/toolbar.vue`（菜单）、`composables/interactions.ts`（跨冻结线合并单元格渲染）。

### 21.1 状态模型

每个工作表持有响应式 `freeze: FreezePane`，其中 `FreezePane = { rows: number; cols: number }` —— 冻结的顶部行数与左侧列数。`{ rows: 0, cols: 0 }` 表示无冻结。

- `setFreeze(rows, cols)` —— 将两者钳制到 `[0, rowCount]` / `[0, colCount]` 后赋值；设计上**保留另一轴**（例如「冻结首行」会保留已有的冻结列）。
- `clearFreeze()` —— 两者归零。
- `getFreeze()` —— 返回普通快照 `{ rows, cols }`。

### 21.2 持久化

`freeze` 是按工作表的**视图状态**，随单元格数据一起持久化：

- 存入 `SheetState.freeze`，并在 v-model 发射 / 保存工作表时序列化为 `SheetModelData.freeze?: FreezePane`（`sheets-ops.ts` 从响应式 `s.freeze` 拷贝进 `sh.freeze`）。
- 切换工作表时恢复，并按新 `[rowCount, colCount]` 钳制。
- **明确排除在撤销/重做之外** —— `undo-styles.ts` 在每次恢复后重新套用实时 `currentFreeze`，因此冻结/取消冻结不会污染单元格数据的撤销栈。
- 行列插入/删除操作会确定性地把冻结行/列控制在新的范围内（`sheets-ops.ts` 在每次操作后钳制 `freeze.rows` / `freeze.cols`）。

### 21.3 工具栏入口

「冻结窗格」下拉（`toolbar.vue` 的 `freezeOptions`）根据当前状态自适应：

| 状态 | 菜单项 |
|---|---|
| 无冻结 | 冻结窗格 · 冻结首行 · 冻结首列 |
| 已冻结 | 取消冻结 · 冻结首行 · 冻结首列 |

- **冻结窗格**（`panes`）以**当前选区/活动单元格左上角**为冻结点（`rows = sel.startRow`，`cols = sel.startCol`）—— 等同 Excel 的 Freeze Panes。
- **取消冻结**替换「冻结窗格」项（互斥）并调用 `clearFreeze()`。
- 每个菜单项都带 SVG 图标；触发器按钮本身使用冻结图标，冻结首行/首列/取消冻结各有专属 SVG。
- 选择「冻结首行」/「冻结首列」会保留已有的冻结轴（冻结首行保留冻结列，反之亦然）。

路由：`toolbar.vue` 发射 `freeze-change`，`spreader.vue` 的 `onFreezeChange` 将 `panes` → `setFreeze(startRow, startCol)`、`firstRow` → `setFreeze(1, cur.cols)`、`firstCol` → `setFreeze(cur.rows, 1)`、`unfreeze` → `clearFreeze()`，随后 `scheduleRender()`。

### 21.4 渲染架构

冻结窗格绘制在**独立的 overlay 画布**（`freezeCanvasRef`，`z-index: 1`）上，叠在主体画布（`z-index: 0`）之上。每帧由 `renderFrozenOverlay` 合成三个 pane，各自裁剪到自身视口：

- **角区块** —— 冻结行 × 冻结列的左上块
- **顶部冻结行带** —— 跨滚动宽度的冻结行带
- **左侧冻结列带** —— 跨滚动高度的冻结列带

`cellToScreenRect(row, col)` 感知冻结：处于冻结方向的单元格**不**叠加 `scrollX`/`scrollY`，处于主体方向的叠加。这令冻结单元格固定、主体在其下滚动。两块画布共用同一坐标系，overlay 与主体完美对齐。

### 21.5 跨冻结线合并单元格

跨冻结线的合并单元格由 `drawMergedCells(ctx, vx, vy, vw, vh)` 通过对当前 pane 视口做**区域相交**绘制，而非仅靠 clip：

- 合并的整屏矩形由**锚点**（左上，感知冻结）与**endCell**（右下，感知主体）合成 —— 其宽度为 `(endCell.right − anchor.left)`，`scrollX` 在主体一侧自然相减。
- **背景**：冻结 pane 中可见段的右边界固定在冻结分隔线；主体 pane 中随 `scrollX` 走。
- **文本**：按合并的*逻辑*宽度（不随滚动）布局，保证换行/溢出/对齐稳定；绘制起点在冻结 pane 取锚点、在主体 pane 取 `anchor − scroll` —— 两层 clip 拼接成连续标题（冻结部分固定、主体部分滚动）。
- **边框**：上/下/左/右四边按列/行分段（已感知冻结）；**右边与右上/右下角方块属于主体段**，仅在合并跨入主体处绘制，因此能正确随滚动移出。

这保证冻结部分固定、非冻结部分滚出，即便合并单元格横跨分界线也成立。

### 21.6 集成说明

- 冻结独立于其他滚动数学（`maxScrollX/Y`、命中测试）—— 冻结行/列简单排除在滚动视口外。
- 切换工作表会自动恢复各表自己的 `freeze`。

