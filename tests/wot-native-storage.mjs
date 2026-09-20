import process from 'node:process';
import console from 'node:console';
import {setTimeout} from 'node:timers';
import {performance} from 'node:perf_hooks';
/** Opt-in native Chrome IndexedDB test. Uses a disposable profile, never the user's Chrome. */
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import WebSocket from 'ws';
const dir=await mkdtemp(join(tmpdir(),'wot-native-'));
const shim=join(dir,'browser.js');
await writeFile(shim,`const listeners=[];
const local={async get(keys){const names=typeof keys==='string'?[keys]:keys||Object.keys(localStorage);return Object.fromEntries(names.map(k=>[k,JSON.parse(localStorage.getItem(k)||'null')]));},async set(values){const changes={};for(const [k,v] of Object.entries(values)){localStorage.setItem(k,JSON.stringify(v));changes[k]={newValue:v};}listeners.forEach(fn=>fn(changes,'local'));},async remove(key){localStorage.removeItem(key);listeners.forEach(fn=>fn({[key]:{}},'local'));}};
export default {storage:{local,onChanged:{addListener(fn){listeners.push(fn);}}}};`);
await build({stdin:{contents:`
import {commitSnapshot,readSnapshot,removeSnapshot,snapshotSummary} from './src/services/wot/snapshots.ts';
window.testStorage=async(stage)=>{
 const key='experimentalWotGraph:native';
 if(stage==='write'){
  const root='1'.padStart(64,'0');
  const follows=Array.from({length:600000},(_,i)=>(i+2).toString(16).padStart(64,'0'));
  const summary=await commitSnapshot(key,{root,follows:{[root]:follows},relays:{},updatedAt:1,truncated:false});
  if(summary.bytes<40*1024*1024)throw Error('Fixture must exceed 40 MiB');
  return {bytes:summary.bytes,localMetadataBytes:JSON.stringify(localStorage).length};
 }
 if(stage==='reload'){
  const first=await readSnapshot(key),second=await readSnapshot(key);
  if(!first||first.follows[first.root].length!==600000||first!==second)throw Error('Roundtrip/cache mismatch');
  const summary=await snapshotSummary(key);
  await removeSnapshot(key);
  if(await readSnapshot(key)!==null)throw Error('Clear failed');
  return {people:summary.people,warmCacheReused:first===second,cleared:true};
 }
};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',platform:'browser',outfile:join(dir,'bundle.js'),alias:{'@lib/browser.ts':shim}});
const server=createServer(async(req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?await readFile(join(dir,'bundle.js')):'<script src="/bundle.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--user-data-dir=${join(dir,'profile')}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
let socket;
try{
 let port;
 for(let i=0;i<200;i++){try{port=(await readFile(join(dir,'profile','DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!port)throw Error('Chrome debugging endpoint did not start');
 const target=await (await globalThis.fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin)}`,{method:'PUT'})).json();
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});
 let id=0;const pending=new Map();
 socket.on('message',raw=>{const data=JSON.parse(raw);if(data.id){const item=pending.get(data.id);pending.delete(data.id);if(data.error)item.reject(data.error);else item.resolve(data.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async(expression)=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const ready=async()=>{for(let i=0;i<200;i++){if(await evaluate("typeof window.testStorage==='function'"))return;await new Promise(r=>setTimeout(r,50));}throw Error('Harness not loaded');};
 await ready();
 const start=performance.now();const write=await evaluate("window.testStorage('write')");
 await send('Page.enable');await send('Page.reload');await new Promise(r=>setTimeout(r,200));await ready();
 const restored=await evaluate("window.testStorage('reload')");
 console.log(JSON.stringify({nativeChrome:true,origin:'isolated HTTP origin',...write,...restored,totalMs:performance.now()-start}));
}finally{
 socket?.close();chrome.kill();server.close();
 await new Promise(r=>setTimeout(r,500));await rm(dir,{recursive:true,force:true});
}
