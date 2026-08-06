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

const myData = ref<SheetModelData[]>([{ name: 'Sheet1', cells: {} }])

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
