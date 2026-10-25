(function(root){
  const rad=n=>n*Math.PI/180;

  function distance(a,b){
    const dlat=rad(b.lat-a.lat), dlon=rad(b.lng-a.lng);
    const h=Math.sin(dlat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;
    return 6371000*2*Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
  }

  function calories(met,kg,seconds){
    if(!Number.isFinite(met) || !Number.isFinite(kg) || !Number.isFinite(seconds)) return null;
    if(met<=0 || kg<=0 || seconds<0) return null;
    return met*3.5*kg/200*seconds/60;
  }

  function accept(previous,p){
    if(!p || typeof p!=='object') return {ok:false, reason:'定位資料不存在。'};
    const lat=Number(p.lat), lng=Number(p.lng), t=Number(p.t), accuracy=Number(p.accuracy);
    if(!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t) || !Number.isFinite(accuracy)){
      return {ok:false, reason:'定位資料不完整。'};
    }
    if(Math.abs(lat)>90 || Math.abs(lng)>180){
      return {ok:false, reason:'經緯度超出合理範圍。'};
    }
    if(accuracy<0 || accuracy>200){
      return {ok:false, reason:'GPS 精度異常。'};
    }
    if(previous){
      const prevT=Number(previous.t);
      if(!Number.isFinite(prevT) || prevT<0 || t<=prevT){
        return {ok:false, reason:'時間資料不合理，已略過。'};
      }
      const diffMs=t-prevT;
      if(diffMs>30000){
        return {ok:true, meters:0, break:true, reason:'定位間隔超過 30 秒，另起新段。'};
      }
      const meters=distance(previous,p);
      if(!Number.isFinite(meters) || meters<0){
        return {ok:false, reason:'距離計算失敗。'};
      }
      if(meters>300){
        return {ok:false, reason:'GPS 跳動，已略過。'};
      }
      return {ok:true, meters, break:false, reason:''};
    }
    return {ok:true, meters:0, break:false, reason:''};
  }

  function createTracker(initial={}){
    const state={
      kg: Number(initial.kg),
      met: Number(initial.met),
      startedAt:null,
      endAt:null,
      runningSince:null,
      pausedMs:0,
      totalMeters:0,
      validPointCount:0,
      segmentCount:0,
      firstValidPoint:null,
      lastValidPoint:null,
      lastAcceptedPoint:null,
      maxAdjacentKmh:0,
      started:false,
      running:false,
      paused:false,
      finished:false
    };

    function getActiveSeconds(now=Date.now()){
      if(!state.startedAt) return 0;
      const endAt = state.running ? now : (state.endAt ?? state.startedAt);
      return Math.max(0, (endAt - state.startedAt - state.pausedMs) / 1000);
    }

    function getStats(now=Date.now()){
      const activeSeconds = getActiveSeconds(now);
      const averageKmh = activeSeconds > 0 ? state.totalMeters / activeSeconds * 3.6 : 0;
      const caloriesKcal = (Number.isFinite(state.kg) && state.kg > 0 && Number.isFinite(state.met) && state.met > 0)
        ? calories(state.met, state.kg, activeSeconds)
        : null;
      const startEndMeters = (state.firstValidPoint && state.lastValidPoint && state.firstValidPoint !== state.lastValidPoint)
        ? distance(state.firstValidPoint, state.lastValidPoint)
        : 0;

      return {
        totalMeters: state.totalMeters,
        activeSeconds,
        averageKmh,
        caloriesKcal,
        validPointCount: state.validPointCount,
        segmentCount: state.segmentCount,
        startEndMeters,
        maxAdjacentKmh: state.maxAdjacentKmh
      };
    }

    function reset(){
      Object.assign(state,{
        kg: Number(initial.kg),
        met: Number(initial.met),
        startedAt:null,
        endAt:null,
        runningSince:null,
        pausedMs:0,
        totalMeters:0,
        validPointCount:0,
        segmentCount:0,
        firstValidPoint:null,
        lastValidPoint:null,
        lastAcceptedPoint:null,
        maxAdjacentKmh:0,
        started:false,
        running:false,
        paused:false,
        finished:false
      });
      return getStats();
    }

    function start(at=Date.now(), overrides={}){
      if(state.started && !state.finished) return getStats();
      state.kg = Number(overrides.kg ?? initial.kg ?? state.kg);
      state.met = Number(overrides.met ?? initial.met ?? state.met);
      state.startedAt = at;
      state.endAt = at;
      state.runningSince = at;
      state.pausedMs = 0;
      state.totalMeters = 0;
      state.validPointCount = 0;
      state.segmentCount = 0;
      state.firstValidPoint = null;
      state.lastValidPoint = null;
      state.lastAcceptedPoint = null;
      state.maxAdjacentKmh = 0;
      state.started = true;
      state.running = true;
      state.paused = false;
      state.finished = false;
      return getStats(at);
    }

    function addPoint(point, at=Date.now()){
      if(!state.started || state.finished || !state.running) return getStats(at);
      const result = accept(state.lastAcceptedPoint, point);
      if(!result.ok) return getStats(at);

      const p={
        lat:Number(point.lat),
        lng:Number(point.lng),
        t:Number(point.t),
        accuracy:Number(point.accuracy)
      };

      const isFirstValid = state.firstValidPoint === null;
      const isNewSegment = isFirstValid || state.lastAcceptedPoint === null || result.break === true;

      if(isFirstValid){
        state.firstValidPoint = p;
        state.segmentCount = 1;
      }else if(isNewSegment){
        state.segmentCount += 1;
      }

      if(state.lastAcceptedPoint && !result.break){
        const deltaMs = p.t - state.lastAcceptedPoint.t;
        if(Number.isFinite(deltaMs) && deltaMs > 0){
          const meters = result.meters || distance(state.lastAcceptedPoint, p);
          if(Number.isFinite(meters) && meters >= 0){
            state.totalMeters += meters;
            const adjacentKmh = meters / (deltaMs / 1000) * 3.6;
            if(Number.isFinite(adjacentKmh) && adjacentKmh > 0 && adjacentKmh > state.maxAdjacentKmh){
              state.maxAdjacentKmh = adjacentKmh;
            }
          }
        }
      }

      state.validPointCount += 1;
      state.lastValidPoint = p;
      state.lastAcceptedPoint = p;
      return getStats(at);
    }

    function pause(at=Date.now()){
      if(!state.started || state.finished || !state.running) return getStats(at);
      state.pausedMs += at - (state.runningSince ?? at);
      state.runningSince = null;
      state.running = false;
      state.paused = true;
      state.endAt = at;
      state.lastAcceptedPoint = null;
      return getStats(at);
    }

    function resume(at=Date.now()){
      if(!state.started || state.finished || !state.paused) return getStats(at);
      state.runningSince = at;
      state.running = true;
      state.paused = false;
      state.endAt = at;
      state.lastAcceptedPoint = null;
      return getStats(at);
    }

    function finish(at=Date.now()){
      if(!state.started || state.finished) return getStats(at);
      state.endAt = at;
      state.runningSince = null;
      state.running = false;
      state.paused = false;
      state.finished = true;
      return getStats(at);
    }

    return {
      start,
      addPoint,
      pause,
      resume,
      finish,
      reset,
      getStats,
      get state(){ return {...state}; },
      get current(){ return getStats(); }
    };
  }

  const api={distance, calories, accept, createTracker, createSession:createTracker};

  if(typeof module!=='undefined') module.exports=api;
  else root.MoveCore=api;
})(typeof window!=='undefined'?window:globalThis);
