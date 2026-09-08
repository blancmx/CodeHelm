<template>
  <n-modal :show="!!run" preset="card" title="历史日志" class="!w-[min(1000px,94vw)]" style="max-height:90vh;overflow:auto" @update:show="!$event && emit('close')">
    <template v-if="run">
      <p class="text-sm mb-3">{{ run.profileName || '旧版方案记录' }} · {{ run.id }}。此处是持久化记录，不提供历史进程控制。</p>
      <form class="log-filters" @submit.prevent="search">
        <label>服务<select v-model="service" aria-label="历史日志服务"><option value="">全部服务</option><option v-for="s in run.services" :key="s.id" :value="s.id">{{ s.serviceName }} · {{ s.id.slice(0,8) }}</option></select></label>
        <label>输出流<select v-model="stream" aria-label="历史日志输出流"><option value="">全部输出</option><option value="stdout">stdout</option><option value="stderr">stderr</option><option value="system">system</option></select></label>
        <label>关键词<input v-model="keyword" aria-label="历史日志关键词" maxlength="200" /></label>
        <label>日志起始时间<input v-model="from" type="datetime-local" aria-label="日志起始时间" /></label>
        <label>日志结束时间<input v-model="to" type="datetime-local" aria-label="日志结束时间" /></label>
        <n-button attr-type="submit" :loading="loading">查询日志</n-button>
      </form>
      <p v-if="error" role="alert" class="text-rose-500 my-3">{{ error }}</p>
      <div v-if="current" class="mt-3 text-xs leading-relaxed">
        <p>查询快照 {{ current.snapshotAt }}；保留策略 {{ current.retentionDays }} 天 / {{ current.retentionMb }} MiB。</p>
        <p>本页 {{ current.entries.length }} 条；实际日志时间 {{ current.firstTimestamp || '未知' }} ～ {{ current.lastTimestamp || '未知' }}；扫描 {{ (current.scannedBytes/1024).toFixed(0) }} KiB。</p>
        <p role="status">持久化日志可能因轮转、清理或未成功写盘而缺失，无法证明覆盖整个会话。按文件顺序分页；新写入内容需重新查询。</p>
        <p>本页缺失/不可读文件 {{ current.missingFiles }}；无效/不完整记录 {{ current.skippedRecords }}；截断日志 {{ current.truncatedEntries }}；本次应用写盘丢弃 {{ current.droppedEntries }}。</p>
        <p v-if="current.storageError" role="alert" class="text-rose-500">最近写盘错误：{{ current.storageError }}</p>
        <p v-if="current.fileLimitReached" role="alert" class="text-amber-600">项目日志文件超过 512 个，当前查询未覆盖全部文件。</p>
        <p v-if="!current.entries.length" class="my-2">本页没有符合筛选的已保存日志；可能尚未产生、已清理或在后续页。</p>
        <div class="flex flex-wrap gap-2 my-3 items-center">
          <n-button size="small" :disabled="loading || pageIndex===0" @click="pageIndex--">上一页日志</n-button>
          <span>日志页 {{ offset+pageIndex+1 }}（保留最近 10 页）</span>
          <n-button size="small" :disabled="loading || (!current.nextCursor && pageIndex===pages.length-1)" @click="next">下一页日志</n-button>
          <n-button size="small" :disabled="!current.entries.length || loading" @click="exportPage">导出本页已加载日志</n-button>
        </div>
        <div class="stored-log-lines" tabindex="0" aria-label="持久化日志内容">
          <div v-for="(entry,index) in current.entries" :key="`${entry.id}-${index}`" class="log-line" :class="{ stderr: entry.stream==='stderr' }">
            <span>{{ entry.timestamp }} [{{ entry.serviceName }}] [{{ entry.stream }}]</span>
            <pre>{{ entry.message }}</pre>
          </div>
        </div>
      </div>
    </template>
  </n-modal>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RunSessionDto, StoredLogPage, StoredLogQuery } from '@codehelm/contracts';
import { displayIpcError } from '../utils/ipc-error.js';
import { downloadLoadedLogs, formatLoadedLogExport } from '../utils/log-export.js';
const props = defineProps<{ run: RunSessionDto | null; serviceId?: string }>();
const emit = defineEmits<{ close: [] }>();
const service=ref(''), stream=ref<''|'stdout'|'stderr'|'system'>(''), keyword=ref(''), from=ref(''), to=ref('');
const loading=ref(false), error=ref(''), pages=ref<StoredLogPage[]>([]), pageIndex=ref(0), offset=ref(0);
const applied=ref<StoredLogQuery>();
const current=computed(()=>pages.value[pageIndex.value]);
let revision=0;
const iso=(value:string)=>value ? new Date(value).toISOString() : undefined;
async function search() {
  if (!props.run) return;
  try {
    applied.value={ runSessionId:props.run.id, serviceSessionId:service.value||undefined, stream:stream.value||undefined, keyword:keyword.value||undefined, from:iso(from.value),to:iso(to.value) };
    pages.value=[]; pageIndex.value=0; offset.value=0;
    await fetchPage();
  } catch(err) { error.value=displayIpcError(err,'查询失败'); }
}
async function fetchPage(cursor?:string) {
  const request=++revision; loading.value=true; error.value='';
  try {
    const result=await window.codehelm.runner.queryLogs(JSON.parse(JSON.stringify({...applied.value,cursor})));
    if (request!==revision) return;
    pages.value.push(result);
    if(pages.value.length>10) { pages.value.shift(); offset.value++; }
    pageIndex.value=pages.value.length-1;
  } catch(err) { if(request===revision) error.value=displayIpcError(err,'日志读取失败'); }
  finally { if(request===revision) loading.value=false; }
}
async function next() {
  if(pageIndex.value<pages.value.length-1) { pageIndex.value++; return; }
  if(current.value?.nextCursor) await fetchPage(current.value.nextCursor);
}
function exportPage() {
  if(!current.value) return;
  downloadLoadedLogs(formatLoadedLogExport(current.value.entries,{...applied.value, snapshotAt:current.value.snapshotAt, page:offset.value+pageIndex.value+1,
    firstTimestamp:current.value.firstTimestamp,lastTimestamp:current.value.lastTimestamp,missingFiles:current.value.missingFiles,skippedRecords:current.value.skippedRecords,truncatedEntries:current.value.truncatedEntries }),`codehelm-history-loaded-page-${Date.now()}.log`);
}
watch(()=>[props.run?.id,props.serviceId],()=>{ revision++; pages.value=[]; error.value=''; loading.value=false; service.value=props.serviceId??''; if(props.run) void search(); },{immediate:true});
</script>
<style scoped>
.log-filters { display:flex; flex-wrap:wrap; align-items:end; gap:10px; }
.log-filters label { display:flex; flex-direction:column; gap:4px; font-size:12px; }
.log-filters input,.log-filters select { background:transparent; border:1px solid #71717a; border-radius:6px; padding:5px 8px; max-width:240px; }
.log-filters input { color-scheme:dark; }
:global(.light) .log-filters input { color-scheme:light; }
.log-filters select option { color:#18181b; }
.stored-log-lines { max-height:44vh; overflow:auto; background:#09090b; color:#e4e4e7; padding:12px; border-radius:8px; }
.log-line { border-bottom:1px solid #3f3f46; padding:8px 0; overflow-wrap:anywhere; }
.log-line span { color:#a1a1aa; }
.log-line pre { white-space:pre-wrap; overflow-wrap:anywhere; font-family:Consolas,monospace; margin:4px 0; }
.stderr pre { color:#fda4af; }
</style>
