import { createDecartClient, models } from '@decartai/sdk';
import { cameraConstraints } from './camera.js';
const $=id=>document.getElementById(id);
let config, catalog, selected='cobalt', customBlob, localStream, realtime, generation=0, busy=false, timer, startedAt, updating=false, pending=false, frameCallback, lastFrameTime, displayedFrames=0, firstFrame=false, frameWaitTimer, providerFailure='';
const error=message=>{$('error').textContent=message;$('error').hidden=!message;};
const status=message=>{$('status').textContent=message;};
const model=models.realtime('lucy-vton-latest');
const sdkLogger={
  debug(){},info(){},
  warn(message,data){console.warn('[DecartSDK]',message,data?JSON.stringify(data):'');},
  error(message,data){
    const detail=data?.error?.message||data?.error||data?.message||'';
    if(detail&&!/stale connect attempt/i.test(String(detail)))providerFailure=String(detail);
    console.error('[DecartSDK]',message,data?JSON.stringify(data):'');
  },
};
const code=()=>sessionStorage.getItem('openwear-code')||'';
const prompts=()=>selected==='custom'?($('description').value.trim()||'the garment shown in the reference image'):catalog.find(g=>g.id===selected).prompt;

async function getGarment() {
  if(selected==='custom')return customBlob;
  const image=new Image();image.src=`/static/garments/${selected}.svg`;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;canvas.getContext('2d').drawImage(image,0,0);
  return new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
}
function select(id) {
  selected=id;document.querySelectorAll('.garment').forEach(el=>{el.classList.toggle('selected',el.dataset.id===id);el.setAttribute('aria-pressed',String(el.dataset.id===id));});
  $('customFields').hidden=id!=='custom';
  if(!$('previewGarment').hidden&&id!=='custom')$('previewGarment').src=`/static/garments/${id}.svg`;
  if(realtime)applyGarment();
}
async function applyGarment() {
  pending=true;if(updating)return;
  updating=true;
  try {while(pending && realtime){pending=false;const client=realtime,current=generation;
    const description=prompts(), image=await getGarment();
    if(current!==generation||client!==realtime)break;
    status('Applying your look…');
    await client.setImage(image,{prompt:`Substitute the current top with ${description}`,enhance:false});
    if(current===generation)status('● Live try-on');
  }}catch{error('This garment could not be applied. Try selecting it again.');}
  finally{updating=false;}
}
function stop(message='Camera off') {
  generation++;busy=false;pending=false;firstFrame=false;clearInterval(timer);clearTimeout(frameWaitTimer);
  const client=realtime;realtime=null;client?.disconnect();
  localStream?.getTracks().forEach(t=>t.stop());localStream=null;
  if(frameCallback)$('output').cancelVideoFrameCallback?.(frameCallback);frameCallback=undefined;
  $('camera').srcObject=null;$('output').srcObject=null;
  $('previewGarment').hidden=true;$('resultLabel').textContent='AI TRY-ON';
  $('camera').classList.remove('active');$('output').classList.remove('active');
  $('cameraEmpty').hidden=false;$('resultEmpty').hidden=false;
  $('start').disabled=false;$('start').textContent='Enable camera ↗';$('stop').disabled=true;$('save').disabled=true;
  status(message);$('metrics').textContent='Camera and streaming stopped';
}
function startLayoutPreview(media) {
  busy=false;firstFrame=true;
  $('output').srcObject=media;$('output').classList.add('active');$('output').play().catch(()=>{});
  $('resultEmpty').hidden=true;$('previewGarment').src=`/static/garments/${selected}.svg`;$('previewGarment').hidden=false;
  $('resultLabel').textContent='LAYOUT PREVIEW';$('save').disabled=true;
  status('● Camera preview');$('metrics').textContent='Non-AI preview · Lucy VTON access required';
  error('This Decart API key does not permit Lucy VTON. Showing a non-AI layout preview; enable the model on the Decart account for generated video.');
}
function trackFrames(now,metadata) {
  if(!realtime && !busy)return;
  if(!firstFrame){
    firstFrame=true;clearTimeout(frameWaitTimer);
    $('output').classList.add('active');$('resultEmpty').hidden=true;$('save').disabled=false;
    status('● Live try-on');
  }
  if(lastFrameTime && now-lastFrameTime>1000){$('fps').textContent=`${Math.round((metadata.presentedFrames-displayedFrames)*1000/(now-lastFrameTime))} fps`;lastFrameTime=now;displayedFrames=metadata.presentedFrames;}
  if(!lastFrameTime){lastFrameTime=now;displayedFrames=metadata.presentedFrames;}
  frameCallback=$('output').requestVideoFrameCallback?.(trackFrames);
}
async function refreshConfig() {
  config=await fetch('/api/config').then(r=>r.json());
  $('setup').hidden=config.configured;
  $('access').hidden=!config.requiresCode;
  if(!busy && !realtime)status(config.configured?'● Ready to try on':'Connect Decart to go live');
}
$('start').onclick=async()=>{
  if(busy||realtime)return;
  error('');busy=true;const current=++generation;$('start').disabled=true;$('start').textContent='Opening camera…';
  let media;
  try {
    await refreshConfig();if(current!==generation)return;
    if(!config.configured)throw Error('Add your Decart API key to .env, then click Enable camera.');
    if(config.requiresCode&&!code()){$('codeDialog').showModal();stop();return;}
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access needs HTTPS or localhost. Open this app in a supported browser.');
    media=await navigator.mediaDevices.getUserMedia(cameraConstraints(model));
    if(current!==generation){media.getTracks().forEach(t=>t.stop());return;}
    localStream=media;$('camera').srcObject=media;await $('camera').play();
    if(current!==generation)return;
    $('camera').classList.add('active');$('cameraEmpty').hidden=true;$('stop').disabled=false;status('Connecting your fitting room…');
    media.getVideoTracks()[0].onended=()=>stop('Camera disconnected');
    const response=await fetch('/api/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code()})});
    const token=await response.json();if(!response.ok)throw Error(token.error);
    const image=await getGarment(), description=prompts();
    if(current!==generation)return;
    providerFailure='';
    const client=createDecartClient({apiKey:token.apiKey,telemetry:false,logger:sdkLogger});
    const connection=await client.realtime.connect(media,{
      model,mirror:'auto',
      onRemoteStream:remote=>{
        if(current!==generation)return;
        $('output').srcObject=remote;$('output').play().catch(()=>{});
        const track=remote.getVideoTracks()[0];
        if(!track){status('Connected · waiting for Decart video…');return;}
        status(track.muted?'Connected · waiting for Decart video…':'Connected · preparing AI video…');
        track.onunmute=()=>{if(current===generation&&!firstFrame)status('AI video received · decoding first frame…');};
        track.onmute=()=>{if(current===generation&&!firstFrame)status('AI video paused · waiting for Decart…');};
        track.onended=()=>{if(current===generation){error('Decart ended the returned video track. Start a new session.');stop('AI video ended');}};
      },
    });
    if(current!==generation){connection.disconnect();return;}
    realtime=connection;busy=false;startedAt=Date.now();lastFrameTime=null;
    connection.on('error',()=>{if(current===generation){error('The video service reported an error. Start again to reconnect.');stop('Connection interrupted');}});
    connection.on('connectionChange',state=>{if(current===generation && state==='disconnected'){error('The video connection ended. You can start a new session.');stop('Disconnected');}});
    connection.on('queuePosition',queue=>{if(current===generation&&!firstFrame)status(`Decart queue · position ${queue.position} of ${queue.queueSize}`);});
    connection.on('generationTick',tick=>{if(current===generation&&!firstFrame)status(`Decart generating · ${tick.seconds}s`);});
    connection.on('generationEnded',event=>{if(current===generation&&!firstFrame)error(`Decart stopped before returning a frame: ${event.reason}.`);});
    connection.on('sessionEnded',()=>{if(current===generation)stop('Session ended — start again to continue');});
    status('Connected · applying garment…');
    await connection.setImage(image,{prompt:`Substitute the current top with ${description}`,enhance:false});
    if(current!==generation)return;
    if(!firstFrame)status('Connected · waiting for first AI frame…');
    frameWaitTimer=setTimeout(()=>{
      if(current!==generation||firstFrame)return;
      const v=$('output'),track=v.srcObject?.getVideoTracks?.()[0];
      const detail=track?`${track.readyState}${track.muted?' / muted':''}`:'no remote track';
      error(`No AI frame arrived after 20 seconds (${detail}). The Decart session connected, but its output video did not start.`);
      status('Connected · no AI frames received');
    },20000);
    if(prompts()!==description)applyGarment();
    timer=setInterval(()=>{const left=Math.max(0,config.sessionSeconds-Math.floor((Date.now()-startedAt)/1000));$('metrics').textContent=`Live session · ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')} remaining`;if(!left)stop('Demo session complete');},250);
    if($('output').requestVideoFrameCallback)frameCallback=$('output').requestVideoFrameCallback(trackFrames);
    else $('output').onloadeddata=()=>trackFrames(performance.now(),{presentedFrames:1});
  }catch(e){if(current!==generation)return;if(/model not permitted/i.test(providerFailure)){startLayoutPreview(media);return;}stop('Ready when you are');error(e.name==='NotAllowedError'?'Camera access was declined. Allow camera access in your browser and try again.':providerFailure||e.message||'Could not connect. Please try again.');}
};
$('output').onplaying=()=>{if(!firstFrame)status('Remote video playing · waiting for decoded frame…');};
$('stop').onclick=()=>stop();
$('upload').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>4*1024*1024){error('Choose a JPG, PNG or WebP smaller than 4 MB.');return;}
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=url;await image.decode();
    const c=document.createElement('canvas');c.width=c.height=768;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,768,768);const scale=Math.min(768/image.width,768/image.height);x.drawImage(image,(768-image.width*scale)/2,(768-image.height*scale)/2,image.width*scale,image.height*scale);
    customBlob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.92));
    let b=document.querySelector('[data-id="custom"]');if(!b){b=document.createElement('button');b.className='garment';b.dataset.id='custom';b.onclick=()=>select('custom');$('garments').append(b);}
    const thumbnail=new Image();thumbnail.src=c.toDataURL('image/jpeg',.7);thumbnail.alt='Uploaded garment';const name=document.createElement('strong');name.textContent='Your garment';b.replaceChildren(thumbnail,name);$('count').textContent='5 LOOKS';error('');select('custom');
  }catch{error('This image could not be opened. Try another file.');}finally{URL.revokeObjectURL(url);}
};
$('description').onchange=()=>{if(realtime)applyGarment();};
$('save').onclick=()=>{
  const v=$('output');if(!v.videoWidth)return;
  const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.translate(c.width,0);x.scale(-1,1);x.drawImage(v,0,0);c.toBlob(blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='openwear-look.jpg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/jpeg',.95);
};
$('access').onclick=()=>$('codeDialog').showModal();
$('codeForm').onsubmit=event=>{event.preventDefault();sessionStorage.setItem('openwear-code',$('code').value.trim());$('codeDialog').close();};
$('codeCancel').onclick=()=>$('codeDialog').close();
window.addEventListener('pagehide',()=>stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&realtime)stop('Paused while away');});
try {
  catalog=await fetch('/api/garments').then(r=>r.json());
  for(const g of catalog){const b=document.createElement('button');b.className='garment';b.dataset.id=g.id;const img=new Image();img.src=`/static/garments/${g.id}.svg`;img.alt=g.name;const name=document.createElement('strong');name.textContent=g.name;const kind=document.createElement('small');kind.textContent=g.kind;b.append(img,name,kind);b.onclick=()=>select(g.id);$('garments').append(b);}
  select(selected);await refreshConfig();
}catch{error('The app server could not be reached. Reload to try again.');}
