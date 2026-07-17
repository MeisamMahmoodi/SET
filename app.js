(function () {
  "use strict";

  /* ================= Default data ================= */
  function defaultData() {
    return {
      settings: { proteinGoal: 150 },
      splits: [
        { id: "push", name: "Push", exercises: [
          { id: "push-schraeg", name: "Schrägbank", bodyweight: false },
          { id: "push-flach", name: "Flachbank", bodyweight: false },
          { id: "push-schulter", name: "Schulterdrücken", bodyweight: false },
          { id: "push-butterfly", name: "Butterfly", bodyweight: false },
          { id: "push-seitheben", name: "Seitheben", bodyweight: false },
          { id: "push-pushdown", name: "Trizeps Pushdown", bodyweight: false },
          { id: "push-overhead", name: "Trizeps Overhead", bodyweight: false }
        ]},
        { id: "pull", name: "Pull", exercises: [
          { id: "pull-klimmzuege", name: "Klimmzüge", bodyweight: true },
          { id: "pull-latziehen", name: "Latziehen eng", bodyweight: false },
          { id: "pull-breitrudern", name: "Breites Rudern", bodyweight: false },
          { id: "pull-reverse", name: "Reverse Butterfly", bodyweight: false },
          { id: "pull-preacher", name: "Preacher Curls", bodyweight: false },
          { id: "pull-hammer", name: "Hammer Curls Kabel", bodyweight: false }
        ]},
        { id: "legs", name: "Legs", exercises: [
          { id: "legs-presse", name: "Beinpresse", bodyweight: false },
          { id: "legs-strecker", name: "Beinstrecker", bodyweight: false },
          { id: "legs-beuger", name: "Beinbeuger", bodyweight: false }
        ]},
        { id: "oberkoerper", name: "Oberkörper", exercises: [
          { id: "ob-schraeg", name: "Schrägbank", bodyweight: false },
          { id: "ob-klimmzuege", name: "Klimmzüge", bodyweight: true },
          { id: "ob-brustpresse", name: "Brustpresse", bodyweight: false },
          { id: "ob-ruderneng", name: "Rudern eng", bodyweight: false },
          { id: "ob-butterfly", name: "Butterfly", bodyweight: false },
          { id: "ob-ruderweit", name: "Rudern weit", bodyweight: false }
        ]},
        { id: "arme", name: "Arme", exercises: [
          { id: "arme-schulter", name: "Schulterdrücken", bodyweight: false },
          { id: "arme-preacher", name: "Preacher Curls", bodyweight: false },
          { id: "arme-overhead", name: "Trizeps Overhead", bodyweight: false },
          { id: "arme-hammer", name: "Hammer Curls", bodyweight: false },
          { id: "arme-pushdown", name: "Trizeps Pushdown", bodyweight: false },
          { id: "arme-reverse", name: "Reverse Butterfly", bodyweight: false }
        ]}
      ],
      sessions: [],
      protein: [],
      bodyweight: []
    };
  }

  const ICON_MIC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>';
  const ICON_TIMER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l3 2"></path><path d="M9 2h6"></path></svg>';

  const STORAGE_KEY = "gymlog-v1";

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      const base = defaultData();
      return {
        settings: Object.assign(base.settings, parsed.settings || {}),
        splits: Array.isArray(parsed.splits) && parsed.splits.length ? parsed.splits : base.splits,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        protein: Array.isArray(parsed.protein) ? parsed.protein : [],
        bodyweight: Array.isArray(parsed.bodyweight) ? parsed.bodyweight : []
      };
    } catch (e) {
      console.warn("Konnte gespeicherte Daten nicht lesen, starte mit Standarddaten.", e);
      return defaultData();
    }
  }

  let state = loadData();
  function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  let currentSplitId = state.splits[0].id;
  let currentView = "workout";
  let restInterval = null;

  /* ================= utils ================= */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const todayStr = () => new Date().toISOString().slice(0, 10);

  function parseNum(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = parseFloat(String(v).replace(",", "."));
    return isNaN(n) ? null : n;
  }

  function fmtWeight(n) {
    if (n === null || n === undefined) return "-";
    return Number(n).toLocaleString("de-DE", { maximumFractionDigits: 2 });
  }

  function fmtDateLabel(d) {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" });
  }

  function daysAgoStr(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  function initials(name) {
    return name.trim().slice(0, 2).toUpperCase();
  }

  function getSplit(splitId) { return state.splits.find((s) => s.id === splitId); }

  function allExercises() {
    const list = [];
    state.splits.forEach((s) => s.exercises.forEach((e) => list.push({ splitId: s.id, splitName: s.name, ...e })));
    return list;
  }

  /* ================= sessions ================= */
  function findSession(splitId, date) {
    return state.sessions.find((s) => s.splitId === splitId && s.date === date);
  }

  function getOrCreateTodaySession(splitId) {
    let session = findSession(splitId, todayStr());
    if (!session) {
      session = { id: uid(), splitId, date: todayStr(), exerciseData: {} };
      state.sessions.push(session);
    }
    return session;
  }

  function getPreviousSession(splitId, beforeDate) {
    const list = state.sessions
      .filter((s) => s.splitId === splitId && s.date < beforeDate && hasRealData(s))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return list[0] || null;
  }

  function hasRealData(session) {
    return Object.values(session.exerciseData || {}).some(
      (ex) => ex.sets && ex.sets.some((s) => s.weight !== null || s.reps !== null)
    );
  }

  function sessionsForExercise(exerciseId) {
    return state.sessions
      .filter((s) => s.exerciseData && s.exerciseData[exerciseId])
      .map((s) => ({ date: s.date, entry: s.exerciseData[exerciseId] }))
      .filter((s) => s.entry.sets && s.entry.sets.some((st) => st.weight !== null || st.reps !== null))
      .sort((a, b) => (a.date > b.date ? 1 : -1));
  }

  function topValue(entry, bodyweight) {
    if (!entry || !entry.sets || !entry.sets.length) return null;
    const vals = entry.sets
      .map((s) => (bodyweight ? s.reps : s.weight))
      .filter((v) => v !== null && v !== undefined);
    if (!vals.length) return null;
    return Math.max(...vals);
  }

  /* ================= rendering: tabs ================= */
  function renderTabs() {
    const nav = $("#split-tabs");
    nav.innerHTML = "";
    state.splits.forEach((s) => {
      const btn = document.createElement("button");
      btn.textContent = s.name;
      if (s.id === currentSplitId) btn.classList.add("active");
      btn.addEventListener("click", () => {
        currentSplitId = s.id;
        render();
      });
      nav.appendChild(btn);
    });
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "Eigenen Split erstellen";
    addBtn.setAttribute("aria-label", "Eigenen Split erstellen");
    addBtn.style.flex = "0 0 auto";
    addBtn.style.padding = "8px 14px";
    addBtn.addEventListener("click", onAddSplit);
    nav.appendChild(addBtn);
  }

  function onAddSplit() {
    openModal(`
      <h3>Neuen Split erstellen</h3>
      <input id="new-split-name" type="text" placeholder="z. B. Arnold Split, Oberkörper" />
      <div class="modal-actions">
        <button class="ghost-btn" id="modal-cancel">Abbrechen</button>
        <button class="primary-btn" id="modal-save">Erstellen</button>
      </div>
    `);
    $("#modal-cancel").addEventListener("click", closeModal);
    $("#modal-save").addEventListener("click", () => {
      const name = $("#new-split-name").value.trim();
      if (!name) return;
      const split = { id: uid(), name, exercises: [] };
      state.splits.push(split);
      saveData();
      currentSplitId = split.id;
      closeModal();
      render();
    });
  }

  function onDeleteCurrentSplit() {
    if (state.splits.length <= 1) {
      alert("Das ist dein letzter Split — lege zuerst einen neuen an, bevor du diesen löschst.");
      return;
    }
    const split = getSplit(currentSplitId);
    if (!confirm(`Split "${split.name}" wirklich löschen? Bereits geloggte Trainingsdaten bleiben in der Historie erhalten.`)) return;
    state.splits = state.splits.filter((s) => s.id !== currentSplitId);
    currentSplitId = state.splits[0].id;
    saveData();
    closeModal();
    render();
  }

  /* ================= rendering: workout view ================= */
  function trendForExercise(exerciseId) {
    const list = sessionsForExercise(exerciseId);
    if (list.length < 2) return null;
    const bodyweight = allExercises().find((e) => e.id === exerciseId).bodyweight;
    const last = topValue(list[list.length - 1].entry, bodyweight);
    const prev = topValue(list[list.length - 2].entry, bodyweight);
    if (last === null || prev === null) return null;
    if (last > prev) return { dir: "up", delta: last - prev };
    if (last < prev) return { dir: "down", delta: prev - last };
    return { dir: "flat", delta: 0 };
  }

  function renderExerciseList() {
    const split = getSplit(currentSplitId);
    $("#page-title").textContent = split.name + " day";
    $("#today-label").textContent = fmtDateLabel(todayStr());
    const session = getOrCreateTodaySession(currentSplitId);
    const container = $("#exercise-list");
    container.innerHTML = "";

    split.exercises.forEach((ex) => {
      const entry = session.exerciseData[ex.id];
      const sets = (entry && entry.sets && entry.sets.length) ? entry.sets : [{ weight: null, reps: null, note: "" }];
      const trend = trendForExercise(ex.id);
      const last = sessionsForExercise(ex.id).filter((s) => s.date < todayStr()).slice(-1)[0];
      const lastVal = last ? topValue(last.entry, ex.bodyweight) : null;

      const card = document.createElement("div");
      card.className = "exercise-card card";
      card.innerHTML = `
        <div class="exercise-head">
          <div class="name-block">
            <div class="exercise-icon">${initials(ex.name)}</div>
            <div>
              <div class="exercise-title">${ex.name}</div>
              <div class="exercise-sub">${lastVal !== null ? "letztes Mal " + fmtWeight(lastVal) + (ex.bodyweight ? " Wdh" : " kg") : "noch keine Daten"}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${trend ? `<span class="trend-pill ${trend.dir === "up" ? "up" : ""}">${trend.dir === "up" ? "↑" : trend.dir === "down" ? "↓" : "–"} ${trend.delta ? fmtWeight(trend.delta) : ""}</span>` : ""}
            <button class="icon-btn timer-btn" title="Pause starten" aria-label="Pause starten" data-timer="90">${ICON_TIMER}</button>
            <button class="icon-btn remove-ex-btn" title="Übung entfernen" aria-label="Übung entfernen" data-ex="${ex.id}">×</button>
          </div>
        </div>
        <div class="sets" data-ex-id="${ex.id}" data-bodyweight="${ex.bodyweight}"></div>
        <button class="ghost-btn small add-set-btn" data-ex="${ex.id}">+ Satz</button>
        <div class="oneRM"></div>
      `;
      const setsWrap = $(".sets", card);
      sets.forEach((set, i) => setsWrap.appendChild(renderSetRow(ex, i, set, sets.length)));
      updateOneRM(card, ex, sets);
      container.appendChild(card);
    });

    bindExerciseListEvents();
  }

  function renderSetRow(ex, index, set, total) {
    const row = document.createElement("div");
    row.className = "set-row";
    row.dataset.exId = ex.id;
    row.dataset.index = index;
    row.innerHTML = `
      <span class="idx">${index + 1}</span>
      <input class="num weight-input" type="text" inputmode="decimal" placeholder="0" value="${set.weight ?? ""}" aria-label="Gewicht Satz ${index + 1}" />
      <span class="unit">${ex.bodyweight ? "+kg" : "kg"}</span>
      <input class="num reps-input" type="text" inputmode="numeric" placeholder="0" value="${set.reps ?? ""}" aria-label="Wiederholungen Satz ${index + 1}" />
      <span class="unit">wdh</span>
      <input class="note note-input" type="text" placeholder="Notiz" value="${set.note ? set.note.replace(/"/g, "&quot;") : ""}" aria-label="Notiz Satz ${index + 1}" />
      <button class="mic mic-btn" title="Spracheingabe" aria-label="Spracheingabe">${ICON_MIC}</button>
      ${total > 1 ? `<button class="del del-set-btn" title="Satz löschen" aria-label="Satz löschen">×</button>` : ""}
    `;
    return row;
  }

  function ensureExerciseEntry(exerciseId) {
    const session = getOrCreateTodaySession(currentSplitId);
    if (!session.exerciseData[exerciseId]) {
      session.exerciseData[exerciseId] = { sets: [{ weight: null, reps: null, note: "" }] };
    }
    return session.exerciseData[exerciseId];
  }

  function updateOneRM(card, ex, sets) {
    if (ex.bodyweight) { $(".oneRM", card).textContent = ""; return; }
    const best = sets.reduce((acc, s) => {
      if (s.weight === null || s.reps === null || s.reps <= 0) return acc;
      const oneRm = s.weight * (1 + s.reps / 30);
      return oneRm > acc ? oneRm : acc;
    }, 0);
    $(".oneRM", card).textContent = best > 0 ? "geschätztes 1RM: " + fmtWeight(Math.round(best * 10) / 10) + " kg" : "";
  }

  function bindExerciseListEvents() {
    $$(".weight-input").forEach((el) => el.addEventListener("input", onSetInput));
    $$(".reps-input").forEach((el) => el.addEventListener("input", onSetInput));
    $$(".note-input").forEach((el) => el.addEventListener("input", onSetInput));
    $$(".add-set-btn").forEach((el) => el.addEventListener("click", onAddSet));
    $$(".del-set-btn").forEach((el) => el.addEventListener("click", onDelSet));
    $$(".remove-ex-btn").forEach((el) => el.addEventListener("click", onRemoveExercise));
    $$(".mic-btn").forEach((el) => el.addEventListener("click", onMicClick));
    $$(".timer-btn").forEach((el) => el.addEventListener("click", () => startRestTimer(parseInt(el.dataset.timer, 10))));
  }

  function onSetInput(e) {
    const row = e.target.closest(".set-row");
    const exId = row.dataset.exId;
    const idx = parseInt(row.dataset.index, 10);
    const entry = ensureExerciseEntry(exId);
    while (entry.sets.length <= idx) entry.sets.push({ weight: null, reps: null, note: "" });
    entry.sets[idx].weight = parseNum($(".weight-input", row).value);
    entry.sets[idx].reps = parseNum($(".reps-input", row).value);
    entry.sets[idx].note = $(".note-input", row).value;
    saveData();
    const card = row.closest(".exercise-card");
    const ex = allExercises().find((x) => x.id === exId);
    updateOneRM(card, ex, entry.sets);
  }

  function onAddSet(e) {
    const exId = e.target.dataset.ex;
    const entry = ensureExerciseEntry(exId);
    entry.sets.push({ weight: null, reps: null, note: "" });
    saveData();
    renderExerciseList();
  }

  function onDelSet(e) {
    const row = e.target.closest(".set-row");
    const exId = row.dataset.exId;
    const idx = parseInt(row.dataset.index, 10);
    const session = getOrCreateTodaySession(currentSplitId);
    const entry = session.exerciseData[exId];
    if (entry) {
      entry.sets.splice(idx, 1);
      if (!entry.sets.length) delete session.exerciseData[exId];
    }
    saveData();
    renderExerciseList();
  }

  function onRemoveExercise(e) {
    const exId = e.target.dataset.ex;
    const split = getSplit(currentSplitId);
    const ex = split.exercises.find((x) => x.id === exId);
    if (!ex) return;
    if (!confirm(`"${ex.name}" aus ${split.name} entfernen? Bisherige Werte bleiben in der Historie erhalten.`)) return;
    split.exercises = split.exercises.filter((x) => x.id !== exId);
    saveData();
    renderExerciseList();
  }

  function onMicClick(e) {
    const row = e.target.closest(".set-row");
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      alert("Spracheingabe wird von diesem Browser nicht unterstützt.");
      return;
    }
    const rec = new Recognition();
    rec.lang = "de-DE";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    const micBtn = e.target.closest("button");
    micBtn.textContent = "...";
    const reset = () => { micBtn.innerHTML = ICON_MIC; };
    rec.onresult = (ev) => {
      const transcript = ev.results[0][0].transcript;
      const numbers = (transcript.match(/\d+[.,]?\d*/g) || []).map((n) => n.replace(",", "."));
      if (numbers[0] !== undefined) $(".weight-input", row).value = numbers[0];
      if (numbers[1] !== undefined) $(".reps-input", row).value = numbers[1];
      $(".weight-input", row).dispatchEvent(new Event("input"));
      reset();
    };
    rec.onerror = reset;
    rec.onend = reset;
    rec.start();
  }

  function onAddExercise() {
    openModal(`
      <h3>Übung hinzufügen</h3>
      <input id="new-ex-name" type="text" placeholder="Name der Übung" />
      <label style="font-size:12.5px;color:var(--text-secondary);display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <input type="checkbox" id="new-ex-bw" style="width:auto;margin:0;" /> Reps-basiert / Bodyweight (z. B. Klimmzüge)
      </label>
      <div class="modal-actions">
        <button class="ghost-btn" id="modal-cancel">Abbrechen</button>
        <button class="primary-btn" id="modal-save">Hinzufügen</button>
      </div>
    `);
    $("#modal-cancel").addEventListener("click", closeModal);
    $("#modal-save").addEventListener("click", () => {
      const name = $("#new-ex-name").value.trim();
      if (!name) return;
      const bw = $("#new-ex-bw").checked;
      getSplit(currentSplitId).exercises.push({ id: uid(), name, bodyweight: bw });
      saveData();
      closeModal();
      renderExerciseList();
    });
  }

  function onRepeatLast() {
    const prev = getPreviousSession(currentSplitId, todayStr());
    if (!prev) { alert("Kein früheres Training für diesen Split gefunden."); return; }
    const today = getOrCreateTodaySession(currentSplitId);
    Object.keys(prev.exerciseData).forEach((exId) => {
      const src = prev.exerciseData[exId];
      today.exerciseData[exId] = { sets: src.sets.map((s) => ({ weight: s.weight, reps: s.reps, note: "" })) };
    });
    saveData();
    renderExerciseList();
  }

  /* ================= rest timer ================= */
  function startRestTimer(seconds) {
    clearInterval(restInterval);
    let remaining = seconds;
    const widget = $("#rest-timer");
    widget.classList.remove("hidden");
    const update = () => {
      const m = String(Math.floor(remaining / 60)).padStart(2, "0");
      const s = String(remaining % 60).padStart(2, "0");
      $("#rest-time").textContent = `${m}:${s}`;
    };
    update();
    restInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(restInterval);
        widget.classList.add("hidden");
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        return;
      }
      update();
    }, 1000);
  }

  /* ================= dashboard ================= */
  function renderDashboard() {
    const exercises = allExercises();
    const trends = exercises.map((ex) => ({ ex, trend: trendForExercise(ex.id) })).filter((t) => t.trend);
    const up = trends.filter((t) => t.trend.dir === "up");
    const flat = trends.filter((t) => t.trend.dir === "flat");

    $("#stat-up").textContent = up.length;
    $("#stat-flat").textContent = flat.length;

    // streak: distinct trained days in last 7 days
    const last7 = new Set();
    state.sessions.forEach((s) => {
      if (hasRealData(s) && s.date >= daysAgoStr(6)) last7.add(s.date);
    });
    $("#stat-streak").textContent = last7.size;

    // PRs this month
    const thisMonth = todayStr().slice(0, 7);
    let prCount = 0;
    exercises.forEach((ex) => {
      const list = sessionsForExercise(ex.id);
      if (list.length < 2) return;
      const values = list.map((l) => topValue(l.entry, ex.bodyweight));
      const maxAll = Math.max(...values);
      const lastEntry = list[list.length - 1];
      if (lastEntry.date.slice(0, 7) === thisMonth && topValue(lastEntry.entry, ex.bodyweight) === maxAll) prCount++;
    });
    $("#stat-prs").textContent = prCount;

    // analysis text
    $("#analysis-text").textContent = buildAnalysisText(trends, up, flat);

    // heatmap
    const heatmap = $("#streak-heatmap");
    heatmap.innerHTML = "";
    const trainedDates = new Set(state.sessions.filter(hasRealData).map((s) => s.date));
    for (let i = 27; i >= 0; i--) {
      const d = daysAgoStr(i);
      const cell = document.createElement("div");
      cell.className = "day" + (trainedDates.has(d) ? " trained" : "");
      cell.title = d;
      heatmap.appendChild(cell);
    }

    // trend list
    const trendList = $("#trend-list");
    trendList.innerHTML = "";
    if (!trends.length) {
      trendList.innerHTML = `<p class="muted small">Noch nicht genug Daten — trainiere mindestens zweimal dieselbe Übung.</p>`;
    } else {
      trends
        .sort((a, b) => (b.trend.dir === "up") - (a.trend.dir === "up"))
        .forEach(({ ex, trend }) => {
          const list = sessionsForExercise(ex.id);
          const last = topValue(list[list.length - 1].entry, ex.bodyweight);
          const prev = topValue(list[list.length - 2].entry, ex.bodyweight);
          const unit = ex.bodyweight ? "Wdh" : "kg";
          const row = document.createElement("div");
          row.className = "trend-row";
          row.innerHTML = `
            <span>${ex.name}</span>
            <span class="trend-value">${fmtWeight(prev)} → ${fmtWeight(last)} ${unit}
              <span>${trend.dir === "up" ? "↑" : trend.dir === "down" ? "↓" : "–"}</span>
            </span>`;
          trendList.appendChild(row);
        });
    }

    // PR list
    const prList = $("#pr-list");
    prList.innerHTML = "";
    const withData = exercises.filter((ex) => sessionsForExercise(ex.id).length > 0);
    if (!withData.length) {
      prList.innerHTML = `<p class="muted small">Noch keine Rekorde erfasst.</p>`;
    } else {
      withData.forEach((ex) => {
        const list = sessionsForExercise(ex.id);
        const values = list.map((l) => ({ date: l.date, v: topValue(l.entry, ex.bodyweight) }));
        const best = values.reduce((a, b) => (b.v > a.v ? b : a));
        const unit = ex.bodyweight ? "Wdh" : "kg";
        const row = document.createElement("div");
        row.className = "pr-row";
        row.innerHTML = `<span>${ex.name}</span><span class="pr-badge">${fmtWeight(best.v)} ${unit} · ${best.date}</span>`;
        prList.appendChild(row);
      });
    }

    // volume chart selector
    const select = $("#volume-exercise-select");
    const prevSelected = select.value;
    select.innerHTML = withData
      .map((ex) => `<option value="${ex.id}">${ex.splitName} — ${ex.name}</option>`)
      .join("");
    if (withData.length) {
      select.value = withData.some((e) => e.id === prevSelected) ? prevSelected : withData[0].id;
      drawVolumeChart(select.value);
    }
    select.onchange = () => drawVolumeChart(select.value);
  }

  function buildAnalysisText(trends, up, flat) {
    if (!trends.length) return "Sammle noch Daten — trainiere jede Übung mindestens zweimal, um Trends und Analysen zu sehen.";
    const parts = [];
    if (up.length) {
      const best = up.reduce((a, b) => (b.trend.delta > a.trend.delta ? b : a));
      parts.push(`${best.ex.name} zeigt die stärkste Steigerung (+${fmtWeight(best.trend.delta)} ${best.ex.bodyweight ? "Wdh" : "kg"}).`);
    }
    if (flat.length) {
      const names = flat.slice(0, 2).map((f) => f.ex.name).join(" und ");
      parts.push(`${names} stagniert seit der letzten Einheit — Zeit für mehr Wiederholungen oder mehr Gewicht.`);
    }
    if (!parts.length) parts.push("Alle Werte gehen leicht zurück — ausreichend Erholung und Ernährung prüfen.");
    return parts.join(" ");
  }

  function drawLineChart(canvas, values, labels) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (values.length < 2) {
      ctx.fillStyle = "#9a9a96";
      ctx.font = "12px sans-serif";
      ctx.fillText("Noch nicht genug Daten", 8, h / 2);
      return;
    }
    const pad = 10;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = (w - pad * 2) / (values.length - 1);
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "#111111";
    values.forEach((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawVolumeChart(exerciseId) {
    const ex = allExercises().find((e) => e.id === exerciseId);
    if (!ex) return;
    const list = sessionsForExercise(exerciseId);
    const values = list.map((l) => topValue(l.entry, ex.bodyweight));
    drawLineChart($("#volume-chart"), values);
  }

  /* ================= protein ================= */
  function todayProteinEntry() {
    let day = state.protein.find((p) => p.date === todayStr());
    if (!day) { day = { date: todayStr(), entries: [] }; state.protein.push(day); }
    return day;
  }

  function renderProtein() {
    const goal = state.settings.proteinGoal;
    const day = todayProteinEntry();
    const current = day.entries.reduce((sum, e) => sum + e.amount, 0);
    $("#protein-current").textContent = Math.round(current);
    $("#protein-goal").textContent = goal;
    const remaining = goal - current;
    $("#protein-remaining").textContent = remaining > 0 ? `noch ${Math.round(remaining)} g bis zum Ziel` : "Ziel erreicht";

    const ring = $("#protein-ring");
    const ctx = ring.getContext("2d");
    ctx.clearRect(0, 0, 72, 72);
    const pct = Math.max(0, Math.min(1, current / goal));
    ctx.strokeStyle = "#ececea";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(36, 36, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#111111";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(36, 36, 28, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();

    const list = $("#protein-log-list");
    list.innerHTML = "";
    if (!day.entries.length) {
      list.innerHTML = `<p class="muted small">Heute noch nichts erfasst.</p>`;
    } else {
      day.entries.forEach((entry, i) => {
        const row = document.createElement("div");
        row.className = "protein-entry";
        row.innerHTML = `<span>${entry.time}</span><span>${Math.round(entry.amount)} g</span><button class="icon-btn" data-i="${i}" aria-label="Eintrag löschen" style="width:26px;height:26px;font-size:12px;">×</button>`;
        row.querySelector("button").addEventListener("click", () => {
          day.entries.splice(i, 1);
          saveData();
          renderProtein();
        });
        list.appendChild(row);
      });
    }

    const last14 = [];
    for (let i = 13; i >= 0; i--) {
      const d = daysAgoStr(i);
      const rec = state.protein.find((p) => p.date === d);
      const sum = rec ? rec.entries.reduce((s, e) => s + e.amount, 0) : 0;
      last14.push(sum);
    }
    drawLineChart($("#protein-history-chart"), last14);
  }

  function addProtein(amount) {
    const day = todayProteinEntry();
    const now = new Date();
    day.entries.push({ amount, time: now.toTimeString().slice(0, 5) });
    saveData();
    renderProtein();
  }

  /* ================= bodyweight ================= */
  function sortedWeightEntries() {
    return [...state.bodyweight].sort((a, b) => (a.date > b.date ? 1 : -1));
  }

  function renderWeight() {
    const list = sortedWeightEntries();
    const todayEntry = state.bodyweight.find((w) => w.date === todayStr());
    $("#weight-input").value = todayEntry ? String(todayEntry.value).replace(".", ",") : "";

    const current = list.length ? list[list.length - 1].value : null;
    $("#weight-current").textContent = current !== null ? fmtWeight(current) : "-";

    const pill = $("#weight-trend-pill");
    const trendEl = $("#weight-trend");
    if (list.length >= 2) {
      const prev = list[list.length - 2].value;
      const delta = current - prev;
      pill.textContent = (delta > 0 ? "↑ " : delta < 0 ? "↓ " : "– ") + fmtWeight(Math.abs(delta)) + " kg";
      pill.classList.toggle("up", delta !== 0);
      trendEl.textContent = "seit letztem Eintrag (" + list[list.length - 2].date + ")";
    } else {
      pill.textContent = "";
      trendEl.textContent = list.length ? "Noch zu wenige Einträge für einen Trend" : "Trage dein Gewicht ein, um den Verlauf zu sehen";
    }

    const last30 = [];
    for (let i = 29; i >= 0; i--) {
      const d = daysAgoStr(i);
      const rec = state.bodyweight.find((w) => w.date === d);
      if (rec) last30.push(rec.value);
    }
    drawLineChart($("#weight-history-chart"), last30);

    const logList = $("#weight-log-list");
    logList.innerHTML = "";
    const recent = [...list].reverse().slice(0, 10);
    if (!recent.length) {
      logList.innerHTML = `<p class="muted small">Noch keine Einträge.</p>`;
    } else {
      recent.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "protein-entry";
        row.innerHTML = `<span>${entry.date}</span><span>${fmtWeight(entry.value)} kg</span><button class="icon-btn" aria-label="Eintrag löschen" style="width:26px;height:26px;font-size:12px;">×</button>`;
        row.querySelector("button").addEventListener("click", () => {
          state.bodyweight = state.bodyweight.filter((w) => w.date !== entry.date);
          saveData();
          renderWeight();
        });
        logList.appendChild(row);
      });
    }
  }

  function saveWeightEntry() {
    const v = parseNum($("#weight-input").value);
    if (v === null) return;
    const existing = state.bodyweight.find((w) => w.date === todayStr());
    if (existing) existing.value = v;
    else state.bodyweight.push({ date: todayStr(), value: v });
    saveData();
    renderWeight();
  }

  /* ================= modal ================= */
  function openModal(html) {
    const root = $("#modal-root");
    root.innerHTML = `<div class="modal-backdrop"><div class="modal-sheet">${html}</div></div>`;
    root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) closeModal();
    });
  }
  function closeModal() { $("#modal-root").innerHTML = ""; }

  function onMenuClick() {
    openModal(`
      <h3>Menü</h3>
      <div class="modal-actions" style="flex-direction:column;">
        <button class="ghost-btn full" id="m-goal">Eiweiß-Ziel ändern</button>
        <button class="ghost-btn full" id="m-export-csv">Trainingsdaten als CSV exportieren</button>
        <button class="ghost-btn full" id="m-export-json">Backup exportieren (JSON)</button>
        <button class="ghost-btn full" id="m-import-json">Backup wiederherstellen</button>
        <input type="file" id="m-import-input" accept="application/json" class="hidden" />
        <button class="ghost-btn full" id="m-delete-split">Aktuellen Split löschen</button>
        <button class="ghost-btn full" id="m-close">Schließen</button>
      </div>
    `);
    $("#m-close").addEventListener("click", closeModal);
    $("#m-goal").addEventListener("click", () => {
      openModal(`
        <h3>Eiweiß-Ziel</h3>
        <input id="goal-input" type="text" inputmode="numeric" value="${state.settings.proteinGoal}" />
        <div class="modal-actions">
          <button class="ghost-btn" id="modal-cancel">Abbrechen</button>
          <button class="primary-btn" id="modal-save">Speichern</button>
        </div>
      `);
      $("#modal-cancel").addEventListener("click", closeModal);
      $("#modal-save").addEventListener("click", () => {
        const v = parseNum($("#goal-input").value);
        if (v) state.settings.proteinGoal = v;
        saveData();
        closeModal();
        renderProtein();
      });
    });
    $("#m-export-csv").addEventListener("click", exportCsv);
    $("#m-export-json").addEventListener("click", exportJson);
    $("#m-import-json").addEventListener("click", () => $("#m-import-input").click());
    $("#m-import-input").addEventListener("change", importJson);
    $("#m-delete-split").addEventListener("click", onDeleteCurrentSplit);
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const rows = [["Datum", "Split", "Übung", "Satz", "Gewicht", "Wiederholungen", "Notiz"]];
    state.sessions.forEach((s) => {
      const split = getSplit(s.splitId);
      Object.keys(s.exerciseData || {}).forEach((exId) => {
        const ex = split ? split.exercises.find((e) => e.id === exId) : null;
        const name = ex ? ex.name : exId;
        s.exerciseData[exId].sets.forEach((set, i) => {
          rows.push([s.date, split ? split.name : s.splitId, name, i + 1, set.weight ?? "", set.reps ?? "", (set.note || "").replace(/,/g, ";")]);
        });
      });
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    download("gymlog-export.csv", csv, "text/csv");
    closeModal();
  }

  function exportJson() {
    download("gymlog-backup.json", JSON.stringify(state, null, 2), "application/json");
    closeModal();
  }

  function importJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!confirm("Aktuelle Daten werden überschrieben. Fortfahren?")) return;
        state = parsed;
        saveData();
        currentSplitId = state.splits[0].id;
        closeModal();
        render();
      } catch (err) {
        alert("Datei konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
  }

  /* ================= view switching ================= */
  function switchView(view) {
    currentView = view;
    ["workout", "dashboard", "protein", "weight"].forEach((v) => {
      $("#view-" + v).classList.toggle("hidden", v !== view);
    });
    $$("#bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $("#split-tabs").classList.toggle("hidden", view !== "workout");
    if (view === "dashboard") renderDashboard();
    if (view === "protein") renderProtein();
    if (view === "weight") renderWeight();
  }

  function render() {
    renderTabs();
    if (currentView === "workout") renderExerciseList();
    if (currentView === "dashboard") renderDashboard();
    if (currentView === "protein") renderProtein();
    if (currentView === "weight") renderWeight();
  }

  /* ================= init ================= */
  function init() {
    $$("#bottom-nav button").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
    $("#add-exercise-btn").addEventListener("click", onAddExercise);
    $("#repeat-last-btn").addEventListener("click", onRepeatLast);
    $("#menu-btn").addEventListener("click", onMenuClick);
    $$(".quick-add-grid [data-add-protein]").forEach((btn) =>
      btn.addEventListener("click", () => addProtein(parseInt(btn.dataset.addProtein, 10)))
    );
    $("#protein-custom-btn").addEventListener("click", () => {
      openModal(`
        <h3>Eiweiß hinzufügen</h3>
        <input id="protein-custom-input" type="text" inputmode="numeric" placeholder="Gramm" />
        <div class="modal-actions">
          <button class="ghost-btn" id="modal-cancel">Abbrechen</button>
          <button class="primary-btn" id="modal-save">Hinzufügen</button>
        </div>
      `);
      $("#modal-cancel").addEventListener("click", closeModal);
      $("#modal-save").addEventListener("click", () => {
        const v = parseNum($("#protein-custom-input").value);
        if (v) addProtein(v);
        closeModal();
      });
    });
    $("#weight-save-btn").addEventListener("click", saveWeightEntry);
    $("#rest-stop").addEventListener("click", () => {
      clearInterval(restInterval);
      $("#rest-timer").classList.add("hidden");
    });

    render();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch(() => {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
