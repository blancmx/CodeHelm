<template>
  <section class="backup-panel border rounded-xl p-5 space-y-4" :class="theme.isDark?'bg-[#121216] border-[#27272a]':'bg-white border-zinc-200'" aria-labelledby="backup-heading">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3 id="backup-heading" class="text-sm font-bold">备份与恢复</h3>
      <div class="flex flex-wrap gap-2">
        <n-button size="small" :disabled="busy||finished" @click="load">刷新备份</n-button>
        <n-button size="small" :disabled="busy||finished" @click="perform(()=>api.create())">创建管理数据备份</n-button>
        <n-button size="small" @click="perform(()=>api.openDirectory(),false)">打开备份目录</n-button>
      </div>
    </div>
    <p class="text-xs leading-relaxed">备份包含项目记录、运行方案、设置与历史；不包含项目源码、依赖或服务日志。备份可能含敏感信息，请妥善保管。恢复不回滚项目及其服务产生的数据。</p>
    <form class="flex flex-wrap items-end gap-3" @submit.prevent="perform(()=>api.setPolicy({...policy}))">
      <label class="text-xs">最多备份数量<input v-model.number="policy.maxBackups" aria-label="最多备份数量" type="number" min="3" max="200" required /></label>
      <label class="text-xs">备份容量上限（MiB）<input v-model.number="policy.maxTotalMb" aria-label="备份容量上限" type="number" min="64" max="20480" required /></label>
      <n-button size="small" attr-type="submit" :disabled="busy||finished">保存备份策略</n-button>
    </form>
    <p class="text-xs">至少保留三个恢复点；明确保留、恢复前保全和未完成备份不自动清理。策略在下一次成功备份后应用。列表最多展示最近 200 个目录。</p>
    <p v-if="busy" role="status" class="text-sm">正在处理备份，请稍候…</p>
    <p v-if="error" role="alert" class="text-sm text-rose-500">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm">{{ notice }}</p>
    <div v-if="finished" class="space-y-2">
      <p>请关闭应用后重新打开，以载入恢复的数据或解除维护状态。</p>
      <n-button @click="windowApi.close()">关闭应用</n-button>
    </div>
    <ul class="space-y-3 max-h-96 overflow-auto" aria-label="数据库备份列表">
      <li v-for="item in entries" :key="item.id" class="border border-zinc-500/40 rounded-lg p-3 space-y-2">
        <div class="flex flex-wrap justify-between gap-2">
          <div class="min-w-0 text-xs leading-relaxed">
            <p class="font-semibold break-all">{{ item.createdAt ? new Date(item.createdAt).toLocaleString() : item.id }} · {{ item.status==='verified'?'校验通过':'不可用' }}</p>
            <p>版本 {{ item.appVersion }} · schema {{ item.schemaVersion }} · {{ (item.bytes/1024/1024).toFixed(2) }} MiB · {{ reasons[item.reason]||item.reason }}</p>
            <p v-if="item.error" class="text-rose-500">{{ item.error }}</p>
          </div>
          <div class="flex gap-2 items-center">
            <n-button size="small" :disabled="busy||finished||item.status!=='verified'||item.reason==='before-restore'" @click="perform(()=>api.pin(item.id,!item.pinned))">{{ item.pinned?'解除保留':'明确保留' }}</n-button>
            <n-button size="small" :disabled="busy||finished||item.status!=='verified'" @click="prepare(item.id)">预检恢复</n-button>
          </div>
        </div>
      </li>
    </ul>
    <p v-if="!busy&&!entries.length" class="text-sm">暂无可列出的备份。</p>
    <n-modal :show="!!preview" preset="card" title="恢复预检结果" class="!w-[min(680px,94vw)]" @update:show="!$event&&(preview=null)">
      <template v-if="preview">
        <p class="break-all text-sm">备份 {{ preview.backupId }}</p>
        <p class="my-3">完整性、外键和迁移预检通过。schema {{ preview.schemaVersion }} → {{ preview.targetSchemaVersion }}；项目 {{ preview.counts.projects }} 个，方案 {{ preview.counts.run_profiles }} 个。</p>
        <p>恢复将替换当前管理数据，备份之后新增的数据会丢失；已保存的执行确认将失效。恢复前会保全当前数据。</p>
        <p class="my-3">本机无法解密的敏感值：{{ preview.unreadableSecrets }} 个。确认恢复后这些值将清空并标为必填，须重新输入才能启动。</p>
        <p class="my-3">接下来会出现系统确认对话框。确认后停止任务与受管进程；成功或失败后均需关闭应用并重新打开。</p>
        <div class="flex gap-3 justify-end">
          <n-button :disabled="busy" @click="preview=null">取消预检</n-button>
          <n-button type="warning" :loading="busy" @click="restore">继续恢复确认</n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>
<script setup lang="ts">
import { onMounted,reactive,ref } from 'vue';
import type { BackupSummaryDto,RestorePreviewDto } from '@codehelm/contracts';
import { useThemeStore } from '../stores/themeStore.js';
import { displayIpcError } from '../utils/ipc-error.js';
const theme=useThemeStore(),api=window.codehelm.backups,windowApi=window.codehelm.window;
const entries=ref<BackupSummaryDto[]>([]),preview=ref<RestorePreviewDto|null>(null);
const busy=ref(false),finished=ref(false),error=ref(''),notice=ref('');
const policy=reactive({maxBackups:20,maxTotalMb:2048});
const reasons:Record<string,string>={'manual':'手动备份','before-restore':'恢复前保全','before-startup':'启动前备份','first-startup':'首次启动','periodic':'定时备份','legacy-import':'旧版导入'};
async function load(){await perform(async()=>{const state=await api.list();entries.value=state.entries;Object.assign(policy,state.policy);notice.value=state.notice??'';},false);}
async function perform(action:()=>Promise<unknown>,refresh=true){
  if(busy.value)return;busy.value=true;error.value='';
  try {await action();} catch(err){error.value=displayIpcError(err,'备份操作失败');}
  finally {busy.value=false;}
  if(refresh&&!error.value)await load();
}
async function prepare(id:string){await perform(async()=>{preview.value=await api.prepare(id);},false);}
async function restore(){
  if(!preview.value)return;const token=preview.value.token;
  await perform(async()=>{
    try {const result=await api.restore(token);if(result.restored){finished.value=true;notice.value=`恢复完成。原数据保全目录：${result.preservedDirectory}`;}}
    catch(err){finished.value=true;throw err;}finally {preview.value=null;}
  },false);
}
onMounted(load);
</script>
<style scoped>
.backup-panel input{display:block;background:transparent;border:1px solid #71717a;border-radius:6px;padding:6px 8px;margin-top:6px;width:170px;}
</style>
