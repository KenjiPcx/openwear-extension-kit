import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,MODEL} from '../server.mjs';

async function fixture(t, settings={key:'test-secret',code:'demo',seconds:120}, mintToken=async()=>({apiKey:'short-token',expiresAt:'later'})) {
  const server=createApp({getSettings:()=>settings,mintToken}).listen(0,'127.0.0.1');
  await new Promise(r=>server.on('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(body={code:'demo'},headers={})=>fetch(base+'/api/token',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  return {base,post};
}
test('config does not expose secrets and catalog contains four original garments',async t=>{
  const {base}=await fixture(t);
  const body=await (await fetch(base+'/api/config')).text();assert.ok(!body.includes('test-secret'));assert.ok(!body.includes('"demo"'));
  const catalog=await (await fetch(base+'/api/garments')).json();assert.equal(catalog.length,4);
  for(const g of catalog){const r=await fetch(`${base}/static/garments/${g.id}.svg`);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/svg/);}
  assert.equal((await fetch(base+'/.env')).status,404);
});
test('wrong code and cross-origin requests cannot mint tokens',async t=>{
  let calls=0;const {post}=await fixture(t,undefined,async()=>{calls++;return {};});
  assert.equal((await post({code:'wrong'})).status,401);
  assert.equal((await post({code:'demo'},{Origin:'https://other.example'})).status,403);
  assert.equal(calls,0);
});
test('token has duration, origin and model limits and only ephemeral key returns',async t=>{
  let captured;const {post,base}=await fixture(t,undefined,async(options,key)=>{captured={options,key};return {apiKey:'short-token',expiresAt:'later',internal:'do-not-return'};});
  const response=await post({code:'demo'},{Origin:base});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{apiKey:'short-token',expiresAt:'later'});
  assert.deepEqual(captured.options,{expiresIn:60,allowedModels:[MODEL],constraints:{realtime:{maxSessionDuration:120}},allowedOrigins:[base]});
  assert.equal(captured.key,'test-secret');
});
test('extension tokens are restricted to the requesting page origin',async t=>{
  let captured;const {base}=await fixture(t,undefined,async options=>{captured=options;return {apiKey:'short-token',expiresAt:'later'};});
  const extension='chrome-extension://'+'a'.repeat(32);
  const post=(origin,pageOrigin)=>fetch(base+'/api/extension-token',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({code:'demo',pageOrigin})});
  assert.equal((await post('https://other.example','https://shop.example')).status,403);
  assert.equal((await post(extension,'file:///etc/passwd')).status,403);
  assert.equal((await post(extension,'https://shop.example/path')).status,403);
  assert.equal((await post(extension,'https://shop.example')).status,200);
  assert.deepEqual(captured.allowedOrigins,['https://shop.example']);
});
test('missing key fails clearly before calling Decart',async t=>{
  const {post}=await fixture(t,{key:'',code:'',seconds:120});assert.equal((await post({})).status,503);
});
test('upstream errors never return provider secret material',async t=>{
  const {post}=await fixture(t,undefined,async()=>{throw Error('sensitive test-secret');});
  const r=await post();assert.equal(r.status,502);assert.ok(!(await r.text()).includes('test-secret'));
});
test('token creation is rate limited',async t=>{
  const {post}=await fixture(t);for(let i=0;i<6;i++)assert.equal((await post()).status,200);assert.equal((await post()).status,429);
});
