'use strict';

/* =======================================================================
   Data model
   Routine { id, name, exercises: [Exercise] }
   Exercise { id, name, sets, steps: [Step] }
   Step { type: 'prepare' | 'work' | 'rest', label, seconds }
   ======================================================================= */

const STORAGE_KEY = 'gymtimer.routines.v1';
const LAST_ROUTINE_KEY = 'gymtimer.lastRoutineId';
const PREFS_KEY = 'gymtimer.prefs.v1';

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
}

function defaultRoutines() {
  return [
    {
      id: uid(),
      name: 'Weighted pickups',
      exercises: [
        {
          id: uid(),
          name: 'Weighted pickups',
          sets: 4,
          steps: [
            { type: 'prepare', label: 'Get ready', seconds: 5 },
            { type: 'work', label: 'Left hand', seconds: 10 },
            { type: 'prepare', label: 'Get ready', seconds: 5 },
            { type: 'work', label: 'Right hand', seconds: 10 },
            { type: 'rest', label: 'Rest', seconds: 105 }, // 2:00 total minus the 15s of countdown+right-hand
          ],
        },
      ],
    },
  ];
}

function loadRoutines() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (e) { /* ignore corrupt storage */ }
  const seeded = defaultRoutines();
  saveRoutines(seeded);
  return seeded;
}

function saveRoutines(routines) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routines));
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || { sound: true, voice: true };
  } catch (e) {
    return { sound: true, voice: true };
  }
}

function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/* =======================================================================
   State
   ======================================================================= */

let routines = loadRoutines();
let currentRoutineId = localStorage.getItem(LAST_ROUTINE_KEY) || routines[0].id;
if (!routines.find(r => r.id === currentRoutineId)) currentRoutineId = routines[0].id;

const prefs = loadPrefs();

function currentRoutine() {
  return routines.find(r => r.id === currentRoutineId);
}

function persist() {
  saveRoutines(routines);
  localStorage.setItem(LAST_ROUTINE_KEY, currentRoutineId);
}

/* =======================================================================
   Elements
   ======================================================================= */

const editorView = document.getElementById('editorView');
const playerView = document.getElementById('playerView');

const routineSelect = document.getElementById('routineSelect');
const newRoutineBtn = document.getElementById('newRoutineBtn');
const duplicateRoutineBtn = document.getElementById('duplicateRoutineBtn');
const deleteRoutineBtn = document.getElementById('deleteRoutineBtn');
const routineNameInput = document.getElementById('routineName');
const exercisesList = document.getElementById('exercisesList');
const addExerciseBtn = document.getElementById('addExerciseBtn');
const startWorkoutBtn = document.getElementById('startWorkoutBtn');

const playerProgress = document.getElementById('playerProgress');
const playerStage = document.getElementById('playerStage');
const playerLabel = document.getElementById('playerLabel');
const playerTime = document.getElementById('playerTime');
const playerNext = document.getElementById('playerNext');
const pauseBtn = document.getElementById('pauseBtn');
const skipBtn = document.getElementById('skipBtn');
const skipBackBtn = document.getElementById('skipBackBtn');
const stopBtn = document.getElementById('stopBtn');
const soundToggle = document.getElementById('soundToggle');
const voiceToggle = document.getElementById('voiceToggle');

soundToggle.checked = prefs.sound;
voiceToggle.checked = prefs.voice;

/* =======================================================================
   Editor rendering
   ======================================================================= */

function renderRoutineSelect() {
  routineSelect.innerHTML = '';
  for (const r of routines) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name || 'Untitled routine';
    if (r.id === currentRoutineId) opt.selected = true;
    routineSelect.appendChild(opt);
  }
}

function typeLabel(type) {
  return { prepare: 'Prepare', work: 'Work', rest: 'Rest' }[type] || type;
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function exerciseTotalSeconds(ex) {
  return ex.steps.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0);
}

function renderExercises() {
  const routine = currentRoutine();
  exercisesList.innerHTML = '';

  routine.exercises.forEach((ex, exIndex) => {
    const exEl = document.createElement('div');
    exEl.className = 'exercise';

    // header
    const header = document.createElement('div');
    header.className = 'exercise-header';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'exercise-name';
    nameInput.placeholder = 'Exercise name';
    nameInput.value = ex.name;
    nameInput.addEventListener('input', () => { ex.name = nameInput.value; persist(); });
    header.appendChild(nameInput);

    const setsLabel = document.createElement('label');
    setsLabel.className = 'exercise-sets-label';
    const setsInput = document.createElement('input');
    setsInput.type = 'number';
    setsInput.min = '1';
    setsInput.className = 'exercise-sets';
    setsInput.value = ex.sets;
    setsInput.addEventListener('input', () => {
      ex.sets = Math.max(1, parseInt(setsInput.value, 10) || 1);
      persist();
    });
    setsLabel.append('Sets ', setsInput);
    header.appendChild(setsLabel);

    header.appendChild(iconButton('↑', 'Move exercise up', () => {
      if (exIndex === 0) return;
      [routine.exercises[exIndex - 1], routine.exercises[exIndex]] = [routine.exercises[exIndex], routine.exercises[exIndex - 1]];
      persist(); renderExercises();
    }));
    header.appendChild(iconButton('↓', 'Move exercise down', () => {
      if (exIndex === routine.exercises.length - 1) return;
      [routine.exercises[exIndex + 1], routine.exercises[exIndex]] = [routine.exercises[exIndex], routine.exercises[exIndex + 1]];
      persist(); renderExercises();
    }));
    header.appendChild(iconButton('⧉', 'Duplicate exercise', () => {
      const copy = JSON.parse(JSON.stringify(ex));
      copy.id = uid();
      routine.exercises.splice(exIndex + 1, 0, copy);
      persist(); renderExercises();
    }));
    header.appendChild(iconButton('✕', 'Remove exercise', () => {
      routine.exercises.splice(exIndex, 1);
      persist(); renderExercises();
    }));

    exEl.appendChild(header);

    // steps
    const stepsEl = document.createElement('div');
    stepsEl.className = 'steps-list';

    ex.steps.forEach((step, stepIndex) => {
      stepsEl.appendChild(renderStepRow(ex, step, stepIndex, () => renderExercises()));
    });

    exEl.appendChild(stepsEl);

    const addStepBtn = document.createElement('button');
    addStepBtn.className = 'btn add-step';
    addStepBtn.textContent = '+ Add step';
    addStepBtn.addEventListener('click', () => {
      ex.steps.push({ type: 'work', label: '', seconds: 10 });
      persist(); renderExercises();
    });
    exEl.appendChild(addStepBtn);

    const summary = document.createElement('div');
    summary.className = 'exercise-summary';
    const perSet = exerciseTotalSeconds(ex);
    summary.textContent = `Per set: ${formatDuration(perSet)} · Total (${ex.sets} sets): ${formatDuration(perSet * ex.sets)}`;
    exEl.appendChild(summary);

    exercisesList.appendChild(exEl);
  });
}

function iconButton(symbol, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.type = 'button';
  btn.textContent = symbol;
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderStepRow(ex, step, stepIndex, onStructuralChange) {
  const row = document.createElement('div');
  row.className = 'step-row';
  row.dataset.type = step.type;

  const typeSelect = document.createElement('select');
  typeSelect.className = 'step-type';
  for (const t of ['prepare', 'work', 'rest']) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = typeLabel(t);
    if (t === step.type) opt.selected = true;
    typeSelect.appendChild(opt);
  }
  typeSelect.addEventListener('change', () => {
    step.type = typeSelect.value;
    persist();
    onStructuralChange();
  });
  row.appendChild(typeSelect);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'step-label';
  labelInput.placeholder = typeLabel(step.type);
  labelInput.value = step.label;
  labelInput.addEventListener('input', () => { step.label = labelInput.value; persist(); });
  row.appendChild(labelInput);

  const duration = document.createElement('div');
  duration.className = 'step-duration';
  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.min = '0';
  minInput.value = Math.floor(step.seconds / 60);
  const secInput = document.createElement('input');
  secInput.type = 'number';
  secInput.min = '0';
  secInput.max = '59';
  secInput.value = step.seconds % 60;

  function commitDuration() {
    const m = Math.max(0, parseInt(minInput.value, 10) || 0);
    const s = Math.max(0, Math.min(59, parseInt(secInput.value, 10) || 0));
    step.seconds = m * 60 + s;
    persist();
  }
  minInput.addEventListener('input', commitDuration);
  secInput.addEventListener('input', commitDuration);

  duration.append(minInput, document.createTextNode('m'), secInput, document.createTextNode('s'));
  row.appendChild(duration);

  const actions = document.createElement('div');
  actions.className = 'step-row-actions';
  actions.appendChild(iconButton('↑', 'Move step up', () => {
    if (stepIndex === 0) return;
    [ex.steps[stepIndex - 1], ex.steps[stepIndex]] = [ex.steps[stepIndex], ex.steps[stepIndex - 1]];
    persist(); onStructuralChange();
  }));
  actions.appendChild(iconButton('↓', 'Move step down', () => {
    if (stepIndex === ex.steps.length - 1) return;
    [ex.steps[stepIndex + 1], ex.steps[stepIndex]] = [ex.steps[stepIndex], ex.steps[stepIndex + 1]];
    persist(); onStructuralChange();
  }));
  actions.appendChild(iconButton('⧉', 'Duplicate step', () => {
    ex.steps.splice(stepIndex + 1, 0, { ...step });
    persist(); onStructuralChange();
  }));
  actions.appendChild(iconButton('✕', 'Remove step', () => {
    ex.steps.splice(stepIndex, 1);
    persist(); onStructuralChange();
  }));
  row.appendChild(actions);

  return row;
}

function renderEditor() {
  renderRoutineSelect();
  const routine = currentRoutine();
  routineNameInput.value = routine.name;
  renderExercises();
}

/* ---- routine-level actions ---- */

routineSelect.addEventListener('change', () => {
  currentRoutineId = routineSelect.value;
  persist();
  renderEditor();
});

routineNameInput.addEventListener('input', () => {
  currentRoutine().name = routineNameInput.value;
  persist();
  renderRoutineSelect();
});

newRoutineBtn.addEventListener('click', () => {
  const r = { id: uid(), name: 'New routine', exercises: [] };
  routines.push(r);
  currentRoutineId = r.id;
  persist();
  renderEditor();
});

duplicateRoutineBtn.addEventListener('click', () => {
  const copy = JSON.parse(JSON.stringify(currentRoutine()));
  copy.id = uid();
  copy.name = copy.name + ' (copy)';
  copy.exercises.forEach(ex => {
    ex.id = uid();
    ex.steps.forEach(s => { /* steps carry no id */ });
  });
  routines.push(copy);
  currentRoutineId = copy.id;
  persist();
  renderEditor();
});

deleteRoutineBtn.addEventListener('click', () => {
  if (routines.length <= 1) {
    alert("Can't delete the last routine.");
    return;
  }
  if (!confirm(`Delete routine "${currentRoutine().name}"?`)) return;
  routines = routines.filter(r => r.id !== currentRoutineId);
  currentRoutineId = routines[0].id;
  persist();
  renderEditor();
});

addExerciseBtn.addEventListener('click', () => {
  currentRoutine().exercises.push({
    id: uid(),
    name: 'New exercise',
    sets: 3,
    steps: [{ type: 'work', label: '', seconds: 30 }],
  });
  persist();
  renderExercises();
});

/* =======================================================================
   Player
   ======================================================================= */

function buildPlaylist(routine) {
  const playlist = [];
  routine.exercises.forEach((ex) => {
    const setsTotal = Math.max(1, ex.sets);
    for (let setIndex = 1; setIndex <= setsTotal; setIndex++) {
      ex.steps.forEach((step, stepIndex) => {
        playlist.push({
          exerciseName: ex.name || 'Exercise',
          setIndex,
          setsTotal,
          stepIndex: stepIndex + 1,
          stepsInSet: ex.steps.length,
          type: step.type,
          label: step.label || typeLabel(step.type),
          seconds: Math.max(0, Number(step.seconds) || 0),
        });
      });
    }
  });
  return playlist;
}

const player = {
  playlist: [],
  index: 0,
  deadline: 0,
  remainingMsAtPause: 0,
  paused: false,
  tickHandle: null,
  lastBeepSecond: null,
  wakeLock: null,
  audioCtx: null,
};

function ensureAudioContext() {
  if (!player.audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) player.audioCtx = new Ctx();
  }
  if (player.audioCtx && player.audioCtx.state === 'suspended') {
    player.audioCtx.resume();
  }
  return player.audioCtx;
}

function beep(frequency = 880, durationMs = 120) {
  if (!prefs.sound) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000);
}

function speak(text) {
  if (!prefs.voice || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  window.speechSynthesis.speak(utter);
}

function transitionSound(type) {
  if (type === 'work') beep(1046, 150);
  else if (type === 'rest') beep(523, 150);
  else beep(659, 100);
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      player.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* not available / denied — non-fatal */ }
}

function releaseWakeLock() {
  if (player.wakeLock) {
    player.wakeLock.release().catch(() => {});
    player.wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && playerView && !playerView.hidden && !player.paused) {
    requestWakeLock();
  }
});

function startWorkout() {
  const routine = currentRoutine();
  const playlist = buildPlaylist(routine);
  if (!playlist.length) {
    alert('Add at least one exercise with a step before starting.');
    return;
  }
  ensureAudioContext();
  player.playlist = playlist;
  player.index = 0;
  player.paused = false;
  editorView.hidden = true;
  playerView.hidden = false;
  requestWakeLock();
  startStep(0);
}

function startStep(i) {
  player.index = i;
  const item = player.playlist[i];
  player.deadline = Date.now() + item.seconds * 1000;
  player.lastBeepSecond = null;
  renderPlayerStatic(item);
  transitionSound(item.type);
  speak(item.label);
  clearInterval(player.tickHandle);
  player.tickHandle = setInterval(tick, 100);
  tick();
}

function renderPlayerStatic(item) {
  playerStage.dataset.type = item.type;
  playerStage.classList.remove('workout-done');
  playerLabel.textContent = item.label;
  playerProgress.textContent =
    `${item.exerciseName} · Set ${item.setIndex}/${item.setsTotal} · Step ${item.stepIndex}/${item.stepsInSet}`;

  const next = player.playlist[player.index + 1];
  playerNext.textContent = next ? `Next: ${next.label} (${next.seconds}s)` : 'Last step';

  pauseBtn.textContent = 'Pause';
}

function tick() {
  if (player.paused) return;
  const msLeft = player.deadline - Date.now();
  if (msLeft <= 0) {
    advance();
    return;
  }
  const secLeft = Math.ceil(msLeft / 1000);
  playerTime.textContent = secLeft;
  if (secLeft <= 3 && secLeft >= 1 && player.lastBeepSecond !== secLeft) {
    beep(440, 80);
    player.lastBeepSecond = secLeft;
  }
}

function advance() {
  if (player.index + 1 < player.playlist.length) {
    startStep(player.index + 1);
  } else {
    finishWorkout();
  }
}

function finishWorkout() {
  clearInterval(player.tickHandle);
  playerStage.classList.add('workout-done');
  playerStage.dataset.type = 'work';
  playerLabel.textContent = 'Workout complete!';
  playerTime.textContent = '🎉';
  playerProgress.textContent = '';
  playerNext.textContent = '';
  beep(1046, 150);
  setTimeout(() => beep(1318, 200), 180);
  speak('Workout complete');
  releaseWakeLock();
}

pauseBtn.addEventListener('click', () => {
  if (player.index >= player.playlist.length) return;
  if (player.paused) {
    player.paused = false;
    player.deadline = Date.now() + player.remainingMsAtPause;
    pauseBtn.textContent = 'Pause';
  } else {
    player.paused = true;
    player.remainingMsAtPause = player.deadline - Date.now();
    pauseBtn.textContent = 'Resume';
  }
});

skipBtn.addEventListener('click', () => {
  clearInterval(player.tickHandle);
  advance();
});

skipBackBtn.addEventListener('click', () => {
  clearInterval(player.tickHandle);
  startStep(player.index);
});

stopBtn.addEventListener('click', () => {
  clearInterval(player.tickHandle);
  releaseWakeLock();
  window.speechSynthesis && window.speechSynthesis.cancel();
  playerView.hidden = true;
  editorView.hidden = false;
});

soundToggle.addEventListener('change', () => {
  prefs.sound = soundToggle.checked;
  savePrefs(prefs);
});
voiceToggle.addEventListener('change', () => {
  prefs.voice = voiceToggle.checked;
  savePrefs(prefs);
  if (!prefs.voice) window.speechSynthesis && window.speechSynthesis.cancel();
});

startWorkoutBtn.addEventListener('click', startWorkout);

/* =======================================================================
   Init
   ======================================================================= */

renderEditor();
