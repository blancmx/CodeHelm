import type { RegisterIpcHandler } from './trusted-ipc.js';

/** Freeze new business IPC and drain admitted asynchronous work before restore. */
export class MaintenanceGate {
  private closed=false;
  private pending=new Set<Promise<unknown>>();
  wrap(handle:RegisterIpcHandler):RegisterIpcHandler {
    return (channel,listener)=>handle(channel,(event,...args)=>{
      if(this.closed)throw new Error('数据库恢复维护中，请关闭应用后重新打开。');
      const result=listener(event,...args);
      if(!result || typeof result.then!=='function')return result;
      const tracked=Promise.resolve(result);this.pending.add(tracked);
      void tracked.finally(()=>this.pending.delete(tracked)).catch(()=>undefined);
      return tracked;
    });
  }
  close(){this.closed=true;}
  async drain(){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      await Promise.race([Promise.allSettled([...this.pending]),new Promise<never>((_resolve,reject)=>{
        timer=setTimeout(()=>reject(new Error('仍有操作未结束，已拒绝恢复。')),10_000);
      })]);
    } finally {clearTimeout(timer);}
  }
}
