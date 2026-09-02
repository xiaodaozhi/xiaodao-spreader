<template>
  <div class="app-container">
    <Spreadsheet
      v-model:data="myData"
      :row-count="200"
      :col-count="26"
      theme="dark"
      locale="zh-CN"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import Spreadsheet from './components/spreader';

// ===== 禁止移动端网页缩放（严谨方案）=====
// 1) viewport meta 已设置 user-scalable=no / max-min-scale=1
// 2) JS 拦截双指缩放手势（iOS Safari 双指缩放仅靠 meta 无法完全禁用，必须阻止事件）
// 3) JS 拦截 Ctrl/Cmd + +/-/0 键盘缩放（桌面端浏览器快捷键）
// 注意：multi-touch（或带 ctrl 的 wheel）时 preventDefault，单指/正常滚动不受影响。

const blockedTouch = (e: TouchEvent): void => {
  // 双指及以上（捏合缩放）时阻止默认行为
  if (e.touches.length > 1) e.preventDefault();
};
const blockedGesture = (e: Event): void => {
  // iOS Safari/Chrome 的 gesture 系列事件
  e.preventDefault();
};
const blockedKeyZoom = (e: KeyboardEvent): void => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key;
  if (k === '+' || k === '=' || k === '-' || k === '_' || k === '0') {
    e.preventDefault();
  }
};
const blockedWheelZoom = (e: WheelEvent): void => {
  // Ctrl/Meta + 滚轮 = 浏览器页面缩放，阻止之
  if (e.ctrlKey || e.metaKey) e.preventDefault();
};

onMounted(() => {
  document.title = '小刀电子表格 | Xiaodao Spreader';
  document.addEventListener('touchstart', blockedTouch, { passive: false });
  document.addEventListener('touchmove', blockedTouch, { passive: false });
  document.addEventListener('gesturestart', blockedGesture, { passive: false });
  document.addEventListener('gesturechange', blockedGesture, { passive: false });
  document.addEventListener('gestureend', blockedGesture, { passive: false });
  document.addEventListener('keydown', blockedKeyZoom);
  document.addEventListener('wheel', blockedWheelZoom, { passive: false });
});

onBeforeUnmount(() => {
  document.removeEventListener('touchstart', blockedTouch);
  document.removeEventListener('touchmove', blockedTouch);
  document.removeEventListener('gesturestart', blockedGesture);
  document.removeEventListener('gesturechange', blockedGesture);
  document.removeEventListener('gestureend', blockedGesture);
  document.removeEventListener('keydown', blockedKeyZoom);
  document.removeEventListener('wheel', blockedWheelZoom);
});

// ---- 表格范围常量 ----
const FIRST_COL = 0;
const LAST_COL = 7;
const FIRST_ROW = 0; // 标题行
const THICK = 2;
const THIN = 1;
const BORDER_COLOR = '';

// ---- 边框生成函数：外边框粗、内边框细 ----
function borderFor(col: number, row: number, lastRow: number): Record<string, unknown> {
  return {
    borderTopWidth: row === FIRST_ROW ? THICK : THIN,
    borderBottomWidth: row === lastRow ? THICK : THIN,
    borderLeftWidth: col === FIRST_COL ? THICK : THIN,
    borderRightWidth: col === LAST_COL ? THICK : THIN,
    borderColor: BORDER_COLOR,
  };
}

// ---- 基础样式（不含边框） ----
const titleBase = {
  fontWeight: 'bold',
  fontSize: 18,
  color: '#ffffff',
  backgroundColor: '#1f4e79',
  textAlign: 'center',
  verticalAlign: 'middle',
} as const;

const headerBase = {
  fontWeight: 'bold',
  fontSize: '13px',
  color: '#ffffff',
  backgroundColor: '#4472c4',
  textAlign: 'center',
  verticalAlign: 'center',
} as const;

const centerBase = {
  textAlign: 'center',
} as const;

const scoreBase = {
  textAlign: 'center',
  fontWeight: 'bold',
} as const;

const excellentBase = {
  textAlign: 'center',
  fontWeight: 'bold',
  color: '#2e7d32',
} as const;

const failBase = {
  textAlign: 'center',
  fontWeight: 'bold',
  color: '#c62828',
} as const;

const leaderBase = {
  textAlign: 'center',
  fontWeight: 'bold',
  color: '#1565c0',
  backgroundColor: '#e3f2fd',
} as const;

const normalBase = {
  textAlign: 'center',
  color: '#616161',
} as const;

const avgBase = {
  textAlign: 'center',
  fontWeight: 'bold',
  fontSize: '13px',
  backgroundColor: '#fff2cc',
} as const;

const nameBase = {
  fontWeight: 'bold',
} as const;

// ---- 数据生成 ----
const classNames = ['落霞峰', '翠竹峰', '青云峰', '紫霄峰', '玄阴峰'];
const leaderRoles = ['峰主', '大师兄', '二师兄', '执事', '传功长老', '护法', '丹堂掌事', '巡山弟子'];
const surnames = ['云', '风', '雷', '电', '霜', '雪', '月', '日', '星', '辰', '天', '玄', '灵', '清', '虚', '空', '玉', '紫', '青', '白', '赤', '碧', '幽', '冥', '阳', '阴', '乾', '坤', '离', '坎', '震', '巽', '艮', '兑', '鸿', '蒙', '荒', '混沌', '太', '上'];
const givenNames = ['尘', '渊', '鹤', '虚', '玄', '清', '默', '衍', '淳', '珩', '珝', '瑶', '璃', '璞', '瑾', '瑜', '玥', '琛', '渺', '然', '止', '观', '心', '觉', '悟', '禅', '寂', '灭', '缘', '劫', '渡', '劫', '尘', '客', '来', '归', '去', '闲', '远', '之'];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

function scoreFor(seed: number): number {
  const r = (seed * 137 + 41) % 71;
  return 30 + r;
}

function buildSheet(classIdx: number) {
  const className = classNames[classIdx]!;
  const discipleCount = 32;
  const avgRow = discipleCount + 2; // row 34
  const lastRow = avgRow;
  const cells: Record<string, { value: string; style?: Record<string, unknown> }> = {};

  // Row 0: 标题行（合并 A1:H1）
  cells['0,0'] = { value: `${className} 弟子名录`, style: { ...titleBase, ...borderFor(0, 0, lastRow), borderRightWidth: THICK } };

  // Row 1: 表头
  const headers = ['编号', '法号', '修龄', '性别', '修为', '职位', '传音符', '备注'];
  for (let c = 0; c < 8; c++) {
    cells[`${c},1`] = { value: headers[c]!, style: { ...headerBase, ...borderFor(c, 1, lastRow) } };
  }

  // Rows 2 ~ 33: 学生数据
  for (let i = 0; i < discipleCount; i++) {
    const row = i + 2;
    const seed = classIdx * 100 + i;

    // 编号 (col 0)
    const sno = `LX${String(classIdx + 1).padStart(2, '0')}${String(i + 1).padStart(3, '0')}`;
    cells[`0,${row}`] = { value: sno, style: { ...centerBase, ...borderFor(0, row, lastRow) } };

    // 法号 (col 1)
    const name = `${pick(surnames, seed)}${pick(givenNames, seed * 3 + 7)}${pick(givenNames, seed * 5 + 13)}`;
    cells[`1,${row}`] = { value: name, style: { ...nameBase, ...borderFor(1, row, lastRow) } };

    // 修龄 (col 2)
    const age = 50 + (seed % 50);
    cells[`2,${row}`] = { value: String(age), style: { ...centerBase, ...borderFor(2, row, lastRow) } };

    // 性别 (col 3)
    const gender = seed % 2 === 0 ? '男' : '女';
    cells[`3,${row}`] = { value: gender, style: { ...centerBase, ...borderFor(3, row, lastRow) } };

    // 修为 (col 4)
    const score = scoreFor(seed);
    let sBase: Record<string, unknown>;
    if (score >= 85) sBase = { ...excellentBase };
    else if (score < 60) sBase = { ...failBase };
    else sBase = { ...scoreBase };
    cells[`4,${row}`] = { value: String(score), style: { ...sBase, ...borderFor(4, row, lastRow) } };

    // 职位 (col 5)
    if (i < leaderRoles.length) {
      cells[`5,${row}`] = { value: leaderRoles[i]!, style: { ...leaderBase, ...borderFor(5, row, lastRow) } };
    } else {
      cells[`5,${row}`] = { value: '记名弟子', style: { ...normalBase, ...borderFor(5, row, lastRow) } };
    }

    // 传音符 (col 6)
    const phone = `符${3 + (seed % 6)}${String(1000 + seed * 7).slice(-4)}-${String(10000 + seed * 13).slice(-4)}`;
    cells[`6,${row}`] = { value: phone, style: { ...centerBase, ...borderFor(6, row, lastRow) } };

    // 备注 (col 7)
    let note = '';
    let noteColor = '#757575';
    if (score >= 90) {
      note = '优秀';
      noteColor = '#2e7d32';
    } else if (score >= 75) {
      note = '良好';
      noteColor = '#1565c0';
    } else if (score < 60) {
      note = '需辅导';
      noteColor = '#c62828';
    }
    cells[`7,${row}`] = {
      value: note,
      style: { textAlign: 'center', fontStyle: 'italic', color: noteColor, ...borderFor(7, row, lastRow) },
    };
  }

  // Row 34: 平均分行
  cells[`0,${avgRow}`] = { value: '', style: { ...avgBase, ...borderFor(0, avgRow, lastRow) } };
  cells[`1,${avgRow}`] = { value: '平均修为', style: { ...avgBase, ...borderFor(1, avgRow, lastRow) } };
  cells[`2,${avgRow}`] = { value: '', style: { ...avgBase, ...borderFor(2, avgRow, lastRow) } };
  cells[`3,${avgRow}`] = { value: '', style: { ...avgBase, ...borderFor(3, avgRow, lastRow) } };

  let total = 0;
  for (let i = 0; i < discipleCount; i++) {
    total += scoreFor(classIdx * 100 + i);
  }
  const avg = (total / discipleCount).toFixed(1);
  cells[`4,${avgRow}`] = { value: avg, style: { ...avgBase, color: '#e65100', ...borderFor(4, avgRow, lastRow) } };
  cells[`5,${avgRow}`] = { value: '', style: { ...avgBase, ...borderFor(5, avgRow, lastRow) } };
  cells[`6,${avgRow}`] = { value: '', style: { ...avgBase, ...borderFor(6, avgRow, lastRow) } };
  cells[`7,${avgRow}`] = { value: '', style: { ...avgBase, ...borderFor(7, avgRow, lastRow) } };

  return {
    name: className,
    cells,
    merges: {
      '0,0': { startCol: 0, startRow: 0, endCol: 7, endRow: 0 },
    },
    colWidths: { 0: 110, 1: 80, 2: 50, 3: 50, 4: 60, 5: 90, 6: 130, 7: 80 },
    rowHeights: { 0: 36, 1: 28 },
    // ===== DEBUG: 预置分组以便观察浮动控件与折叠行为 =====
    rowOutlines:
      classIdx === 0
        ? [
            { id: 'gR1', axis: 'row' as const, start: 2, end: 11, level: 1, collapsed: false },
          ]
        : [],
    columnOutlines:
      classIdx === 0
        ? [
            { id: 'gC1', axis: 'column' as const, start: 1, end: 4, level: 1, collapsed: false },
          ]
        : [],
  };
}

const myData = ref(classNames.map((_, i) => buildSheet(i)));

watch(myData, (v) => {
  console.log('myData changed:', JSON.stringify(v));
}, { deep: true });
</script>

<style scoped>
.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--sp-wrapper-bg);
  /* 禁止触摸缩放手势与双击/长按选择，避免误触缩放 */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
</style>
