(function(root){
  const rad = n => n * Math.PI / 180;

  function distance(a, b){
    const dlat = rad(b.lat - a.lat);
    const dlon = rad(b.lng - a.lng);
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function calories(met, kg, seconds){
    if(!Number.isFinite(met) || !Number.isFinite(kg) || !Number.isFinite(seconds)) return null;
    if(met <= 0 || kg <= 0 || seconds < 0) return null;
    return met * 3.5 * kg / 200 * seconds / 60;
  }

  function accept(previous, p){
    if(!p || typeof p !== 'object'){
      return { ok: false, reason: '定位資料不存在。', meters: 0, break: false };
    }

    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const t = Number(p.t);
    const accuracy = Number(p.accuracy);

    if(!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t) || !Number.isFinite(accuracy)){
      return { ok: false, reason: '定位資料不完整。', meters: 0, break: false };
    }
    if(Math.abs(lat) > 90 || Math.abs(lng) > 180){
      return { ok: false, reason: '經緯度超出合理範圍。', meters: 0, break: false };
    }
    if(accuracy < 0 || accuracy > 200){
      return { ok: false, reason: 'GPS 精度異常。', meters: 0, break: false };
    }

    if(!previous){
      return { ok: true, reason: '', meters: 0, break: false };
    }

    const previousT = Number(previous.t);
    if(!Number.isFinite(previousT) || previousT < 0 || t <= previousT){
      return { ok: false, reason: '時間資料不合理，已略過。', meters: 0, break: false };
    }

    const diffMs = t - previousT;
    if(diffMs > 30000){
      return { ok: true, reason: '定位間隔超過 30 秒，另起新段。', meters: 0, break: true };
    }

    const meters = distance(previous, p);
    if(!Number.isFinite(meters) || meters < 0){
      return { ok: false, reason: '距離計算失敗。', meters: 0, break: false };
    }
    if(meters > 300){
      return { ok: false, reason: 'GPS 跳動，已略過。', meters: 0, break: false };
    }

    return { ok: true, reason: '', meters, break: false };
  }

  function createTracker(initial = {}){
    const state = {
      kg: Number.isFinite(Number(initial.kg)) ? Number(initial.kg) : null,
      met: Number.isFinite(Number(initial.met)) ? Number(initial.met) : null,
      startedAt: null,
      endAt: null,
      runningSince: null,
      pausedMs: 0,
      totalMeters: 0,
      validPointCount: 0,
      segmentCount: 0,
      firstValidPoint: null,
      lastValidPoint: null,
      lastAcceptedPoint: null,
      maxAdjacentKmh: 0,
      started: false,
      running: false,
      paused: false,
      finished: false
    };

    function sanitizePoint(raw){
      if(!raw || typeof raw !== 'object') return null;
      const lat = Number(raw.lat);
      const lng = Number(raw.lng);
      const t = Number(raw.t);
      const accuracy = Number(raw.accuracy);

      if(!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t) || !Number.isFinite(accuracy)) return null;
      if(Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      if(accuracy < 0 || accuracy > 200) return null;
      return { lat, lng, t, accuracy };
    }

    function getActiveSeconds(now = Date.now()){
      if(!state.startedAt) return 0;
      const end = state.running ? now : (state.endAt ?? state.startedAt);
      const seconds = (end - state.startedAt - state.pausedMs) / 1000;
      return Math.max(0, seconds);
    }

    function getStats(now = Date.now()){
      const activeSeconds = getActiveSeconds(now);
      const totalMeters = state.totalMeters;
      const averageKmh = activeSeconds > 0 ? (totalMeters / activeSeconds) * 3.6 : 0;

      const caloriesKcal =
        Number.isFinite(state.kg) && state.kg > 0 && Number.isFinite(state.met) && state.met > 0
          ? calories(state.met, state.kg, activeSeconds)
          : null;

      let startEndMeters = 0;
      if(state.firstValidPoint && state.lastValidPoint){
        const samePoint =
          Math.abs(state.firstValidPoint.lat - state.lastValidPoint.lat) < 1e-12 &&
          Math.abs(state.firstValidPoint.lng - state.lastValidPoint.lng) < 1e-12;
        startEndMeters = samePoint ? 0 : distance(state.firstValidPoint, state.lastValidPoint);
      }

      return {
        totalMeters,
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
      state.kg = Number.isFinite(Number(initial.kg)) ? Number(initial.kg) : null;
      state.met = Number.isFinite(Number(initial.met)) ? Number(initial.met) : null;
      state.startedAt = null;
      state.endAt = null;
      state.runningSince = null;
      state.pausedMs = 0;
      state.totalMeters = 0;
      state.validPointCount = 0;
      state.segmentCount = 0;
      state.firstValidPoint = null;
      state.lastValidPoint = null;
      state.lastAcceptedPoint = null;
      state.maxAdjacentKmh = 0;
      state.started = false;
      state.running = false;
      state.paused = false;
      state.finished = false;
      return getStats();
    }

    function start(opts = {}){
      const at = Number(opts.at) || Date.now();
      const kg = Number(opts.kg ?? initial.kg ?? state.kg);
      const met = Number(opts.met ?? initial.met ?? state.met);

      if(state.started && !state.finished){
        return getStats(at);
      }

      state.kg = Number.isFinite(kg) ? kg : null;
      state.met = Number.isFinite(met) ? met : null;
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

    function addPoint(rawPoint, now = Date.now()){
      if(!state.started || state.finished || !state.running){
        return getStats(now);
      }

      const point = sanitizePoint(rawPoint);
      if(!point){
        return getStats(now);
      }

      const result = accept(state.lastAcceptedPoint, point);
      if(!result.ok){
        return getStats(now);
      }

      const isFirstValid = state.firstValidPoint === null;
      const isNewSegment = isFirstValid || state.lastAcceptedPoint === null || result.break === true;

      if(isFirstValid){
        state.firstValidPoint = point;
        state.segmentCount = 1;
      } else if(isNewSegment){
        state.segmentCount += 1;
      }

      if(state.lastAcceptedPoint && !result.break){
        const deltaMs = point.t - state.lastAcceptedPoint.t;
        if(deltaMs > 0){
          const meters = Number.isFinite(result.meters) ? result.meters : distance(state.lastAcceptedPoint, point);
          const speedKmh = (meters / (deltaMs / 1000)) * 3.6;
          if(Number.isFinite(speedKmh) && speedKmh > 0 && speedKmh > state.maxAdjacentKmh){
            state.maxAdjacentKmh = speedKmh;
          }
          state.totalMeters += meters;
        }
      }

      state.validPointCount += 1;
      state.lastValidPoint = point;
      state.lastAcceptedPoint = point;
      return getStats(now);
    }

    function pause(at = Date.now()){
      if(!state.started || state.finished || !state.running){
        return getStats(at);
      }

      state.pausedMs += at - (state.runningSince ?? at);
      state.runningSince = null;
      state.running = false;
      state.paused = true;
      state.endAt = at;
      state.lastAcceptedPoint = null;
      return getStats(at);
    }

    function resume(at = Date.now()){
      if(!state.started || state.finished || !state.paused){
        return getStats(at);
      }

      state.runningSince = at;
      state.running = true;
      state.paused = false;
      state.endAt = at;
      state.lastAcceptedPoint = null;
      return getStats(at);
    }

    function finish(at = Date.now()){
      if(!state.started || state.finished){
        return getStats(at);
      }

      state.endAt = at;
      state.runningSince = null;
      state.running = false;
      state.paused = false;
      state.finished = true;
      return getStats(at);
    }

    return {
      state: () => ({ ...state }),
      reset,
      start,
      addPoint,
      pause,
      resume,
      finish,
      getStats,
      get current(){ return getStats(); }
    };
  }

  const api = {
    distance,
    calories,
    accept,
    createTracker,
    createSession: createTracker
  };

  if(typeof module !== 'undefined') module.exports = api;
  else root.MoveCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
