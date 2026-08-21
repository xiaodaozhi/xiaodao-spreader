<template>
  <div class="app-container">
    <Spreadsheet
      v-model:data="myData"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import Spreadsheet from './components/spreader';

onMounted(() => {
  document.title = '小刀电子表格 | Xiaodao Spreader'
});

interface SheetModelData {
  name: string;
  cells: Record<string, { value: string; style?: Record<string, unknown> }>;
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
}

const myData = ref<SheetModelData[]>([{
  name: 'Sheet1',
  cells: {
    '0,0': { value: '姓名' }, '0,1': { value: '年龄' }, '0,2': { value: '性别' }, '0,3': { value: '职业' },
    '0,4': { value: '城市' }, '0,5': { value: '电话' }, '0,6': { value: '邮箱' }, '0,7': { value: '备注' },
    '1,0': { value: '张三' }, '2,0': { value: '李四' }, '3,0': { value: '王五' }, '4,0': { value: '赵六' },
    '5,0': { value: '钱七' },
    '1,1': { value: '25' }, '2,1': { value: '30' }, '3,1': { value: '28' }, '4,1': { value: '35' },
    '5,1': { value: '22' },
  },
}]);

watch(myData, (v) => {
  console.log('myData changed:', JSON.stringify(v))
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
