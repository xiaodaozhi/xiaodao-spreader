<template>
  <div class="app-container">
    <Spreadsheet
      v-model:data="myData"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Spreadsheet from './components/spreader/spreader.vue'

interface SheetModelData {
  name: string
  cells: Record<string, { value: string; style?: Record<string, unknown> }>
  colWidths?: Record<number, number>
  rowHeights?: Record<number, number>
}

const myData = ref<SheetModelData[]>([{
  name: 'Sheet1',
  cells: {
    '0,0': { value: '5' }, '0,1': { value: '6' }, '0,2': { value: '7' }, '0,3': { value: '8' },
    '0,4': { value: '9' }, '0,5': { value: '10' }, '0,6': { value: '11' }, '0,7': { value: '12' },
    '1,0': { value: 'A' }, '2,0': { value: 'B' }, '3,0': { value: 'C' }, '4,0': { value: 'D' },
    '5,0': { value: 'E' },
  },
}])

watch(myData, (v) => {
  console.log('myData changed:', JSON.stringify(v))
}, { deep: true })
</script>

<style scoped>
.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #e8e8e8;
}
</style>
