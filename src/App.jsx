import { useState, useEffect, useRef } from "react";
import {
  Play, Pause, RotateCcw, Users, Activity, ClipboardList, User, Check,
  Flag, Flame, Plus, Trash2, Send, ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";
import {
  localGet, localSet, subscribeFeed, addFeedEntry, toggleFeedReaction,
  subscribeAssigned, addAssignedWorkout, markAssignedStatus,
} from "./storage";

// ================= helpers =================
const uid = () => Math.random().toString(36).slice(2, 10);

const fmtTime = (ms) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const secToPace = (sec) => {
  if (!sec || !isFinite(sec) || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const paceToSec = (str) => {
  if (!str) return null;
  const parts = String(str).replace(",", ":").split(":");
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1] || "0", 10);
  if (isNaN(m)) return null;
  return m * 60 + (isNaN(s) ? 0 : s);
};

const speedKmh = (paceSec) => (paceSec && paceSec > 0 ? (3600 / paceSec).toFixed(1) : "--");

const fmtDate = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ================= workout blocks -> flattened steps =================
function blockToSteps(b) {
  if (b.type === "warmup") {
    return [{ id: uid(), kind: "warmup", label: "Aquecimento", metric: b.metric, targetKm: b.metric === "distance" ? b.value : null, targetSec: b.metric === "time" ? b.value * 60 : null, paceMin: b.paceOn ? paceToSec(b.paceMin) : null, paceMax: b.paceOn ? paceToSec(b.paceMax) : null }];
  }
  if (b.type === "pace") {
    return [{ id: uid(), kind: "pace", label: "Ritmo alvo", metric: b.metric, targetKm: b.metric === "distance" ? b.value : null, targetSec: b.metric === "time" ? b.value * 60 : null, paceMin: paceToSec(b.paceMin), paceMax: paceToSec(b.paceMax) }];
  }
  if (b.type === "cooldown") {
    return [{ id: uid(), kind: "cooldown", label: "Resfriamento", metric: b.metric, targetKm: b.metric === "distance" ? b.value : null, targetSec: b.metric === "time" ? b.value * 60 : null, paceMin: null, paceMax: null }];
  }
  if (b.type === "custom") {
    return [{ id: uid(), kind: "custom", label: b.label || "Bloco livre", metric: b.metric || "open", targetKm: b.metric === "distance" ? b.value : null, targetSec: b.metric === "time" ? b.value * 60 : null, paceMin: b.paceOn ? paceToSec(b.paceMin) : null, paceMax: b.paceOn ? paceToSec(b.paceMax) : null }];
  }
  if (b.type === "interval") {
    const steps = [];
    for (let i = 1; i <= b.repeats; i++) {
      steps.push({
        id: uid(), kind: "work", label: `Tiro ${i}/${b.repeats}`,
        metric: b.workMetric, targetKm: b.workMetric === "distance" ? b.workValue : null,
        targetSec: b.workMetric === "time" ? b.workValue * 60 : null,
        paceMin: paceToSec(b.workPaceMin), paceMax: paceToSec(b.workPaceMax),
      });
      if (i < b.repeats || b.restAfterLast) {
        steps.push({
          id: uid(), kind: "rest", label: `Descanso ${i}/${b.repeats}`,
          metric: b.restMetric, targetKm: b.restMetric === "distance" ? b.restValue : null,
          targetSec: b.restMetric === "time" ? b.restValue * 60 : null,
          paceMin: b.restPaceOn ? paceToSec(b.restPaceMin) : null,
          paceMax: b.restPaceOn ? paceToSec(b.restPaceMax) : null,
        });
      }
    }
    return steps;
  }
  return [];
}

function blockSummary(b) {
  if (b.type === "warmup") return `Aquecimento — ${b.metric === "distance" ? b.value + " km" : b.value + " min"}${b.paceOn ? ` @ ${b.paceMin}-${b.paceMax}/km` : ""}`;
  if (b.type === "pace") return `Ritmo alvo — ${b.metric === "distance" ? b.value + " km" : b.value + " min"} @ ${b.paceMin}-${b.paceMax}/km`;
  if (b.type === "cooldown") return `Resfriamento — ${b.metric === "distance" ? b.value + " km" : b.value + " min"}`;
  if (b.type === "custom") return `${b.label || "Bloco livre"}${b.value ? ` — ${b.value}${b.metric === "distance" ? " km" : " min"}` : ""}`;
  if (b.type === "interval") {
    const w = `${b.workValue}${b.workMetric === "distance" ? "km" : "min"} @ ${b.workPaceMin}-${b.workPaceMax}/km`;
    const r = `desc ${b.restValue}${b.restMetric === "distance" ? "km" : "min"}${b.restPaceOn ? ` @ ${b.restPaceMin}-${b.restPaceMax}/km` : " livre"}`;
    return `Intervalado ${b.repeats}x — ${w} / ${r}`;
  }
  return "";
}

// ================= long-term plan generator =================
const GOALS = {
  "5k": { label: "5 km", longStart: 3, longPeak: 6 },
  "10k": { label: "10 km", longStart: 5, longPeak: 12 },
  "21k": { label: "21 km (meia)", longStart: 8, longPeak: 19 },
};

function generatePlan(goalKey, level, weeks) {
  const g = GOALS[goalKey];
  const levelMult = level === "iniciante" ? 0.85 : 1.15;
  const plan = [];
  for (let w = 1; w <= weeks; w++) {
    const progress = (w - 1) / Math.max(weeks - 1, 1);
    const isRecoveryWeek = w % 4 === 0 && w !== weeks;
    let longRun = g.longStart + (g.longPeak - g.longStart) * progress;
    if (isRecoveryWeek) longRun *= 0.7;
    longRun = Math.round(longRun * levelMult * 10) / 10;
    const intervalReps = Math.min(4 + Math.floor(w / 2), level === "iniciante" ? 8 : 12);
    const easyKm = Math.max(3, Math.round(longRun * 0.5));
    const tempoKm = Math.max(2, Math.round(longRun * 0.4));
    plan.push({
      week: w, recovery: isRecoveryWeek,
      sessions: [
        { day: "Seg", desc: "Descanso ou mobilidade" },
        { day: "Ter", desc: `Intervalado: ${intervalReps}x400m forte, 200m trote` },
        { day: "Qua", desc: `Corrida leve — ${easyKm} km` },
        { day: "Qui", desc: "Descanso ou cross-training" },
        { day: "Sex", desc: `Ritmo — ${tempoKm} km em ritmo de prova` },
        { day: "Sáb", desc: "Descanso" },
        { day: "Dom", desc: `Longão — ${longRun} km` },
      ],
    });
  }
  return plan;
}

// ================= root component =================
// personal (localStorage): pipito-profile | pipito-runs | pipito-my-workouts
// shared (Firestore):      feedEntries collection | assignedWorkouts collection

export default function PipitoRun() {
  const [profile, setProfile] = useState(() => localGet("pipito-profile", null));
  const [nameInput, setNameInput] = useState("");
  const [tab, setTab] = useState("corrida");

  const [runs, setRuns] = useState(() => localGet("pipito-runs", []));
  const [myWorkouts, setMyWorkouts] = useState(() => localGet("pipito-my-workouts", []));
  const [feed, setFeed] = useState([]);
  const [assigned, setAssigned] = useState([]);

  useEffect(() => {
    const unsubFeed = subscribeFeed(setFeed);
    const unsubAssigned = subscribeAssigned(setAssigned);
    return () => { unsubFeed(); unsubAssigned(); };
  }, []);

  const saveProfile = (name) => {
    const p = { name };
    setProfile(p);
    localSet("pipito-profile", p);
  };
  const persistRuns = (next) => { setRuns(next); localSet("pipito-runs", next); };
  const persistMyWorkouts = (next) => { setMyWorkouts(next); localSet("pipito-my-workouts", next); };

  const [activeWorkout, setActiveWorkout] = useState(null);

  if (!profile) {
    return (
      <Shell>
        <div style={S.onboardWrap}>
          <div style={S.brandMark}>PIPITO RUN</div>
          <p style={S.onboardSub}>Treinos, plano e pace — com a turma.</p>
          <input style={S.input} placeholder="Como podemos te chamar?" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
          <button style={{ ...S.btnPrimary, marginTop: 14, opacity: nameInput.trim() ? 1 : 0.5 }} disabled={!nameInput.trim()} onClick={() => saveProfile(nameInput.trim())}>Começar</button>
          <p style={S.tinyNote}>Seu nome e seus treinos ficam visíveis para o grupo — como um mural.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <header style={S.header}>
        <div style={S.brandMark}>PIPITO RUN</div>
        <div style={S.headerRight}><User size={14} color={T.muted} /><span style={S.headerName}>{profile.name}</span></div>
      </header>

      <main style={S.main}>
        {tab === "corrida" && (
          <CorridaTab
            profile={profile} myWorkouts={myWorkouts} assigned={assigned}
            activeWorkout={activeWorkout} setActiveWorkout={setActiveWorkout}
            onFinish={async (run) => {
              persistRuns([run, ...runs]);
              if (run.distance > 0) {
                const entry = { name: profile.name, date: run.date, distance: run.distance, timeMs: run.timeMs, pace: run.pace, reactions: [] };
                try { await addFeedEntry(entry); } catch (e) { console.error("feed", e); }
              }
              if (activeWorkout?.assignedId) {
                try { await markAssignedStatus(activeWorkout.assignedId, "concluido"); } catch (e) { console.error("assigned", e); }
              }
              setActiveWorkout(null);
              setTab("treinos");
            }}
          />
        )}
        {tab === "treinos" && <TreinosTab runs={runs} />}
        {tab === "montar" && (
          <MontarTab
            profile={profile} myWorkouts={myWorkouts}
            onSave={(w) => persistMyWorkouts([w, ...myWorkouts])}
            onDelete={(id) => persistMyWorkouts(myWorkouts.filter((w) => w.id !== id))}
            onAssign={async (w, forName) => {
              const entry = { workout: w, forName, fromName: profile.name, createdAt: new Date().toISOString(), status: "pendente" };
              try { await addAssignedWorkout(entry); } catch (e) { console.error("assign", e); }
            }}
            onFollow={(w) => { setActiveWorkout(w); setTab("corrida"); }}
          />
        )}
        {tab === "grupo" && (
          <GrupoTab
            feed={feed} me={profile.name} assigned={assigned}
            onReact={async (id) => {
              const entry = feed.find((f) => f.id === id);
              const reacted = entry?.reactions?.includes(profile.name);
              try { await toggleFeedReaction(id, profile.name, reacted); } catch (e) { console.error("react", e); }
            }}
            onFollowAssigned={(a) => { setActiveWorkout({ ...a.workout, assignedId: a.id }); setTab("corrida"); }}
          />
        )}
      </main>

      <nav style={S.tabbar}>
        <TabBtn active={tab === "corrida"} onClick={() => setTab("corrida")} icon={<Flag size={18} />} label="Corrida" />
        <TabBtn active={tab === "treinos"} onClick={() => setTab("treinos")} icon={<Activity size={18} />} label="Treinos" />
        <TabBtn active={tab === "montar"} onClick={() => setTab("montar")} icon={<ClipboardList size={18} />} label="Montar" />
        <TabBtn active={tab === "grupo"} onClick={() => setTab("grupo")} icon={<Users size={18} />} label="Grupo" />
      </nav>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={S.appShell}>
      <style>{FONTS}</style>
      {children}
    </div>
  );
}

// ================= CORRIDA (live tracking + workout execution) =================
const PACE_WINDOW_MS = 25000;

function CorridaTab({ profile, myWorkouts, assigned, activeWorkout, setActiveWorkout, onFinish }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const rafRef = useRef(null);

  const [distance, setDistance] = useState(0); // km
  const [splits, setSplits] = useState([{ t: 0, d: 0 }]);
  const [gpsMode, setGpsMode] = useState("unrequested"); // unrequested | checking | gps | manual | denied
  const watchIdRef = useRef(null);
  const lastCoordRef = useRef(null);
  const runningRef = useRef(false);
  runningRef.current = running;

  const [stepIdx, setStepIdx] = useState(0);
  const [stepStart, setStepStart] = useState({ t: 0, d: 0 });
  const [actualSteps, setActualSteps] = useState([]);
  const lastVibeRef = useRef(0);
  const outOfRangeRef = useRef(false);

  const [finishOpen, setFinishOpen] = useState(false);
  const [pendingPicker, setPendingPicker] = useState(false);
  const wakeLockRef = useRef(null);

  const requestWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch (e) {}
  };
  const releaseWakeLock = async () => {
    try { await wakeLockRef.current?.release(); wakeLockRef.current = null; } catch (e) {}
  };

  useEffect(() => {
    if (running) requestWakeLock(); else releaseWakeLock();
  }, [running]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && running) requestWakeLock(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [running]);

  useEffect(() => () => { releaseWakeLock(); }, []);

  const steps = activeWorkout?.steps || [];
  const currentStep = steps[stepIdx];
  const started = elapsed > 0 || running;

  useEffect(() => {
    if (!running) return;
    const tick = () => { setElapsed(Date.now() - startedAt); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, startedAt]);

  useEffect(() => {
    if (!running || watchIdRef.current) return;
    if (!navigator.geolocation || gpsMode === "manual" || gpsMode === "denied") return;
    let gotFirst = false;
    const to = setTimeout(() => { if (!gotFirst) setGpsMode("manual"); }, 10000);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        gotFirst = true; clearTimeout(to); setGpsMode("gps");
        const { latitude, longitude, accuracy } = pos.coords;
        if (accuracy && accuracy > 40) return;
        if (lastCoordRef.current && runningRef.current) {
          const dKm = haversineKm(lastCoordRef.current.lat, lastCoordRef.current.lon, latitude, longitude);
          const dtSec = (Date.now() - lastCoordRef.current.t) / 1000;
          const kmh = dtSec > 0 ? (dKm / dtSec) * 3600 : 0;
          if (kmh < 30 && dKm > 0.001) {
            setDistance((d) => {
              const nd = d + dKm;
              setSplits((sp) => [...sp, { t: Date.now() - startedAtRefSafe(startedAt), d: nd }]);
              return nd;
            });
          }
        }
        lastCoordRef.current = { lat: latitude, lon: longitude, t: Date.now() };
      },
      () => { setGpsMode("manual"); clearTimeout(to); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
    );
    return () => {};
  }, [running]);

  useEffect(() => () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); }, []);

  function startedAtRefSafe(s) { return s || Date.now(); }

  const primeGps = () => {
    if (!navigator.geolocation) { setGpsMode("manual"); return; }
    setGpsMode("checking");
    navigator.geolocation.getCurrentPosition(
      () => setGpsMode("gps"),
      (err) => setGpsMode(err.code === 1 ? "denied" : "manual"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const addManual = (km) => {
    const nd = distance + km;
    setDistance(nd);
    setSplits((sp) => [...sp, { t: elapsed, d: nd }]);
  };

  const cutoff = elapsed - PACE_WINDOW_MS;
  const windowSplits = splits.filter((s) => s.t >= cutoff);
  let currentPaceSec = null;
  if (windowSplits.length >= 1 && splits.length >= 2) {
    const a = windowSplits[0], b = splits[splits.length - 1];
    const dt = (b.t - a.t) / 1000, dd = b.d - a.d;
    if (dt > 2 && dd > 0.005) currentPaceSec = dt / dd;
  }
  const avgPaceSec = distance > 0.01 ? elapsed / 1000 / distance : null;
  const displayPaceSec = currentPaceSec || avgPaceSec;

  useEffect(() => {
    if (!running || !activeWorkout || !currentStep) return;
    const stepElapsedMs = elapsed - stepStart.t;
    const stepDistKm = distance - stepStart.d;
    const done =
      (currentStep.metric === "time" && stepElapsedMs >= currentStep.targetSec * 1000) ||
      (currentStep.metric === "distance" && stepDistKm >= currentStep.targetKm);
    if (done) { advanceStep(); return; }

    if (currentStep.paceMin && currentStep.paceMax && displayPaceSec) {
      const out = displayPaceSec > currentStep.paceMax || displayPaceSec < currentStep.paceMin;
      const now = Date.now();
      if (out && (!outOfRangeRef.current || now - lastVibeRef.current > 20000)) {
        if (navigator.vibrate) navigator.vibrate(displayPaceSec > currentStep.paceMax ? [250] : [80, 60, 80]);
        lastVibeRef.current = now;
      }
      outOfRangeRef.current = out;
    }
  }, [elapsed]);

  function advanceStep() {
    const stepDistKm = distance - stepStart.d;
    const stepTimeMs = elapsed - stepStart.t;
    setActualSteps((as) => [...as, {
      label: currentStep.label, targetKm: currentStep.targetKm, targetSec: currentStep.targetSec,
      paceMin: currentStep.paceMin, paceMax: currentStep.paceMax,
      actualKm: Math.round(stepDistKm * 100) / 100, actualMs: stepTimeMs,
      actualPaceSec: stepDistKm > 0.01 ? stepTimeMs / 1000 / stepDistKm : null,
    }]);
    if (stepIdx + 1 >= steps.length) {
      finishRun();
    } else {
      setStepIdx((i) => i + 1);
      setStepStart({ t: elapsed, d: distance });
    }
  }

  const startTimer = () => { setStartedAt(Date.now() - elapsed); setRunning(true); };
  const pauseTimer = () => setRunning(false);
  const resetAll = () => {
    setRunning(false); setElapsed(0); setStartedAt(null); setDistance(0);
    setSplits([{ t: 0, d: 0 }]); setStepIdx(0); setStepStart({ t: 0, d: 0 }); setActualSteps([]);
    setGpsMode("unrequested"); lastCoordRef.current = null;
    if (watchIdRef.current) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
    setActiveWorkout(null);
  };

  const finishRun = () => { setRunning(false); setFinishOpen(true); };

  const confirmFinish = (manualKm) => {
    const finalDist = manualKm != null ? parseFloat(manualKm) : distance;
    const run = {
      id: uid(), date: new Date().toISOString(), distance: Math.round(finalDist * 100) / 100,
      timeMs: elapsed, pace: secToPace(avgPaceSec) + "/km",
      workoutName: activeWorkout?.name || null,
      steps: activeWorkout ? steps : null,
      actualSteps: activeWorkout ? actualSteps : null,
    };
    setFinishOpen(false);
    onFinish(run);
  };

  const availableToFollow = [
    ...myWorkouts.map((w) => ({ ...w, source: "meu" })),
    ...assigned.filter((a) => a.forName === profile.name && a.status === "pendente").map((a) => ({ ...a.workout, assignedId: a.id, source: "amigo", fromName: a.fromName })),
  ];

  return (
    <div style={S.tabPad}>
      {!started && (
        <button style={S.pickerToggle} onClick={() => setPendingPicker((v) => !v)}>
          {activeWorkout ? `Seguindo: ${activeWorkout.name}` : "Corrida livre (sem plano)"}
          {pendingPicker ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      )}
      {!started && pendingPicker && (
        <div style={S.pickerList}>
          <button style={S.pickerItem} onClick={() => { setActiveWorkout(null); setPendingPicker(false); }}>Corrida livre</button>
          {availableToFollow.map((w, i) => (
            <button key={i} style={S.pickerItem} onClick={() => { setActiveWorkout(w); setPendingPicker(false); }}>
              {w.name} {w.source === "amigo" ? `— de ${w.fromName}` : ""}
            </button>
          ))}
          {availableToFollow.length === 0 && <div style={S.pickerEmpty}>Nenhum treino montado ainda. Crie um na aba Montar.</div>}
        </div>
      )}

      {!started && gpsMode !== "gps" && (
        <div style={S.gpsPrompt}>
          <button style={S.btnGhostFull} onClick={primeGps}>
            {gpsMode === "checking" ? "Verificando localização…" : "Ativar GPS"}
          </button>
          {gpsMode === "denied" && <div style={S.gpsWarn}>Permissão de localização negada pelo navegador. O treino vai usar registro manual de distância.</div>}
          {gpsMode === "manual" && <div style={S.gpsWarn}>GPS indisponível aqui — o treino vai usar registro manual de distância.</div>}
          {gpsMode === "unrequested" && <div style={S.gpsHint}>Toque para permitir que o app use sua localização durante a corrida.</div>}
        </div>
      )}

      <div style={S.laneCard}>
        <div style={S.laneNumber}>{gpsMode === "gps" ? "GPS ATIVO" : gpsMode === "manual" || gpsMode === "denied" ? "MODO MANUAL" : "PISTA 1"}</div>
        <div style={S.stopwatch}>{fmtTime(elapsed)}</div>

        <div style={S.metricGrid}>
          <Metric label="distância" value={`${distance.toFixed(2)} km`} />
          <Metric label="ritmo médio" value={avgPaceSec ? `${secToPace(avgPaceSec)}/km` : "--:--"} />
          <Metric label="ritmo atual" value={displayPaceSec ? `${secToPace(displayPaceSec)}/km` : "--:--"} accent />
          <Metric label="velocidade" value={`${speedKmh(displayPaceSec)} km/h`} />
        </div>

        {(gpsMode === "manual" || gpsMode === "denied") && running && (
          <div style={S.manualRow}>
            <button style={S.manualBtn} onClick={() => addManual(0.05)}>+50m</button>
            <button style={S.manualBtn} onClick={() => addManual(0.1)}>+100m</button>
            <button style={S.manualBtn} onClick={() => addManual(0.5)}>+500m</button>
          </div>
        )}

        {activeWorkout && currentStep && (
          <div style={S.stepCard}>
            <div style={S.stepLabel}>{currentStep.label}</div>
            <div style={S.stepTarget}>
              {currentStep.metric === "distance" && `${(distance - stepStart.d).toFixed(2)} / ${currentStep.targetKm} km`}
              {currentStep.metric === "time" && `${fmtTime(elapsed - stepStart.t)} / ${fmtTime(currentStep.targetSec * 1000)}`}
              {currentStep.metric === "open" && "sem alvo — avance manualmente"}
            </div>
            {currentStep.paceMin && currentStep.paceMax && (
              <div style={S.stepPace}>alvo: {secToPace(currentStep.paceMin)}–{secToPace(currentStep.paceMax)}/km</div>
            )}
            {currentStep.metric === "open" && running && (
              <button style={S.nextStepBtn} onClick={advanceStep}>Próximo bloco</button>
            )}
          </div>
        )}

        <div style={S.timerControls}>
          {!running ? (
            <button style={S.circleBtnAccent} onClick={startTimer}><Play size={22} color={T.bg} fill={T.bg} /></button>
          ) : (
            <button style={S.circleBtnAccent} onClick={pauseTimer}><Pause size={22} color={T.bg} fill={T.bg} /></button>
          )}
          <button style={S.circleBtn} onClick={resetAll}><RotateCcw size={18} color={T.text} /></button>
          <button style={S.circleBtnOrange} onClick={finishRun} disabled={elapsed === 0}><Check size={20} color={T.text} /></button>
        </div>
        <div style={S.timerHint}>iniciar · pausar · zerar · concluir</div>
      </div>

      {finishOpen && <FinishModal gpsMode={gpsMode === "denied" ? "manual" : gpsMode} distance={distance} onConfirm={confirmFinish} onCancel={() => setFinishOpen(false)} />}
    </div>
  );
}

function FinishModal({ gpsMode, distance, onConfirm, onCancel }) {
  const [km, setKm] = useState(distance ? distance.toFixed(2) : "");
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <div style={S.modalTitle}>{gpsMode === "manual" ? "Confirme a distância final" : "Concluir treino"}</div>
        {gpsMode === "manual" ? (
          <input style={S.input} placeholder="ex: 5.2" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} autoFocus />
        ) : (
          <div style={S.modalDist}>{distance.toFixed(2)} km registrados</div>
        )}
        <div style={S.modalRow}>
          <button style={S.btnGhost} onClick={onCancel}>Cancelar</button>
          <button style={S.btnPrimary} onClick={() => onConfirm(gpsMode === "manual" ? km : null)}>Salvar treino</button>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div style={S.metricBox}>
      <div style={{ ...S.metricValue, color: accent ? T.accent : T.text }}>{value}</div>
      <div style={S.metricLabel}>{label}</div>
    </div>
  );
}

// ================= TREINOS (histórico + comparação) =================
function TreinosTab({ runs }) {
  const [openId, setOpenId] = useState(null);
  const totalKm = runs.reduce((a, r) => a + (r.distance || 0), 0);
  return (
    <div style={S.tabPad}>
      <div style={S.statRow}>
        <div style={S.statBox}><div style={S.statNum}>{totalKm.toFixed(1)}</div><div style={S.statLabel}>km totais</div></div>
        <div style={S.statBox}><div style={S.statNum}>{runs.length}</div><div style={S.statLabel}>treinos</div></div>
      </div>
      {runs.length === 0 ? (
        <div style={S.emptyState}>Nenhum treino salvo ainda. Bata o cronômetro na aba Corrida.</div>
      ) : (
        <div style={S.list}>
          {runs.map((r) => (
            <div key={r.id}>
              <div style={S.runRow} onClick={() => r.actualSteps && setOpenId(openId === r.id ? null : r.id)}>
                <div style={S.runDate}>{fmtDate(r.date)}</div>
                <div style={S.runMid}>
                  <div style={S.runDist}>{r.distance} km {r.workoutName ? `· ${r.workoutName}` : ""}</div>
                  <div style={S.runPace}>{r.pace}</div>
                </div>
                <div style={S.runTime}>{fmtTime(r.timeMs)}</div>
                {r.actualSteps && (openId === r.id ? <ChevronUp size={16} color={T.muted} /> : <ChevronDown size={16} color={T.muted} />)}
              </div>
              {openId === r.id && r.actualSteps && (
                <div style={S.compareBox}>
                  {r.actualSteps.map((s, i) => {
                    const inRange = s.paceMin && s.actualPaceSec ? (s.actualPaceSec >= s.paceMin && s.actualPaceSec <= s.paceMax) : true;
                    return (
                      <div key={i} style={S.compareRow}>
                        <div style={S.compareLabel}>{s.label}</div>
                        <div style={S.compareCols}>
                          <span style={S.compareCol}>previsto: {s.targetKm ? `${s.targetKm}km` : s.targetSec ? fmtTime(s.targetSec * 1000) : "livre"}{s.paceMin ? ` @ ${secToPace(s.paceMin)}-${secToPace(s.paceMax)}` : ""}</span>
                          <span style={S.compareCol}>real: {s.actualKm}km em {fmtTime(s.actualMs)} ({s.actualPaceSec ? secToPace(s.actualPaceSec) : "--:--"}/km)</span>
                        </div>
                        {s.paceMin && (inRange ? <Check size={15} color={T.accent} /> : <AlertTriangle size={15} color={T.accent2} />)}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ================= MONTAR (builder + plano longo) =================
function MontarTab({ profile, myWorkouts, onSave, onDelete, onAssign, onFollow }) {
  const [sub, setSub] = useState("unico");
  return (
    <div style={S.tabPad}>
      <div style={S.chipRow}>
        <Chip active={sub === "unico"} onClick={() => setSub("unico")} label="Treino único" />
        <Chip active={sub === "plano"} onClick={() => setSub("plano")} label="Plano de semanas" />
      </div>
      <div style={{ height: 16 }} />
      {sub === "unico" ? (
        <WorkoutBuilder myWorkouts={myWorkouts} onSave={onSave} onDelete={onDelete} onAssign={onAssign} onFollow={onFollow} />
      ) : (
        <PlanoLongo />
      )}
    </div>
  );
}

const BLOCK_TYPES = [
  { key: "warmup", label: "Aquecimento" },
  { key: "pace", label: "Ritmo alvo" },
  { key: "interval", label: "Intervalado" },
  { key: "cooldown", label: "Descanso/Resfr." },
  { key: "custom", label: "Livre" },
];

function emptyBlock(type) {
  const base = { id: uid(), type };
  if (type === "warmup") return { ...base, metric: "time", value: 10, paceOn: false, paceMin: "", paceMax: "" };
  if (type === "pace") return { ...base, metric: "distance", value: 3, paceMin: "5:30", paceMax: "5:45" };
  if (type === "cooldown") return { ...base, metric: "time", value: 5 };
  if (type === "custom") return { ...base, label: "", metric: "distance", value: 1, paceOn: false, paceMin: "", paceMax: "" };
  if (type === "interval") return { ...base, repeats: 6, workMetric: "distance", workValue: 0.4, workPaceMin: "4:30", workPaceMax: "4:45", restMetric: "distance", restValue: 0.2, restPaceOn: false, restPaceMin: "", restPaceMax: "", restAfterLast: false };
  return base;
}

function WorkoutBuilder({ myWorkouts, onSave, onDelete, onAssign, onFollow }) {
  const [workoutName, setWorkoutName] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [pickType, setPickType] = useState("warmup");
  const [draft, setDraft] = useState(emptyBlock("warmup"));
  const [assignName, setAssignName] = useState({});

  const changePickType = (t) => { setPickType(t); setDraft(emptyBlock(t)); };
  const addBlock = () => { setBlocks([...blocks, draft]); setDraft(emptyBlock(pickType)); };
  const removeBlock = (id) => setBlocks(blocks.filter((b) => b.id !== id));

  const saveWorkout = () => {
    if (!workoutName.trim() || blocks.length === 0) return;
    const steps = blocks.flatMap(blockToSteps);
    onSave({ id: uid(), name: workoutName.trim(), createdBy: "me", blocks, steps, createdAt: new Date().toISOString() });
    setWorkoutName(""); setBlocks([]);
  };

  return (
    <div>
      <div style={S.formGroup}>
        <div style={S.formLabel}>Nome do treino</div>
        <input style={S.input} placeholder="ex: Tiros de 400m" value={workoutName} onChange={(e) => setWorkoutName(e.target.value)} />
      </div>

      {blocks.length > 0 && (
        <div style={{ ...S.list, marginBottom: 16 }}>
          {blocks.map((b) => (
            <div key={b.id} style={S.blockRow}>
              <div style={S.blockText}>{blockSummary(b)}</div>
              <button style={S.iconBtn} onClick={() => removeBlock(b.id)}><Trash2 size={15} color={T.muted} /></button>
            </div>
          ))}
        </div>
      )}

      <div style={S.formGroup}>
        <div style={S.formLabel}>Adicionar bloco</div>
        <div style={S.chipRow}>
          {BLOCK_TYPES.map((t) => <Chip key={t.key} active={pickType === t.key} onClick={() => changePickType(t.key)} label={t.label} />)}
        </div>
      </div>

      <BlockForm draft={draft} setDraft={setDraft} />
      <button style={S.btnGhostFull} onClick={addBlock}><Plus size={15} /> Adicionar bloco</button>

      <div style={{ height: 16 }} />
      <button style={{ ...S.btnPrimary, opacity: workoutName.trim() && blocks.length ? 1 : 0.5 }} disabled={!workoutName.trim() || !blocks.length} onClick={saveWorkout}>
        Salvar treino
      </button>

      {myWorkouts.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={S.formLabel}>Meus treinos</div>
          <div style={S.list}>
            {myWorkouts.map((w) => (
              <div key={w.id} style={S.workoutCard}>
                <div style={S.workoutName}>{w.name}</div>
                <div style={S.workoutSteps}>{w.blocks.map(blockSummary).join(" · ")}</div>
                <div style={S.workoutActions}>
                  <button style={S.smallBtnAccent} onClick={() => onFollow(w)}>Seguir</button>
                  <input style={S.smallInput} placeholder="nome do amigo" value={assignName[w.id] || ""} onChange={(e) => setAssignName({ ...assignName, [w.id]: e.target.value })} />
                  <button style={S.smallBtn} onClick={() => assignName[w.id]?.trim() && onAssign(w, assignName[w.id].trim())}><Send size={13} /></button>
                  <button style={S.iconBtn} onClick={() => onDelete(w.id)}><Trash2 size={15} color={T.muted} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockForm({ draft, setDraft }) {
  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const MetricToggle = ({ value, onChange }) => (
    <div style={S.chipRow}>
      <Chip active={value === "distance"} onClick={() => onChange("distance")} label="Distância" />
      <Chip active={value === "time"} onClick={() => onChange("time")} label="Tempo" />
    </div>
  );

  if (draft.type === "warmup" || draft.type === "cooldown") {
    return (
      <div style={S.blockForm}>
        <MetricToggle value={draft.metric} onChange={(v) => set("metric", v)} />
        <input style={S.input} type="number" placeholder={draft.metric === "distance" ? "km" : "minutos"} value={draft.value} onChange={(e) => set("value", parseFloat(e.target.value) || 0)} />
        {draft.type === "warmup" && (
          <>
            <label style={S.checkboxLabel}><input type="checkbox" checked={draft.paceOn} onChange={(e) => set("paceOn", e.target.checked)} /> definir ritmo alvo</label>
            {draft.paceOn && (
              <div style={S.paceRow}>
                <input style={S.smallInput} placeholder="mín m:ss" value={draft.paceMin} onChange={(e) => set("paceMin", e.target.value)} />
                <input style={S.smallInput} placeholder="máx m:ss" value={draft.paceMax} onChange={(e) => set("paceMax", e.target.value)} />
              </div>
            )}
          </>
        )}
      </div>
    );
  }
  if (draft.type === "pace") {
    return (
      <div style={S.blockForm}>
        <MetricToggle value={draft.metric} onChange={(v) => set("metric", v)} />
        <input style={S.input} type="number" placeholder={draft.metric === "distance" ? "km" : "minutos"} value={draft.value} onChange={(e) => set("value", parseFloat(e.target.value) || 0)} />
        <div style={S.paceRow}>
          <input style={S.smallInput} placeholder="mín m:ss" value={draft.paceMin} onChange={(e) => set("paceMin", e.target.value)} />
          <input style={S.smallInput} placeholder="máx m:ss" value={draft.paceMax} onChange={(e) => set("paceMax", e.target.value)} />
        </div>
      </div>
    );
  }
  if (draft.type === "custom") {
    return (
      <div style={S.blockForm}>
        <input style={S.input} placeholder="nome do bloco" value={draft.label} onChange={(e) => set("label", e.target.value)} />
        <MetricToggle value={draft.metric} onChange={(v) => set("metric", v)} />
        <input style={S.input} type="number" placeholder={draft.metric === "distance" ? "km" : "minutos"} value={draft.value} onChange={(e) => set("value", parseFloat(e.target.value) || 0)} />
        <label style={S.checkboxLabel}><input type="checkbox" checked={draft.paceOn} onChange={(e) => set("paceOn", e.target.checked)} /> definir ritmo alvo</label>
        {draft.paceOn && (
          <div style={S.paceRow}>
            <input style={S.smallInput} placeholder="mín m:ss" value={draft.paceMin} onChange={(e) => set("paceMin", e.target.value)} />
            <input style={S.smallInput} placeholder="máx m:ss" value={draft.paceMax} onChange={(e) => set("paceMax", e.target.value)} />
          </div>
        )}
      </div>
    );
  }
  if (draft.type === "interval") {
    return (
      <div style={S.blockForm}>
        <input style={S.input} type="number" placeholder="repetições" value={draft.repeats} onChange={(e) => set("repeats", parseInt(e.target.value) || 1)} />
        <div style={S.formLabelSmall}>Tiro</div>
        <MetricToggle value={draft.workMetric} onChange={(v) => set("workMetric", v)} />
        <input style={S.input} type="number" placeholder={draft.workMetric === "distance" ? "km" : "minutos"} value={draft.workValue} onChange={(e) => set("workValue", parseFloat(e.target.value) || 0)} />
        <div style={S.paceRow}>
          <input style={S.smallInput} placeholder="mín m:ss" value={draft.workPaceMin} onChange={(e) => set("workPaceMin", e.target.value)} />
          <input style={S.smallInput} placeholder="máx m:ss" value={draft.workPaceMax} onChange={(e) => set("workPaceMax", e.target.value)} />
        </div>
        <div style={S.formLabelSmall}>Descanso</div>
        <MetricToggle value={draft.restMetric} onChange={(v) => set("restMetric", v)} />
        <input style={S.input} type="number" placeholder={draft.restMetric === "distance" ? "km" : "minutos"} value={draft.restValue} onChange={(e) => set("restValue", parseFloat(e.target.value) || 0)} />
        <label style={S.checkboxLabel}><input type="checkbox" checked={draft.restPaceOn} onChange={(e) => set("restPaceOn", e.target.checked)} /> definir ritmo do descanso</label>
        {draft.restPaceOn && (
          <div style={S.paceRow}>
            <input style={S.smallInput} placeholder="mín m:ss" value={draft.restPaceMin} onChange={(e) => set("restPaceMin", e.target.value)} />
            <input style={S.smallInput} placeholder="máx m:ss" value={draft.restPaceMax} onChange={(e) => set("restPaceMax", e.target.value)} />
          </div>
        )}
      </div>
    );
  }
  return null;
}

function PlanoLongo() {
  const [goalKey, setGoalKey] = useState("5k");
  const [level, setLevel] = useState("iniciante");
  const [weeks, setWeeks] = useState(8);
  const [plan, setPlan] = useState(null);
  return (
    <div>
      <div style={S.formGroup}>
        <div style={S.formLabel}>Objetivo</div>
        <div style={S.chipRow}>{Object.entries(GOALS).map(([k, g]) => <Chip key={k} active={goalKey === k} onClick={() => setGoalKey(k)} label={g.label} />)}</div>
      </div>
      <div style={S.formGroup}>
        <div style={S.formLabel}>Nível</div>
        <div style={S.chipRow}>
          <Chip active={level === "iniciante"} onClick={() => setLevel("iniciante")} label="Iniciante" />
          <Chip active={level === "intermediario"} onClick={() => setLevel("intermediario")} label="Intermediário" />
        </div>
      </div>
      <div style={S.formGroup}>
        <div style={S.formLabel}>Duração: {weeks} semanas</div>
        <input type="range" min={6} max={16} value={weeks} onChange={(e) => setWeeks(parseInt(e.target.value))} style={S.slider} />
      </div>
      <button style={S.btnPrimary} onClick={() => setPlan(generatePlan(goalKey, level, weeks))}>Gerar plano</button>
      {plan && (
        <div style={S.planList}>
          {plan.map((w) => (
            <div key={w.week} style={S.weekCard}>
              <div style={S.weekHeader}><span>SEMANA {w.week}</span>{w.recovery && <span style={S.recoveryTag}>recuperação</span>}</div>
              {w.sessions.map((s, i) => <div key={i} style={S.sessionRow}><span style={S.sessionDay}>{s.day}</span><span style={S.sessionDesc}>{s.desc}</span></div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ================= GRUPO (feed + treinos recebidos) =================
const LANE_COLORS = ["#C9F26C", "#FF6B35", "#6CC9F2", "#F2C96C", "#C96CF2"];

function GrupoTab({ feed, me, assigned, onReact, onFollowAssigned }) {
  const myAssigned = assigned.filter((a) => a.forName === me && a.status === "pendente");
  return (
    <div style={S.tabPad}>
      {myAssigned.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={S.formLabel}>Treinos recebidos</div>
          <div style={S.list}>
            {myAssigned.map((a) => (
              <div key={a.id} style={S.workoutCard}>
                <div style={S.workoutName}>{a.workout.name} <span style={S.fromTag}>de {a.fromName}</span></div>
                <div style={S.workoutSteps}>{a.workout.blocks?.map(blockSummary).join(" · ")}</div>
                <button style={S.smallBtnAccent} onClick={() => onFollowAssigned(a)}>Seguir agora</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={S.feedNote}>mural do grupo — visível para todos que usam este app</div>
      {feed.length === 0 ? (
        <div style={S.emptyState}>Ninguém postou um treino ainda. Seja o primeiro!</div>
      ) : (
        <div style={S.list}>
          {feed.map((f, i) => {
            const reacted = f.reactions?.includes(me);
            return (
              <div key={f.id} style={S.feedRow}>
                <div style={{ ...S.laneBar, background: LANE_COLORS[i % LANE_COLORS.length] }} />
                <div style={S.feedContent}>
                  <div style={S.feedTop}><span style={S.feedName}>{f.name}{f.name === me ? " (você)" : ""}</span><span style={S.feedDate}>{fmtDate(f.date)}</span></div>
                  <div style={S.feedStats}>{f.distance} km · {fmtTime(f.timeMs)} · {f.pace}</div>
                  <button style={{ ...S.reactBtn, color: reacted ? T.accent2 : T.muted }} onClick={() => onReact(f.id)}>
                    <Flame size={14} fill={reacted ? T.accent2 : "none"} /> {f.reactions?.length || 0}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, label }) {
  return <button style={active ? S.chipActive : S.chip} onClick={onClick}>{label}</button>;
}
function TabBtn({ active, onClick, icon, label }) {
  return (
    <button style={S.tabBtn} onClick={onClick}>
      <span style={{ color: active ? T.accent : T.muted }}>{icon}</span>
      <span style={{ ...S.tabLabel, color: active ? T.accent : T.muted }}>{label}</span>
    </button>
  );
}

// ================= design tokens =================
const T = { bg: "#1C2321", card: "#232B27", card2: "#2A332E", accent: "#C9F26C", accent2: "#FF6B35", text: "#F5F3EE", muted: "#8A9088", border: "#3A443E" };

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=JetBrains+Mono:wght@500;700&family=Work+Sans:wght@400;500;600&display=swap');
input[type="range"] { accent-color: ${T.accent}; }
input[type="checkbox"] { accent-color: ${T.accent}; }
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
`;

const S = {
  appShell: { display: "flex", flexDirection: "column", height: "100vh", maxWidth: 480, margin: "0 auto", background: T.bg, color: T.text, fontFamily: "'Work Sans', sans-serif", overflow: "hidden" },
  loadingText: { margin: "auto", color: T.muted },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 12px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 },
  brandMark: { fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: 1.5, color: T.text },
  headerRight: { display: "flex", alignItems: "center", gap: 6 },
  headerName: { fontSize: 13, color: T.muted, fontWeight: 500 },
  main: { flex: 1, overflowY: "auto" },
  tabPad: { padding: "16px 16px 24px" },

  onboardWrap: { margin: "auto", padding: 24, textAlign: "center", width: "100%" },
  onboardSub: { color: T.muted, fontSize: 14, marginTop: 6, marginBottom: 24 },
  tinyNote: { color: T.muted, fontSize: 11, marginTop: 14, lineHeight: 1.5 },

  input: { width: "100%", background: T.card2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "11px 14px", color: T.text, fontSize: 14, fontFamily: "'Work Sans', sans-serif", outline: "none", marginBottom: 10 },
  smallInput: { flex: 1, background: T.card2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", color: T.text, fontSize: 12, fontFamily: "'Work Sans', sans-serif", outline: "none" },
  btnPrimary: { width: "100%", background: T.accent, color: T.bg, border: "none", borderRadius: 10, padding: "13px 16px", fontSize: 15, fontWeight: 600, fontFamily: "'Work Sans', sans-serif", cursor: "pointer" },
  btnGhost: { flex: 1, background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 10, padding: "13px 16px", fontSize: 15, fontFamily: "'Work Sans', sans-serif", cursor: "pointer" },
  btnGhostFull: { width: "100%", background: "transparent", color: T.accent, border: `1px dashed ${T.accent}66`, borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 },

  pickerToggle: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", color: T.text, fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 10 },
  pickerList: { background: T.card2, border: `1px solid ${T.border}`, borderRadius: 10, padding: 8, marginBottom: 14 },
  pickerItem: { display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", color: T.text, padding: "9px 8px", fontSize: 13, cursor: "pointer" },
  pickerEmpty: { color: T.muted, fontSize: 12, padding: "6px 8px" },

  gpsPrompt: { marginBottom: 12 },
  gpsWarn: { fontSize: 11, color: T.accent2, marginTop: 6, textAlign: "center", lineHeight: 1.5 },
  gpsHint: { fontSize: 11, color: T.muted, marginTop: 6, textAlign: "center", lineHeight: 1.5 },
  laneCard: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: "22px 18px", textAlign: "center" },
  laneNumber: { fontFamily: "'Oswald', sans-serif", color: T.muted, letterSpacing: 3, fontSize: 11, marginBottom: 8 },
  stopwatch: { fontFamily: "'JetBrains Mono', monospace", fontSize: 44, fontWeight: 700, color: T.accent, letterSpacing: 1, textShadow: `0 0 24px ${T.accent}55` },

  metricGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 },
  metricBox: { background: T.card2, borderRadius: 10, padding: "10px 6px" },
  metricValue: { fontFamily: "'JetBrains Mono', monospace", fontSize: 17, fontWeight: 700 },
  metricLabel: { fontSize: 10, color: T.muted, marginTop: 2, letterSpacing: 0.3, textTransform: "uppercase" },

  manualRow: { display: "flex", gap: 8, marginTop: 12, justifyContent: "center" },
  manualBtn: { background: T.card2, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer" },

  stepCard: { background: T.card2, border: `1px solid ${T.accent}55`, borderRadius: 12, padding: "12px 14px", marginTop: 16, textAlign: "left" },
  stepLabel: { fontFamily: "'Oswald', sans-serif", fontSize: 13, color: T.accent, letterSpacing: 0.5 },
  stepTarget: { fontSize: 13, marginTop: 4 },
  stepPace: { fontSize: 12, color: T.muted, marginTop: 2 },
  nextStepBtn: { marginTop: 10, width: "100%", background: "transparent", border: `1px solid ${T.accent}`, color: T.accent, borderRadius: 8, padding: "8px", fontSize: 12, fontWeight: 600, cursor: "pointer" },

  timerControls: { display: "flex", justifyContent: "center", gap: 16, marginTop: 22 },
  circleBtnAccent: { width: 60, height: 60, borderRadius: "50%", background: T.accent, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  circleBtn: { width: 48, height: 48, borderRadius: "50%", background: T.card2, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", alignSelf: "center" },
  circleBtnOrange: { width: 48, height: 48, borderRadius: "50%", background: "transparent", border: `2px solid ${T.accent2}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", alignSelf: "center" },
  timerHint: { color: T.muted, fontSize: 11, marginTop: 14, letterSpacing: 0.5 },

  overlay: { position: "fixed", inset: 0, background: "#000000aa", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 10 },
  modal: { width: "100%", maxWidth: 480, background: T.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "24px 20px 28px", border: `1px solid ${T.border}` },
  modalTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 16, marginBottom: 12 },
  modalDist: { fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: T.accent, marginBottom: 4 },
  modalRow: { display: "flex", gap: 10, marginTop: 14 },

  statRow: { display: "flex", gap: 12, marginBottom: 18 },
  statBox: { flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 0", textAlign: "center" },
  statNum: { fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: T.accent },
  statLabel: { fontSize: 11, color: T.muted, marginTop: 2, letterSpacing: 0.5 },

  emptyState: { color: T.muted, fontSize: 13, textAlign: "center", padding: "40px 20px", lineHeight: 1.6 },
  list: { display: "flex", flexDirection: "column", gap: 8 },

  runRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", gap: 8 },
  runDate: { fontSize: 12, color: T.muted, width: 34 },
  runMid: { flex: 1 },
  runDist: { fontSize: 14, fontWeight: 600 },
  runPace: { fontSize: 12, color: T.muted },
  runTime: { fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: T.accent },
  compareBox: { background: T.card2, borderRadius: 10, padding: "10px 12px", marginTop: 4, display: "flex", flexDirection: "column", gap: 8 },
  compareRow: { display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${T.border}`, paddingBottom: 6 },
  compareLabel: { fontSize: 12, fontWeight: 600, width: 84, flexShrink: 0 },
  compareCols: { flex: 1, display: "flex", flexDirection: "column", gap: 2 },
  compareCol: { fontSize: 11, color: T.muted },

  formGroup: { marginBottom: 16 },
  formLabel: { fontSize: 12, color: T.muted, letterSpacing: 0.5, marginBottom: 8, textTransform: "uppercase" },
  formLabelSmall: { fontSize: 11, color: T.accent, marginTop: 6, marginBottom: 2, fontWeight: 600 },
  chipRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  chip: { background: T.card, border: `1px solid ${T.border}`, color: T.text, borderRadius: 20, padding: "8px 14px", fontSize: 13, cursor: "pointer" },
  chipActive: { background: T.accent, border: `1px solid ${T.accent}`, color: T.bg, borderRadius: 20, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  slider: { width: "100%" },

  blockForm: { background: T.card2, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6 },
  paceRow: { display: "flex", gap: 8 },
  checkboxLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.muted, marginTop: 4 },
  blockRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "9px 12px" },
  blockText: { fontSize: 12, flex: 1 },
  iconBtn: { background: "transparent", border: "none", cursor: "pointer", padding: 4 },

  workoutCard: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px" },
  workoutName: { fontSize: 14, fontWeight: 600 },
  fromTag: { fontSize: 11, color: T.accent2, fontWeight: 400 },
  workoutSteps: { fontSize: 11, color: T.muted, marginTop: 4, lineHeight: 1.5 },
  workoutActions: { display: "flex", gap: 6, alignItems: "center", marginTop: 10 },
  smallBtnAccent: { background: T.accent, color: T.bg, border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  smallBtn: { background: T.card2, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: "7px 9px", cursor: "pointer", display: "flex", alignItems: "center" },

  planList: { marginTop: 20, display: "flex", flexDirection: "column", gap: 10 },
  weekCard: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 16px" },
  weekHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1, color: T.accent, marginBottom: 8 },
  recoveryTag: { fontSize: 10, color: T.accent2, border: `1px solid ${T.accent2}`, borderRadius: 10, padding: "2px 8px" },
  sessionRow: { display: "flex", gap: 10, padding: "4px 0", fontSize: 13 },
  sessionDay: { width: 32, color: T.muted, fontWeight: 600 },
  sessionDesc: { color: T.text },

  feedNote: { fontSize: 11, color: T.muted, marginBottom: 14, letterSpacing: 0.3 },
  feedRow: { display: "flex", background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" },
  laneBar: { width: 5 },
  feedContent: { flex: 1, padding: "12px 14px" },
  feedTop: { display: "flex", justifyContent: "space-between", marginBottom: 3 },
  feedName: { fontWeight: 600, fontSize: 14 },
  feedDate: { fontSize: 12, color: T.muted },
  feedStats: { fontSize: 13, color: T.muted, fontFamily: "'JetBrains Mono', monospace" },
  reactBtn: { display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", fontSize: 12, marginTop: 8, cursor: "pointer", padding: 0 },

  tabbar: { display: "flex", borderTop: `1px solid ${T.border}`, background: T.card, flexShrink: 0 },
  tabBtn: { flex: 1, background: "transparent", border: "none", padding: "10px 0 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer" },
  tabLabel: { fontSize: 10, fontWeight: 600, letterSpacing: 0.3 },
};
