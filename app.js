'use strict';
const $=id=>document.getElementById(id), center=[24.1796,120.6495], KEY='campus-move-history-v1';
let records=[];try{records=JSON.parse(localStorage.getItem(KEY)||'[]');if(!Array.isArray(records))records=[];}catch{}
let map, route, halo=null, startMarker=null, positionDot, accuracyCircle, targetMarker, targetLine, target=null, current=null;
let session=null, watch=null, demoTimer=null, wake=null, last=null, lastSignal=0, lines=[], storageOK=true, tracker=null;

function message(s){$('message').textContent=s;}
function pinIcon(kind,label){return L.divIcon({className:'map-pin-wrap map-pin-'+kind,html:'<span class="pin-body"><b>'+label+'</b></span>',iconSize:[30,30],iconAnchor:[15,30]});}
function setTrack(lines){if(route)route.setLatLngs(lines);if(halo)halo.setLatLngs(lines);}
function clearStart(){if(startMarker&&map)map.removeLayer(startMarker);startMarker=null;}
function setStart(p){clearStart();if(map)startMarker=L.marker([p.lat,p.lng],{icon:pinIcon('start','起'),zIndexOffset:500}).addTo(map).bindTooltip('起點');}
try{map=L.map('map',{zoomControl:false}).setView(center,17);L.control.zoom({position:'bottomright'}).addTo(map);addBaseMap(map).on('tileerror',()=>message('底圖載入失敗，請檢查網路；Google 地圖/底圖服務可能暫時不可用。'));}catch{};
function updateTarget(){if(!target){$('navigate').hidden=true;$('targetInfo').textContent='點一下地圖，設定老師指定的集合點。';return;}let info='集合點已設定（依老師指定路線與距離判定）';$('navigate').hidden=false;$('targetInfo').textContent=info;}
function clearTarget(){target=null;for(const l of [targetMarker,targetLine])if(l&&map)map.removeLayer(l);targetMarker=targetLine=null;updateTarget();}
$('clearTarget').onclick=clearTarget;$('campus').onclick=()=>map&&map.setView(center,17);
function displayPosition(p){current=p;if(map){const ll=[p.lat,p.lng];if(!positionDot){positionDot=L.circleMarker(ll,{radius:7,color:'white',weight:3,fillColor:'#2f88b3',fillOpacity:1}).addTo(map);}else positionDot.setLatLng(ll);if(!accuracyCircle){accuracyCircle=L.circle(ll,p.accuracy,{color:'#5ab0dc',weight:1,fillColor:'#5ab0dc',fillOpacity:.12}).addTo(map);}else{accuracyCircle.setLatLng(ll);accuracyCircle.setRadius(p.accuracy);}}}
const GEO_REASONS={1:'定位權限被拒絕：請到瀏覽器／手機設定允許位置與精確定位後重試。',2:'目前無法取得位置，請移到戶外空曠處。',3:'定位逾時，請檢查網路與 GPS 訊號。',4:'定位失敗，請再試一次。'};
function geoError(err){if(session?.state==='running')pause('定位中斷，已暫停。'+(GEO_REASONS[err.code]||'請重試。'));else message(GEO_REASONS[err.code]||'定位失敗。');$('badge').textContent='● 定位不可用';}
function locateError(err){message(GEO_REASONS[err.code]||'定位失敗。');if(!session||session.state!=='running')$('badge').textContent='● 定位不可用';}
function available(){if(!window.isSecureContext){message('GPS 需要 HTTPS 網址（電腦本機 localhost 例外），請依部署說明開啟。');return false;}if(!navigator.geolocation){message('此裝置不支援 GPS 定位。');return false;}return true;}
$('locate').onclick=()=>{if(session?.demo){message('示範模式使用模擬位置；結束後可取得真實定位。');return;}if(!available())return;message('正在取得你的定位…');navigator.geolocation.getCurrentPosition(pos=>{displayPosition(normalize(pos));message('定位已更新。');},geoError,{enableHighAccuracy:true,maximumAge:1000,timeout:20000});};
function normalize(pos){return {lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy,t:pos.timestamp};}

function formatHMS(totalSeconds){
  const sec=Math.max(0,Math.floor(totalSeconds));
  const h=String(Math.floor(sec/3600)).padStart(2,'0');
  const m=String(Math.floor((sec%3600)/60)).padStart(2,'0');
  const s=String(sec%60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}

function syncSessionStats(now=Date.now()){
  if(!tracker||!session) return null;
  const stats=tracker.getStats(now);
  session.kcal=stats.caloriesKcal;
  session.seconds=stats.activeSeconds;
  session.distance=stats.totalMeters;
  session.avgSpeed=stats.averageKmh;
  session.validPointCount=stats.validPointCount;
  session.segmentCount=stats.segmentCount;
  session.startEndMeters=stats.startEndMeters;
  session.maxAdjacentKmh=stats.maxAdjacentKmh;
  return stats;
}

function ensureTrackerSession(){
  if(tracker) return;
  const kg=Number(session?.weight ?? session?.kg ?? 60);
  const met=Number(session?.met ?? 3.5);
  tracker=MoveCore.createTracker({kg: Number.isFinite(kg)?kg:null, met: Number.isFinite(met)?met:null});
  tracker.start({at:Date.now(), kg: Number.isFinite(kg)?kg:null, met: Number.isFinite(met)?met:null});
}

function seconds(){
  if(!session) return 0;
  if(tracker) return tracker.getStats(Date.now()).activeSeconds;
  return session.seconds + (session.state==='running'&&session.runStart?(Date.now()-session.runStart)/1000:0);
}

function renderTrackerSummary(){
  if(!tracker || !session) return;
  const stats=tracker.getStats(Date.now());
  const set = (names, value) => {
    for(const id of names){
      const el=$(id);
      if(el){el.textContent = String(value);}
    }
  };

  const totalKm = (stats.totalMeters / 1000).toFixed(2);
  const timeText = formatHMS(stats.activeSeconds);
  const avgSpeedText = `${(stats.averageKmh || 0).toFixed(2)} km/h`;
  const kcalText = stats.caloriesKcal === null ? '—' : `${stats.caloriesKcal.toFixed(1)} kcal`;
  const startEndText = `${stats.startEndMeters.toFixed(1)} m`;

  set(['totalDistance','distance','distanceValue','activityDistance','distanceSummary','distanceTotal'], `${totalKm} km`);
  set(['activeTime','time','timeValue','sessionTime','durationValue'], timeText);
  set(['avgSpeed','speed','paceValue','speedValue','averageKmh'], avgSpeedText);
  set(['calories','calorie','energyValue','kcal','energyKcal'], kcalText);
  set(['startEndDistance','startEndMeters','distanceFromStart','routeLength'], startEndText);
  set(['validPoints','pointCount','pointsValue'], String(stats.validPointCount));
  set(['segmentCount','segmentCountDisplay','segmentsValue'], String(stats.segmentCount));
}

function render(){
  document.body.classList.toggle('is-active',!!session&&session.state!=='finished');
  $('activityLabel').textContent=session?.demo?'示範運動':session?.mode?.split(' · ')[0]||'舒適步行';
  renderTrackerSummary();
}

async function holdScreen(){try{if('wakeLock'in navigator)wake=await navigator.wakeLock.request('screen');}catch{} }
function stopWatch(){if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}clearInterval(demoTimer);demoTimer=null;wake?.release().catch(()=>{});wake=null;}

function receive(p){
  if(!session||session.state!=='running')return;
  lastSignal=Date.now();
  displayPosition(p);

  const result=MoveCore.accept(last,p);
  if(!result.ok){
    message(result.reason);
    return;
  }

  if(!tracker) ensureTrackerSession();
  tracker.addPoint(p, Date.now());
  syncSessionStats(Date.now());

  if(!session.demo){
    lines.push([p.lat,p.lng]);
    setTrack(lines);
  }

  last=p;
  render();
}

function run(){
  if(!session) return;
  session.state='running';
  session.runStart=0;
  last=null;
  lastSignal=Date.now();

  if(!tracker){
    ensureTrackerSession();
  } else if(session.wasPaused){
    tracker.resume(Date.now());
    session.wasPaused=false;
  }

  if(session.demo){
    demoTick();
    demoTimer=setInterval(demoTick,1000);
  } else {
    watch=navigator.geolocation.watchPosition(pos=>{const p=normalize(pos);receive(p);},geoError,{enableHighAccuracy:true,maximumAge:1000,timeout:20000});
  }
  render();
}

function begin(demo){
  const fields=demo?['height','weight','age'].map($):[$('profile')];
  if(!fields.every(el=>el.reportValidity()))return;
  if(!demo&&!available())return;
  $('setupDialog').close();
  stopWatch();

  const userWeight = Number((demo ? 60 : $('weight').value) || 60);
  const userMet = Number((demo ? 3.5 : 3.5) || 3.5);

  session={
    demo,
    state:'running',
    mode:demo?'示範運動 · 休閒步行':'校園步行 · 休閒步行',
    met:userMet,
    weight:userWeight,
    runStart:Date.now(),
    demoIndex:0,
    seconds:0,
    kcal:null,
    distance:0,
    avgSpeed:0,
    validPointCount:0,
    segmentCount:0,
    startEndMeters:0,
    maxAdjacentKmh:0,
    wasPaused:false
  };

  tracker = MoveCore.createTracker({kg:userWeight, met:userMet});
  tracker.start({at:Date.now(), kg:userWeight, met:userMet});
  render();
  run();
}

$('profile').onsubmit=e=>{e.preventDefault();begin(false);};
$('demo').onclick=()=>begin(true);

function demoTick(){
  const i=session.demoIndex++, angle=i*.12;
  const p={lat:center[0]+.00062*Math.sin(angle),lng:center[1]+.00085*Math.cos(angle),accuracy:6,t:Date.now()};
  receive(p);
}

function pause(reason){
  if(!session||session.state!=='running')return;
  if(tracker){tracker.pause(Date.now());session.wasPaused=true;}
  session.seconds=seconds();
  session.runStart=0;
  session.state='paused';
  stopWatch();
  last=null;
  syncSessionStats(Date.now());
  $('badge').textContent='● 已暫停';
  message(reason || '已暫停。');
  render();
}

$('pause').onclick=()=>{if(session&&session.state==='running')pause();else {message('等待新的有效定位後繼續…');run();}};

function persist(){try{localStorage.setItem(KEY,JSON.stringify(records));storageOK=true;}catch{storageOK=false;message('裝置儲存空間不足或儲存被封鎖。紀錄暫留本頁，請先匯出或清空。');}}

$('finish').onclick=()=>{
  if(!session||session.state==='finished')return;
  if(tracker){tracker.finish(Date.now());syncSessionStats(Date.now());}
  session.seconds=seconds();
  session.runStart=0;
  session.state='finished';
  stopWatch();
  message('本次運動已結束。');
  render();
};

function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function cell(v){let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
function exportCSV(items){if(!items.length){message('目前沒有可匯出的紀錄。');return;}const rows=[['時間 ISO','課堂代號','類型','活動','身高 cm','體重 kg','年齡','時間[秒]','距離[m]','熱量[kcal]','說明']];for(const item of items){rows.push([item.iso||'',item.classCode||'',item.type||'',item.activity||'',item.height||'',item.weight||'',item.age||'',item.seconds||'',item.distance||'',item.kcal||'',item.note||'']);}const csv=rows.map(r=>r.map(cell).join(',')).join('\n');download('pace-history.csv',csv,'text/csv');}
let historyFilter='all';
function routeThumbnail(r){const box=document.createElement('div');box.className='route-thumb';const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 80 52');const bg=document.createElementNS(ns,'rect');bg.setAttribute('x','0');bg.setAttribute('y','0');bg.setAttribute('width','80');bg.setAttribute('height','52');bg.setAttribute('fill','#e8f2f8');svg.appendChild(bg);if(Array.isArray(r)&&r.length){const path=document.createElementNS(ns,'path');let d='';r.forEach((p,i)=>{const x=(p[0]-minLat)/(maxLat-minLat)*70+5;const y=(p[1]-minLng)/(maxLng-minLng)*40+6;d+=(i?'L':'M')+`${x} ${y}`;});path.setAttribute('d',d);path.setAttribute('fill','none');path.setAttribute('stroke','#2f88b3');path.setAttribute('stroke-width','2');svg.appendChild(path);}box.appendChild(svg);return box;}
function renderHistory(){const root=$('records');if(!root) return;root.replaceChildren();const actual=records.filter(r=>!r.demo);$('historyTotal').textContent=actual.length?`${actual.length} 次運動 · ${(actual.reduce((s,r)=>s+(Number(r.distance)||0),0)/1000).toFixed(1)} km`: '0 次運動';}
$('openSetup').onclick=()=>$('setupDialog').showModal();$('closeSetup').onclick=()=>$('setupDialog').close();$('energyInfo').onclick=()=>$('energyDialog').showModal();$('closeEnergy').onclick=()=>$('energyDialog').close();
$('todayDate').textContent=new Date().toLocaleDateString('zh-TW',{month:'long',day:'numeric',weekday:'short'});
document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{historyFilter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('select',b===button);});renderHistory();});
$('exportAll').onclick=()=>exportCSV(records);$('deleteAll').onclick=()=>{if(records.length&&confirm('永久刪除此裝置全部運動紀錄？')){records=[];persist();renderHistory();}};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.state==='running')pause('頁面已離開前景，為避免漏記與錯估已自動暫停。回到頁面後按「繼續」。');});
window.addEventListener('beforeunload',e=>{if(session&&session.state!=='finished'){e.preventDefault();e.returnValue='';}});
setInterval(()=>{if(session?.state==='running'&&!session.demo&&Date.now()-lastSignal>30000)pause('超過 30 秒沒有 GPS 更新，已自動暫停。請檢查定位後按繼續。');render();},1000);
renderHistory();render();if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
document.querySelectorAll('.sidenav a[href^="#"]').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('.sidenav a').forEach(n=>n.classList.toggle('active',n===a));document.querySelectorAll('.page').forEach(el=>el.hidden = true); const target = document.querySelector(a.getAttribute('href')); if(target) target.hidden = false;}));
