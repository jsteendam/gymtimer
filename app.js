'use strict';

/* =======================================================================
   Data model
   Routine { id, name, exercises: [Exercise] }
   Exercise {
     id, name, sets,
     variant: 'leftRight' | 'both',
     measure: 'time' | 'reps',
     workSeconds,   // used when measure === 'time'
     reps,          // used when measure === 'reps'
     restSeconds,   // target from this exercise's anchor to its next set; see buildRestGate
     supersetWithNext, // optional; links this exercise with the next into a superset
   }
   ======================================================================= */

const STORAGE_KEY = 'gymtimer.routines.v2';
const LAST_ROUTINE_KEY = 'gymtimer.lastRoutineId';
const PREFS_KEY = 'gymtimer.prefs.v1';

const PREPARE_SECONDS = 5; // fixed countdown before every timed side

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
          name: 'Half crimp',
          sets: 4,
          variant: 'leftRight',
          measure: 'time',
          workSeconds: 10,
          reps: 10,
          restSeconds: 120, // target rest between same-side reps; actual pause is derived
        },
      ],
    },
    {
      id: uid(),
      name: 'Lower body',
      exercises: [
        {
          id: uid(),
          name: 'Squat',
          sets: 3,
          variant: 'both',
          measure: 'reps',
          workSeconds: 30,
          reps: 12,
          restSeconds: 60,
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
const playerUnit = document.getElementById('playerUnit');
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
   Exercise step generation (shared by the editor summary and the player)
   ======================================================================= */

function actualRestSeconds(ex) {
  const restSeconds = Math.max(0, Number(ex.restSeconds) || 0);
  if (ex.variant === 'leftRight' && ex.measure === 'time') {
    const workSeconds = Math.max(0, Number(ex.workSeconds) || 0);
    return Math.max(0, restSeconds - PREPARE_SECONDS - workSeconds);
  }
  return restSeconds;
}

// Prepare/work items for one set. The work item that starts the exercise's rest clock
// (Left for timed left/right, otherwise the last side) is flagged with anchorFor.
function buildSetItems(ex) {
  const items = [];
  const sides = ex.variant === 'leftRight' ? ['Left', 'Right'] : [ex.name || 'Work'];
  const anchorIndex = ex.variant === 'leftRight' && ex.measure === 'time' ? 0 : sides.length - 1;

  sides.forEach((label, i) => {
    let work;
    if (ex.measure === 'time') {
      items.push({ type: 'prepare', measure: 'time', label: 'Get ready', seconds: PREPARE_SECONDS });
      work = { type: 'work', measure: 'time', label, seconds: Math.max(0, Number(ex.workSeconds) || 0) };
    } else {
      work = { type: 'work', measure: 'reps', label, reps: Math.max(1, Number(ex.reps) || 1) };
    }
    if (i === anchorIndex) work.anchorFor = ex.id;
    items.push(work);
  });

  return items;
}

// Rest before the next set/round: waits until every listed exercise has reached its target
// since its anchor. Resolved by the player when the step starts.
function buildRestGate(exercises) {
  return {
    type: 'rest',
    measure: 'time',
    label: 'Rest',
    gateFor: exercises.map(ex => ({ id: ex.id, targetSeconds: Math.max(0, Number(ex.restSeconds) || 0) })),
  };
}

// Consecutive exercises linked with supersetWithNext form one group; others are groups of one.
function groupExercises(exercises) {
  const groups = [];
  let current = [];
  exercises.forEach((ex, i) => {
    current.push(ex);
    if (!ex.supersetWithNext || i === exercises.length - 1) {
      groups.push(current);
      current = [];
    }
  });
  return groups;
}

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

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function exerciseSummaryText(ex, inSuperset) {
  const items = buildSetItems(ex);
  const repsCount = Math.max(1, Number(ex.reps) || 1);
  const repsPart = ex.measure === 'reps'
    ? `${repsCount} reps${ex.variant === 'leftRight' ? ' × 2 sides' : ''} + `
    : '';

  if (inSuperset) {
    const workSeconds = items.reduce((sum, i) => sum + (i.measure === 'time' ? i.seconds : 0), 0);
    return `Per set: ${repsPart}${formatDuration(workSeconds)} timed · ${ex.sets} sets · rest overlaps with superset`;
  }

  const restSeconds = Math.max(0, Number(ex.restSeconds) || 0);
  const rest = actualRestSeconds(ex);
  const timedSeconds = items.reduce((sum, i) => sum + (i.measure === 'time' ? i.seconds : 0), 0) + rest;
  const restNote = rest !== restSeconds ? ` (${formatDuration(restSeconds)} target)` : '';

  const perSet = `${repsPart}${formatDuration(timedSeconds)} timed${restNote ? restNote : ''}`;

  if (ex.measure === 'reps') {
    return `Per set: ${perSet} · ${ex.sets} sets`;
  }
  return `Per set: ${perSet} · Total (${ex.sets} sets): ${formatDuration(timedSeconds * ex.sets)}`;
}

function renderExercises() {
  const routine = currentRoutine();
  exercisesList.innerHTML = '';

  const groupOf = new Map();
  for (const group of groupExercises(routine.exercises)) {
    group.forEach((member, pos) => groupOf.set(member, { size: group.length, pos }));
  }

  routine.exercises.forEach((ex, exIndex) => {
    const { size: groupSize, pos: groupPos } = groupOf.get(ex);
    const inSuperset = groupSize > 1;

    if (exIndex > 0) exercisesList.appendChild(linkToggle(routine.exercises[exIndex - 1]));

    const exEl = document.createElement('div');
    exEl.className = 'exercise';
    if (inSuperset) {
      exEl.classList.add('in-superset');
      if (groupPos === 0) exEl.classList.add('superset-first');
      if (groupPos === groupSize - 1) exEl.classList.add('superset-last');
    }

    // header
    const header = document.createElement('div');
    header.className = 'exercise-header';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'exercise-name';
    nameInput.placeholder = 'Exercise name';
    nameInput.value = ex.name;
    nameInput.addEventListener('input', () => {
      ex.name = nameInput.value;
      persist();
      summary.textContent = exerciseSummaryText(ex, inSuperset);
    });
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
      summary.textContent = exerciseSummaryText(ex, inSuperset);
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

    // config form
    const form = document.createElement('div');
    form.className = 'exercise-config';

    const configRow = document.createElement('div');
    configRow.className = 'field-row';

    const sidesField = fieldWrap('Sides', selectInput([
      ['leftRight', 'Left / Right'],
      ['both', 'Both sides'],
    ], ex.variant, (value) => {
      ex.variant = value;
      persist();
      renderExercises();
    }));
    configRow.appendChild(sidesField);

    const measureField = fieldWrap('Measure', selectInput([
      ['time', 'Timed'],
      ['reps', 'Reps'],
    ], ex.measure, (value) => {
      ex.measure = value;
      persist();
      renderExercises();
    }));
    configRow.appendChild(measureField);

    form.appendChild(configRow);

    const amountRow = document.createElement('div');
    amountRow.className = 'field-row';

    if (ex.measure === 'time') {
      amountRow.appendChild(fieldWrap('Duration', durationInput(ex.workSeconds, (seconds) => {
        ex.workSeconds = seconds;
        persist();
        summary.textContent = exerciseSummaryText(ex, inSuperset);
      })));
    } else {
      const repsInput = document.createElement('input');
      repsInput.type = 'number';
      repsInput.min = '1';
      repsInput.value = ex.reps;
      repsInput.addEventListener('input', () => {
        ex.reps = Math.max(1, parseInt(repsInput.value, 10) || 1);
        persist();
        summary.textContent = exerciseSummaryText(ex, inSuperset);
      });
      amountRow.appendChild(fieldWrap('Reps', repsInput));
    }

    const restField = fieldWrap('Rest', durationInput(ex.restSeconds, (seconds) => {
      ex.restSeconds = seconds;
      persist();
      summary.textContent = exerciseSummaryText(ex, inSuperset);
    }));
    const restCaption = document.createElement('div');
    restCaption.className = 'field-caption';
    restCaption.textContent = inSuperset
      ? 'Target time from the start of one set to the start of the next'
      : ex.variant === 'leftRight' && ex.measure === 'time'
        ? 'Target time between reps on the same side'
        : 'Rest between sets';
    restField.appendChild(restCaption);
    amountRow.appendChild(restField);

    form.appendChild(amountRow);
    exEl.appendChild(form);

    const summary = document.createElement('div');
    summary.className = 'exercise-summary';
    summary.textContent = exerciseSummaryText(ex, inSuperset);
    exEl.appendChild(summary);

    exercisesList.appendChild(exEl);
  });
}

function linkToggle(ex) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'superset-link' + (ex.supersetWithNext ? ' linked' : '');
  btn.textContent = ex.supersetWithNext ? '🔗 Superset' : 'link';
  btn.title = ex.supersetWithNext ? 'Unlink superset' : 'Link as superset';
  btn.addEventListener('click', () => {
    ex.supersetWithNext = !ex.supersetWithNext;
    persist(); renderExercises();
  });
  return btn;
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

function fieldWrap(labelText, inputEl) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = labelText;
  wrap.append(span, inputEl);
  return wrap;
}

function selectInput(options, value, onChange) {
  const select = document.createElement('select');
  for (const [optValue, optLabel] of options) {
    const opt = document.createElement('option');
    opt.value = optValue;
    opt.textContent = optLabel;
    if (optValue === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function durationInput(initialSeconds, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'duration-input';

  const minInput = document.createElement('input');
  minInput.type = 'number';
  minInput.min = '0';
  minInput.value = Math.floor(initialSeconds / 60);

  const secInput = document.createElement('input');
  secInput.type = 'number';
  secInput.min = '0';
  secInput.max = '59';
  secInput.value = initialSeconds % 60;

  function commit() {
    const m = Math.max(0, parseInt(minInput.value, 10) || 0);
    const s = Math.max(0, Math.min(59, parseInt(secInput.value, 10) || 0));
    onChange(m * 60 + s);
  }
  minInput.addEventListener('input', commit);
  secInput.addEventListener('input', commit);

  wrap.append(minInput, document.createTextNode('m'), secInput, document.createTextNode('s'));
  return wrap;
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
  copy.exercises.forEach(ex => { ex.id = uid(); });
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
    variant: 'both',
    measure: 'time',
    workSeconds: 30,
    reps: 10,
    restSeconds: 30,
  });
  persist();
  renderExercises();
});

/* =======================================================================
   Player
   ======================================================================= */

// Groups run round by round (A1, B1, A2, B2, …); members with fewer sets drop out of later
// rounds. Before each exercise's next set sits a rest gate for that exercise.
function buildPlaylist(routine) {
  const playlist = [];
  const groups = groupExercises(routine.exercises);

  groups.forEach((group, groupIndex) => {
    const rounds = Math.max(...group.map(ex => Math.max(1, ex.sets)));
    const meta = (ex, setIndex) => ({
      exerciseName: ex.name || 'Exercise',
      setIndex,
      setsTotal: Math.max(1, ex.sets),
      supersetSize: group.length,
    });

    for (let setIndex = 1; setIndex <= rounds; setIndex++) {
      const members = group.filter(ex => setIndex <= Math.max(1, ex.sets));
      // One rest per round, before it starts, never between exercises of a superset.
      if (setIndex > 1) {
        playlist.push({ ...meta(members[0], setIndex), stepIndex: 1, stepsInSet: 1, ...buildRestGate(members) });
      }
      members.forEach((ex) => {
        const setItems = buildSetItems(ex);
        if (group.length > 1) {
          // In a superset the rest target spans set start to next set start, so the
          // other exercises' time (and this one's own) counts toward it.
          setItems.forEach(item => { delete item.anchorFor; });
          setItems[0].anchorStartFor = ex.id;
        }
        setItems.forEach((raw, i) => {
          playlist.push({ ...meta(ex, setIndex), stepIndex: i + 1, stepsInSet: setItems.length, ...raw });
        });
      });
    }

    // Rest before moving on to the next exercise/superset.
    if (groupIndex < groups.length - 1) {
      const first = group[0];
      playlist.push({ ...meta(first, Math.max(1, first.sets)), stepIndex: 1, stepsInSet: 1, ...buildRestGate(group) });
    }
  });
  return playlist;
}

function resolveRestGate(item) {
  const remaining = item.gateFor.map(({ id, targetSeconds }) => {
    const anchor = player.anchors[id];
    const elapsed = anchor ? (Date.now() - anchor) / 1000 : 0;
    return targetSeconds - elapsed;
  });
  return Math.max(0, Math.round(Math.max(...remaining)));
}

const player = {
  playlist: [],
  index: 0,
  deadline: 0,
  remainingMsAtPause: 0,
  paused: false,
  tickHandle: null,
  lastBeepSecond: null,
  anchors: {},   // exercise id → timestamp its rest clock started
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

function announcement(item) {
  if (item.type === 'work' && item.measure === 'reps') {
    return `${item.label}, ${item.reps} reps`;
  }
  return item.label;
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
    alert('Add at least one exercise before starting.');
    return;
  }
  ensureAudioContext();
  player.playlist = playlist;
  player.index = 0;
  player.paused = false;
  player.anchors = {};
  editorView.hidden = true;
  playerView.hidden = false;
  requestWakeLock();
  startStep(0);
}

function isTimed(item) {
  return item.measure === 'time';
}

function startStep(i) {
  player.index = i;
  const item = player.playlist[i];
  if (item.gateFor && item.seconds === undefined) item.seconds = resolveRestGate(item);
  if (item.gateFor && item.seconds <= 0) {
    advance();
    return;
  }
  if (item.anchorStartFor) player.anchors[item.anchorStartFor] = Date.now();
  player.lastBeepSecond = null;
  renderPlayerStatic(item);
  transitionSound(item.type);
  speak(announcement(item));
  clearInterval(player.tickHandle);
  player.tickHandle = null;
  if (isTimed(item)) {
    player.deadline = Date.now() + item.seconds * 1000;
    player.tickHandle = setInterval(tick, 100);
    tick();
  }
}

function renderPlayerStatic(item) {
  playerStage.dataset.type = item.type;
  playerStage.classList.remove('workout-done');
  playerLabel.textContent = item.label;
  playerProgress.textContent =
    `${item.supersetSize > 1 ? 'Superset · ' : ''}${item.exerciseName} · Set ${item.setIndex}/${item.setsTotal} · Step ${item.stepIndex}/${item.stepsInSet}`;

  if (isTimed(item)) {
    playerTime.textContent = item.seconds;
    playerUnit.textContent = '';
  } else {
    playerTime.textContent = item.reps;
    playerUnit.textContent = 'reps';
  }

  const next = player.playlist[player.index + 1];
  playerNext.textContent = next
    ? next.gateFor && next.seconds === undefined
      ? `Next: ${next.label}`
      : `Next: ${next.label} (${isTimed(next) ? next.seconds + 's' : next.reps + ' reps'})`
    : 'Last step';

  pauseBtn.hidden = !isTimed(item);
  pauseBtn.textContent = 'Pause';
  skipBtn.textContent = isTimed(item) ? 'Skip ⏭' : 'Done ✓';
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
  const current = player.playlist[player.index];
  if (current && current.anchorFor) player.anchors[current.anchorFor] = Date.now();
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
  playerUnit.textContent = '';
  playerProgress.textContent = '';
  playerNext.textContent = '';
  pauseBtn.hidden = true;
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  });
}
