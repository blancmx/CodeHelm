import { expect,it,vi } from 'vitest';
import type { RegisterIpcHandler } from '../trusted-ipc.js';
import { MaintenanceGate } from '../maintenance-gate.js';
it('rejects new operations while waiting for already admitted work to finish',async()=>{
  const gate=new MaintenanceGate();let listener:((...args:unknown[])=>unknown)|undefined;
  const register=((_channel:string,handler:typeof listener)=>{listener=handler;}) as RegisterIpcHandler;
  let finish!:()=>void;const work=new Promise<void>(resolve=>{finish=resolve;});
  gate.wrap(register)('test',()=>work);listener!({});gate.close();
  expect(()=>listener!({})).toThrow('维护');
  const drained=vi.fn();const pending=gate.drain().then(drained);
  await Promise.resolve();expect(drained).not.toHaveBeenCalled();finish();await pending;expect(drained).toHaveBeenCalledOnce();
});
