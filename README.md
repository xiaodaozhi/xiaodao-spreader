# xiaodao-spreader

A Vue 3 spreadsheet component based on Canvas 2D, providing an Excel-like editing experience.

## Quick Start

```bash
pnpm install
pnpm dev
```

## Basic Usage

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

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` (v-model) | `SheetModelData[]` | `[]` | Multi-sheet data (two-way binding) |
| `rowCount` | `number` | `200` | Total rows per sheet |
| `colCount` | `number` | `26` | Total columns per sheet |
| `width` | `number \| string` | — | Component width (pixel value, percentages not supported) |
| `height` | `number \| string` | — | Component height (pixel value, percentages not supported) |
| `theme` | `'light' \| 'dark'` | `'light'` | Theme mode |
| `locale` | `string` | `'zh-CN'` | Language (`'zh-CN'` / `'en-US'`) |

### SheetModelData Type

```typescript
interface SheetModelData {
  name: string
  cells: Record<string, { value: string; style?: Record<string, unknown> }>
  colWidths?: Record<number, number>   // Column index → width (px), only stores non-default values
  rowHeights?: Record<number, number>  // Row index → height (px), only stores non-default values
}
```

The key of `cells` is a `"col,row"` string format (e.g., `"0,0"` represents A1).

## Features

- **Canvas Rendering**: High DPI support, virtual rendering only draws cells in the visible area
- **Multiple Sheets**: Tab bar switching, create, rename, duplicate, delete, drag-to-reorder
- **Formula Engine**: Supports `=SUM(A1:B5)` range summation with dependency tracking and caching
- **Undo/Redo**: Ctrl+Z / Ctrl+Y, up to 50 steps
- **Selection**: Click / drag / Shift+Click selection, row/column headers and corner cell for one-click select-all
- **Editing**: Double-click / F2 / direct input to enter edit mode, formula bar supports formula input
- **Keyboard Navigation**: Arrow keys / Tab / Enter / Home / End / Ctrl+Home / Ctrl+End
- **Clipboard**: Ctrl+C/V/X copy, paste, cut (TSV format), formula references automatically offset
- **Row/Column Operations**: Right-click menu to insert, delete, cut, copy, paste entire rows/columns
- **Column Width/Row Height Dragging**: Drag header edges to resize
- **Context Menu**: Independent context menus for cells, row/column headers, corner cell, and tab bar
- **Theme**: Light / Dark dual theme
- **Internationalization**: Chinese / English right-click menus
- **Touch**: Swipe scrolling + double-tap to enter edit mode
- **Custom Scrollbar**: Physical scrollbar with arrow buttons and draggable thumb
- **Responsive**: ResizeObserver monitors container size changes

## Tech Stack

- **Framework**: Vue 3 (Composition API + `<script setup>`)
- **Build**: Vite 5
- **Language**: TypeScript (strict)
- **Rendering**: Canvas 2D
- **Package Manager**: pnpm

## Build

```bash
pnpm build      # Type check + production build
pnpm preview    # Preview build output
pnpm type-check # Type check only
```

## Design Document

See [DOC.md](./DOC.md) for details on architecture, file structure, data model, rendering pipeline, interaction model, and extension points.
