import express from 'express';
import { createDecartClient } from '@decartai/sdk';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { garments, garmentSVG } from './catalog.mjs';
import { resolveProductImage } from './product-image.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const MODEL = 'lucy-vton-latest';
function settings() {
  let file = {};
  try { file = parseEnv(readFileSync(path.join(root,'.env'),'utf8')); } catch (e) { if(e.code !== 'ENOENT') throw e; }
  const env = {...process.env,...file};
  return {key:env.DECART_API_KEY?.trim(),code:env.DEMO_ACCESS_CODE || '',extensionId:env.EXTENSION_ID?.trim() || '',
    seconds:Math.max(30,Math.min(600,Number(env.SESSION_SECONDS)||120))};
}
function equal(a,b) { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y); }

export function createApp({getSettings=settings, mintToken, resolveImage=resolveProductImage}={}) {
  const app=express(), attempts=new Map(), imageAttempts=new Map();
  app.disable('x-powered-by');
  app.use(express.json({limit:'2kb'}));
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
      'Permissions-Policy':'camera=(self), microphone=()', 'X-Frame-Options':'DENY'});next();
  });
  app.get('/api/config',(req,res)=>{const c=getSettings();res.json({configured:!!c.key,requiresCode:!!c.code,model:MODEL,sessionSeconds:c.seconds});});
  app.get('/api/garments',(req,res)=>res.json(garments));
  app.post('/api/product-image',async(req,res)=>{
    const origin=req.get('origin');
    if(origin){try{if(new URL(origin).host!==req.get('host'))return res.sendStatus(403);}catch{return res.sendStatus(403);}}
    const now=Date.now(),ip=req.socket.remoteAddress;
    for(const [key,value] of imageAttempts)if(now-value.start>60000)imageAttempts.delete(key);
    const rate=imageAttempts.get(ip)||{start:now,count:0};rate.count++;imageAttempts.set(ip,rate);
    if(rate.count>12)return res.status(429).json({error:'Too many image lookups. Wait a minute and try again.'});
    try { res.json({image:await resolveImage(req.body?.url)}); }
    catch(e){res.status(422).json({error:e.message||'Could not read this product image.'});}
  });
  app.get('/static/garments/:id.svg',(req,res)=>{
    const g=garments.find(g=>g.id===req.params.id);if(!g)return res.sendStatus(404);
    res.type('svg').send(garmentSVG(g));
  });
  async function issueToken(req,res,extension=false) {
    const c=getSettings();
    const origin=req.get('origin');
    let allowedOrigin=origin;
    if(extension) {
      if(!/^chrome-extension:\/\/[a-p]{32}$/.test(origin||''))return res.status(403).json({error:'Extension origin is required.'});
      if(c.extensionId && origin!==`chrome-extension://${c.extensionId}`)return res.sendStatus(403);
      try {
        const page=new URL(req.body?.pageOrigin);
        if(!['http:','https:'].includes(page.protocol)||page.origin!==req.body.pageOrigin)return res.sendStatus(403);
        allowedOrigin=page.origin;
      }catch{return res.sendStatus(403);}
    } else if(origin) {try {if(new URL(origin).host !== req.get('host'))return res.status(403).json({error:'Request origin is not allowed.'});}catch{return res.sendStatus(403);}}
    const now=Date.now(),ip=req.socket.remoteAddress;
    for(const [k,v] of attempts)if(now-v.start>60000)attempts.delete(k);
    const limit=attempts.get(ip)||{start:now,count:0};limit.count++;attempts.set(ip,limit);
    if(limit.count>6)return res.status(429).json({error:'Too many starts. Wait a minute and try again.'});
    if(c.code && !equal(String(req.body?.code||''),c.code))return res.status(401).json({error:'Enter the correct demo access code.'});
    if(!c.key)return res.status(503).json({error:'Decart is not connected yet. Add DECART_API_KEY to the server .env file.'});
    try {
      const options={expiresIn:60,allowedModels:[MODEL],constraints:{realtime:{maxSessionDuration:c.seconds}},...(allowedOrigin?{allowedOrigins:[allowedOrigin]}:{})};
      const token=await (mintToken ? mintToken(options,c.key) : createDecartClient({apiKey:c.key,telemetry:false}).tokens.create(options));
      res.json({apiKey:token.apiKey,expiresAt:token.expiresAt});
    }catch(e){
      console.error('Decart token request failed:',e.code || e.status || e.name);
      res.status(502).json({error:'Decart could not start a session. Check your API key, account credits and model access.'});
    }
  }
  app.post('/api/token',(req,res)=>issueToken(req,res));
  app.post('/api/extension-token',(req,res)=>issueToken(req,res,true));
  app.use('/static',express.static(path.join(root,'static'),{dotfiles:'deny'}));
  app.use('/site',express.static(path.join(root,'site'),{dotfiles:'deny'}));
  app.get('/classic',(req,res)=>res.sendFile(path.join(root,'static/index.html')));
  app.get('/',(req,res)=>res.sendFile(path.join(root,'site/index.html')));
  app.use((err,req,res,next)=>res.status(err.status||500).json({error:'Unable to process this request.'}));
  return app;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const host=process.env.HOST || '127.0.0.1';
  if(!['127.0.0.1','localhost','::1'].includes(host) && !settings().code)throw Error('Set DEMO_ACCESS_CODE before exposing the demo.');
  const port=Number(process.env.PORT)||3000;
  const server=createApp().listen(port,host,()=>console.log(`OpenWear ready at http://${host}:${port}`));
  server.on('error',err=>{console.error(`Unable to listen on ${host}:${port}: ${err.code}`);process.exitCode=1;});
}
