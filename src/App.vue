<template>
  <div class="app-container">
    <Spreadsheet
      v-model:data="myData"
      :row-count="200"
      :col-count="26"
      theme="light"
      locale="zh-CN"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import Spreadsheet from './components/spreader';

onMounted(() => {
  document.title = '小刀电子表格 | Xiaodao Spreader';
});

// ---- 表格范围常量 ----
const FIRST_COL = 0;
const LAST_COL = 7;
const FIRST_ROW = 0; // 标题行
const THICK = 2;
const THIN = 1;
const BORDER_COLOR = '#555';

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
const classNames = ['高一(1)班', '高一(2)班', '高一(3)班', '高一(4)班', '高一(5)班'];
const leaderRoles = ['班长', '副班长', '学习委员', '纪律委员', '体育委员', '文艺委员', '生活委员', '宣传委员'];
const surnames = ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周', '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗', '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹', '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蒋', '蔡'];
const givenNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '霞', '平', '刚', '桂', '英', '华', '慧', '建', '飞', '鹏', '宇', '俊', '婷', '梅', '琳', '斌', '倩', '晓', '宁', '峰', '兰', '欣', '怡'];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

function scoreFor(seed: number): number {
  const r = (seed * 137 + 41) % 71;
  return 30 + r;
}

function buildSheet(classIdx: number) {
  const className = classNames[classIdx]!;
  const studentCount = 32;
  const avgRow = studentCount + 2; // row 34
  const lastRow = avgRow;
  const cells: Record<string, { value: string; style?: Record<string, unknown> }> = {};

  // Row 0: 标题行（合并 A1:H1）
  cells['0,0'] = { value: `${className} 学生名单`, style: { ...titleBase, ...borderFor(0, 0, lastRow), borderRightWidth: THICK } };

  // Row 1: 表头
  const headers = ['学号', '姓名', '年龄', '性别', '成绩', '身份', '联系电话', '备注'];
  for (let c = 0; c < 8; c++) {
    cells[`${c},1`] = { value: headers[c]!, style: { ...headerBase, ...borderFor(c, 1, lastRow) } };
  }

  // Rows 2 ~ 33: 学生数据
  for (let i = 0; i < studentCount; i++) {
    const row = i + 2;
    const seed = classIdx * 100 + i;

    // 学号 (col 0)
    const sno = `2026${String(classIdx + 1).padStart(2, '0')}${String(i + 1).padStart(3, '0')}`;
    cells[`0,${row}`] = { value: sno, style: { ...centerBase, ...borderFor(0, row, lastRow) } };

    // 姓名 (col 1)
    const name = `${pick(surnames, seed)}${pick(givenNames, seed * 3 + 7)}${pick(givenNames, seed * 5 + 13)}`;
    cells[`1,${row}`] = { value: name, style: { ...nameBase, ...borderFor(1, row, lastRow) } };

    // 年龄 (col 2)
    const age = 15 + (seed % 3);
    cells[`2,${row}`] = { value: String(age), style: { ...centerBase, ...borderFor(2, row, lastRow) } };

    // 性别 (col 3)
    const gender = seed % 2 === 0 ? '男' : '女';
    cells[`3,${row}`] = { value: gender, style: { ...centerBase, ...borderFor(3, row, lastRow) } };

    // 成绩 (col 4)
    const score = scoreFor(seed);
    let sBase: Record<string, unknown>;
    if (score >= 85) sBase = { ...excellentBase };
    else if (score < 60) sBase = { ...failBase };
    else sBase = { ...scoreBase };
    cells[`4,${row}`] = { value: String(score), style: { ...sBase, ...borderFor(4, row, lastRow) } };

    // 身份 (col 5)
    if (i < leaderRoles.length) {
      cells[`5,${row}`] = { value: leaderRoles[i]!, style: { ...leaderBase, ...borderFor(5, row, lastRow) } };
    } else {
      cells[`5,${row}`] = { value: '学生', style: { ...normalBase, ...borderFor(5, row, lastRow) } };
    }

    // 联系电话 (col 6)
    const phone = `1${3 + (seed % 6)}0-${String(1000 + seed * 7).slice(-4)}-${String(10000 + seed * 13).slice(-4)}`;
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
  cells[`1,${avgRow}`] = { value: '平均分', style: { ...avgBase, ...borderFor(1, avgRow, lastRow) } };
  cells[`2,${avgRow}`] = { value: '', style: { ...avgBase, ...borderFor(2, avgRow, lastRow) } };
  cells[`3,${avgRow}`] = { value: '', style: { ...avgBase, ...borderFor(3, avgRow, lastRow) } };

  let total = 0;
  for (let i = 0; i < studentCount; i++) {
    total += scoreFor(classIdx * 100 + i);
  }
  const avg = (total / studentCount).toFixed(1);
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
  background: #e8e8e8;
}
</style>
