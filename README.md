# Xiaodao Spread

基于 Canvas 2D 的 Vue 3 电子表格组件，提供类 Excel 的编辑体验。

## 快速开始

```bash
pnpm install
pnpm dev
```

## 基本用法

```vue
<template>
  <Spreader v-model:data="myData" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Spreader from './components/spreader.vue'

const myData = ref([])
</script>
```

## Props

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `data` (v-model) | `SheetModelData[]` | `[]` | 多工作表数据（双向绑定） |
| `rowCount` | `number` | `200` | 每个工作表的总行数 |
| `colCount` | `number` | `26` | 每个工作表的总列数 |
| `width` | `number \| string` | — | 组件宽度（像素值，百分比无效） |
| `height` | `number \| string` | — | 组件高度（像素值，百分比无效） |
| `theme` | `'light' \| 'dark'` | `'light'` | 主题模式 |
| `locale` | `string` | `'zh-CN'` | 语言（`'zh-CN'` / `'en-US'`） |

### SheetModelData 类型

```typescript
interface SheetModelData {
  name: string
  cells: Record<string, { value: string; style?: Record<string, unknown> }>
  colWidths?: Record<number, number>   // 列索引 → 宽度（px），仅存储非默认值
  rowHeights?: Record<number, number>  // 行索引 → 高度（px），仅存储非默认值
}
```

`cells` 的 key 为 `"col,row"` 字符串格式（如 `"0,0"` 表示 A1）。

## 功能

- **Canvas 渲染**：高 DPI 支持，虚拟渲染仅绘制可视区域内的单元格
- **多工作表**：标签栏切换、新建、重命名、复制、删除、拖拽排序
- **公式引擎**：支持 `=SUM(A1:B5)` 区域求和，带依赖追踪和缓存
- **撤销/重做**：Ctrl+Z / Ctrl+Y，最多 50 步
- **选区**：点击 / 拖拽 / Shift+Click 选区，行列标题和角格一键全选
- **编辑**：双击 / F2 / 直接输入进入编辑模式，编辑栏支持公式输入
- **键盘导航**：方向键 / Tab / Enter / Home / End / Ctrl+Home / Ctrl+End
- **剪贴板**：Ctrl+C/V/X 复制粘贴剪切（TSV 格式），公式引用自动偏移
- **行/列操作**：右键菜单插入、删除、剪切、复制、粘贴整行/整列
- **列宽/行高拖拽**：拖拽标题边缘调整尺寸
- **右键菜单**：单元格、行列标题、角格、标签栏各有独立上下文菜单
- **主题**：亮色 / 暗色双主题
- **国际化**：中文 / 英文右键菜单
- **触屏**：滑动滚动 + 双击进入编辑
- **自定义滚动条**：带箭头按钮和拖拽滑块的实体滚动条
- **自适应**：ResizeObserver 监听容器尺寸变化

## 技术栈

- **框架**: Vue 3 (Composition API + `<script setup>`)
- **构建**: Vite 5
- **语言**: TypeScript (strict)
- **渲染**: Canvas 2D
- **包管理**: pnpm

## 构建

```bash
pnpm build      # 类型检查 + 生产构建
pnpm preview    # 预览构建产物
pnpm type-check # 仅类型检查
```

## 设计文档

详见 [DOC.md](./DOC.md)，覆盖架构、文件结构、数据模型、渲染管线、交互模型和扩展点。