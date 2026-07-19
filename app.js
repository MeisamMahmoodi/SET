(function () {
  "use strict";

  const ICON_MIC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>';
  const ICON_TIMER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l3 2"></path><path d="M9 2h6"></path></svg>';

  const cfg = window.GYMLOG_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: "gymlog-auth"
    }
  });

  let state = {
    splits: [], sessions: [], protein: [], bodyweight: [], nutrition: [],
    settings: { proteinGoal: 150, calorieGoal: 2200, carbsGoal: 250, fatGoal: 70 }
  };
  let currentUser = null;
  let currentSplitId = null;
  let currentView = "dashboard";
  let restInterval = null;
  let trendExpanded = false;
  let prExpanded = false;
  let expandedExerciseId = null;
  let dashboardTab = "trend";
  let nutritionDetailMacro = null;

  const MACRO_CONFIG = {
    protein: { label: "Protein", unit: "g", goalKey: "proteinGoal", showQuickAdd: true },
    carbs: { label: "Carbs", unit: "g", goalKey: "carbsGoal", showQuickAdd: false },
    fat: { label: "Fett", unit: "g", goalKey: "fatGoal", showQuickAdd: false },
    calories: { label: "Kalorien", unit: "kcal", goalKey: "calorieGoal", showQuickAdd: false }
  };
  const debounceTimers = {};
  const VIEW_TITLES = { dashboard: "Dashboard", protein: "Ernährung", weight: "Gewicht" };

  /* ================= utils ================= */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
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

  function initials(name) { return name.trim().slice(0, 2).toUpperCase(); }

  function getSplit(splitId) { return state.splits.find((s) => s.id === splitId); }

  function allExercises() {
    const list = [];
    state.splits.forEach((s) => s.exercises.forEach((e) => list.push({ splitId: s.id, splitName: s.name, ...e })));
    return list;
  }

  function showError(msg) { console.error(msg); alert(msg); }

  /* ================= auth ================= */
  function setAuthMode(mode) {
    $$("#auth-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.authMode === mode));
    $("#auth-form").dataset.mode = mode;
    $("#auth-submit").textContent = mode === "signup" ? "Konto erstellen" : "Anmelden";
    $("#auth-password").setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
    $("#auth-hint").textContent = mode === "signup" ? "Falls E-Mail-Bestätigung aktiv ist, prüfe dein Postfach nach dem Registrieren." : "";
    $("#auth-error").classList.add("hidden");
  }

  async function onAuthSubmit(e) {
    e.preventDefault();
    const mode = $("#auth-form").dataset.mode || "signin";
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const btn = $("#auth-submit");
    const errEl = $("#auth-error");
    errEl.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "...";
    try {
      const { data, error } = mode === "signup"
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (mode === "signup" && data.user && !data.session) {
        errEl.classList.remove("hidden");
        errEl.textContent = "Konto erstellt — bitte bestätige deine E-Mail und melde dich dann an.";
        setAuthMode("signin");
      }
    } catch (err) {
      errEl.textContent = translateAuthError(err.message);
      errEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = ($("#auth-form").dataset.mode === "signup") ? "Konto erstellen" : "Anmelden";
    }
  }

  function translateAuthError(msg) {
    if (/already registered/i.test(msg)) return "Diese E-Mail ist schon registriert — melde dich stattdessen an.";
    if (/invalid login/i.test(msg)) return "E-Mail oder Passwort ist falsch.";
    if (/password/i.test(msg) && /least/i.test(msg)) return "Das Passwort muss mindestens 6 Zeichen lang sein.";
    return msg;
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  /* ================= data loading ================= */
  async function fetchAllData() {
    const uid = currentUser.id;
    const [splitsRes, exercisesRes, sessionsRes, sedRes, proteinRes, bwRes, nutritionRes, settingsRes] = await Promise.all([
      sb.from("splits").select("*").eq("archived", false).order("position"),
      sb.from("exercises").select("*").eq("archived", false).order("position"),
      sb.from("sessions").select("*"),
      sb.from("session_exercise_data").select("*"),
      sb.from("protein_entries").select("*").order("created_at"),
      sb.from("bodyweight_entries").select("*"),
      sb.from("nutrition_entries").select("*").order("created_at"),
      sb.from("user_settings").select("*").eq("user_id", uid).maybeSingle()
    ]);
    for (const res of [splitsRes, exercisesRes, sessionsRes, sedRes, proteinRes, bwRes, nutritionRes, settingsRes]) {
      if (res.error) throw res.error;
    }

    const exercisesBySplit = {};
    exercisesRes.data.forEach((e) => {
      (exercisesBySplit[e.split_id] = exercisesBySplit[e.split_id] || []).push({
        id: e.id, name: e.name, bodyweight: e.bodyweight
      });
    });

    state.splits = splitsRes.data.map((s) => ({ id: s.id, name: s.name, exercises: exercisesBySplit[s.id] || [] }));

    const sessionsById = {};
    state.sessions = sessionsRes.data.map((s) => {
      const obj = { id: s.id, splitId: s.split_id, date: s.date, exerciseData: {} };
      sessionsById[s.id] = obj;
      return obj;
    });
    sedRes.data.forEach((row) => {
      const session = sessionsById[row.session_id];
      if (!session) return;
      session.exerciseData[row.exercise_id] = { sets: row.sets || [], _rowId: row.id };
    });

    const proteinByDate = {};
    proteinRes.data.forEach((row) => {
      const day = (proteinByDate[row.date] = proteinByDate[row.date] || { date: row.date, entries: [] });
      day.entries.push({ id: row.id, amount: Number(row.amount), time: row.entry_time || "" });
    });
    state.protein = Object.values(proteinByDate);

    state.bodyweight = bwRes.data.map((row) => ({ id: row.id, date: row.date, value: Number(row.value) }));

    state.nutrition = nutritionRes.data.map((row) => ({
      id: row.id, date: row.date, foodName: row.food_name, brand: row.brand,
      quantity: Number(row.quantity), quantityUnit: row.quantity_unit, servingLabel: row.serving_label,
      grams: row.grams !== null && row.grams !== undefined ? Number(row.grams) : null,
      calories: Number(row.calories), protein: Number(row.protein), carbs: Number(row.carbs), fat: Number(row.fat),
      time: row.entry_time || ""
    }));

    state.settings.proteinGoal = settingsRes.data ? Number(settingsRes.data.protein_goal) : 150;
    state.settings.calorieGoal = settingsRes.data ? Number(settingsRes.data.calorie_goal) : 2200;
    state.settings.carbsGoal = settingsRes.data ? Number(settingsRes.data.carbs_goal) : 250;
    state.settings.fatGoal = settingsRes.data ? Number(settingsRes.data.fat_goal) : 70;

    if (!currentSplitId || !getSplit(currentSplitId)) {
      currentSplitId = state.splits.length ? state.splits[0].id : null;
    }
  }

  /* ================= sessions (server-backed) ================= */
  async function ensureTodaySessionId(splitId) {
    let session = state.sessions.find((s) => s.splitId === splitId && s.date === todayStr());
    if (session) return session.id;
    const { data, error } = await sb.from("sessions")
      .upsert({ user_id: currentUser.id, split_id: splitId, date: todayStr() }, { onConflict: "user_id,split_id,date" })
      .select().single();
    if (error) { showError(error.message); throw error; }
    session = { id: data.id, splitId: data.split_id, date: data.date, exerciseData: {} };
    state.sessions.push(session);
    return session.id;
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

  function isEntryReal(entry) {
    return !!(entry && entry.sets && entry.sets.some((s) => s.weight !== null || s.reps !== null));
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
    const vals = entry.sets.map((s) => (bodyweight ? s.reps : s.weight)).filter((v) => v !== null && v !== undefined);
    if (!vals.length) return null;
    return Math.max(...vals);
  }

  async function persistSets(exerciseId, sets) {
    const split = getSplit(currentSplitId);
    const sessionId = await ensureTodaySessionId(currentSplitId);
    const { data, error } = await sb.from("session_exercise_data")
      .upsert({ user_id: currentUser.id, session_id: sessionId, exercise_id: exerciseId, sets }, { onConflict: "session_id,exercise_id" })
      .select().single();
    if (error) { showError(error.message); return; }
    const session = state.sessions.find((s) => s.id === sessionId);
    session.exerciseData[exerciseId] = { sets: data.sets, _rowId: data.id };
  }

  function schedulePersist(exerciseId, sets) {
    clearTimeout(debounceTimers[exerciseId]);
    debounceTimers[exerciseId] = setTimeout(() => persistSets(exerciseId, sets), 500);
  }

  async function deleteSetRow(exerciseId) {
    const sessionId = await ensureTodaySessionId(currentSplitId);
    const session = state.sessions.find((s) => s.id === sessionId);
    const entry = session.exerciseData[exerciseId];
    if (entry && entry._rowId) {
      await sb.from("session_exercise_data").delete().eq("id", entry._rowId);
    }
    delete session.exerciseData[exerciseId];
  }

  /* ================= tabs / splits ================= */
  function renderTabs() {
    const nav = $("#split-tabs");
    nav.innerHTML = "";
    state.splits.forEach((s) => {
      const btn = document.createElement("button");
      btn.textContent = s.name;
      if (s.id === currentSplitId) btn.classList.add("active");
      btn.addEventListener("click", () => {
        currentSplitId = s.id;
        expandedExerciseId = null;
        nav.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderExerciseList();
      });
      nav.appendChild(btn);
    });
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "Eigenen Split erstellen";
    addBtn.setAttribute("aria-label", "Eigenen Split erstellen");
    addBtn.style.flex = "0 0 auto";
    addBtn.style.padding = "9px 14px";
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
    $("#modal-save").addEventListener("click", async () => {
      const name = $("#new-split-name").value.trim();
      if (!name) return;
      const { data, error } = await sb.from("splits")
        .insert({ user_id: currentUser.id, name, position: state.splits.length })
        .select().single();
      if (error) { showError(error.message); return; }
      state.splits.push({ id: data.id, name: data.name, exercises: [] });
      currentSplitId = data.id;
      closeModal();
      renderTabs();
      renderExerciseList();
    });
  }

  async function onDeleteCurrentSplit() {
    if (state.splits.length <= 1) {
      alert("Das ist dein letzter Split — lege zuerst einen neuen an, bevor du diesen löschst.");
      return;
    }
    const split = getSplit(currentSplitId);
    if (!confirm(`Split "${split.name}" wirklich löschen? Bereits geloggte Trainingsdaten bleiben in der Historie erhalten.`)) return;
    const { error } = await sb.from("splits").update({ archived: true }).eq("id", currentSplitId);
    if (error) { showError(error.message); return; }
    state.splits = state.splits.filter((s) => s.id !== currentSplitId);
    currentSplitId = state.splits[0].id;
    closeModal();
    renderTabs();
    renderExerciseList();
  }

  /* ================= workout view ================= */
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
    $("#today-label").textContent = fmtDateLabel(todayStr());
    const container = $("#exercise-list");

    if (!state.splits.length) {
      if (currentView === "workout") $("#page-title").textContent = "Training";
      $("#empty-splits-state").classList.remove("hidden");
      $("#empty-exercises-state").classList.add("hidden");
      container.innerHTML = "";
      $("#add-exercise-btn").classList.add("hidden");
      $("#repeat-last-btn").classList.add("hidden");
      return;
    }
    $("#empty-splits-state").classList.add("hidden");

    const split = getSplit(currentSplitId);
    if (!split) return;
    if (currentView === "workout") $("#page-title").textContent = split.name + " day";
    $("#add-exercise-btn").classList.remove("hidden");

    if (!split.exercises.length) {
      $("#empty-exercises-state").classList.remove("hidden");
      $("#repeat-last-btn").classList.add("hidden");
      container.innerHTML = "";
      return;
    }
    $("#empty-exercises-state").classList.add("hidden");
    $("#repeat-last-btn").classList.remove("hidden");

    const session = state.sessions.find((s) => s.splitId === currentSplitId && s.date === todayStr());
    container.innerHTML = "";

    const doneFlags = split.exercises.map((ex) => isEntryReal(session && session.exerciseData[ex.id]));
    const doneCount = doneFlags.filter(Boolean).length;
    container.insertAdjacentHTML("beforeend", buildProgressCardHtml(doneCount, split.exercises.length));

    split.exercises.forEach((ex, i) => {
      const entry = session && session.exerciseData[ex.id];
      const sets = (entry && entry.sets && entry.sets.length) ? entry.sets : [{ weight: null, reps: null, note: "" }];
      const trend = trendForExercise(ex.id);
      const last = sessionsForExercise(ex.id).filter((s) => s.date < todayStr()).slice(-1)[0];
      const lastVal = last ? topValue(last.entry, ex.bodyweight) : null;
      const done = doneFlags[i];

      if (expandedExerciseId !== ex.id) {
        const todayVal = done ? topValue(entry, ex.bodyweight) : null;
        const rightText = done
          ? fmtWeight(todayVal) + (ex.bodyweight ? " Wdh" : " kg") + " ✓"
          : (lastVal !== null ? "letztes Mal " + fmtWeight(lastVal) + (ex.bodyweight ? " Wdh" : " kg") : "noch keine Daten");
        const row = document.createElement("div");
        row.className = "exercise-row card" + (done ? " done" : "");
        row.dataset.ex = ex.id;
        row.innerHTML = `<span class="er-name">${ex.name}</span><span class="er-value">${rightText}</span>`;
        row.addEventListener("click", () => { expandedExerciseId = ex.id; renderExerciseList(); });
        container.appendChild(row);
        return;
      }

      const card = document.createElement("div");
      card.className = "exercise-card card";
      card.innerHTML = `
        <div class="exercise-head">
          <div class="name-block">
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
        <div class="exercise-card-footer">
          <button class="ghost-btn small add-set-btn" data-ex="${ex.id}">+ Satz</button>
          <button class="primary-btn small collapse-ex-btn" data-ex="${ex.id}">Fertig</button>
        </div>
        <div class="oneRM"></div>
      `;
      const setsWrap = $(".sets", card);
      sets.forEach((set, idx) => setsWrap.appendChild(renderSetRow(ex, idx, set, sets.length)));
      updateOneRM(card, ex, sets);
      container.appendChild(card);
    });

    bindExerciseListEvents();
  }

  function buildProgressCardHtml(done, total) {
    if (!total) return "";
    const segments = Array.from({ length: total }, (_, i) => `<span class="progress-seg${i < done ? " filled" : ""}"></span>`).join("");
    const label = done === total ? "Training komplett" : `${done} von ${total} Übungen erledigt`;
    return `
      <div class="workout-progress-card">
        <div class="wp-bar">${segments}</div>
        <p class="wp-label">${label}</p>
      </div>
    `;
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
      <input class="note note-input" type="text" placeholder="Notiz" value="${set.note ? String(set.note).replace(/"/g, "&quot;") : ""}" aria-label="Notiz Satz ${index + 1}" />
      <button class="mic mic-btn" title="Spracheingabe" aria-label="Spracheingabe">${ICON_MIC}</button>
      ${total > 1 ? `<button class="del del-set-btn" title="Satz löschen" aria-label="Satz löschen">×</button>` : ""}
    `;
    return row;
  }

  function localEntry(exerciseId) {
    const session = state.sessions.find((s) => s.splitId === currentSplitId && s.date === todayStr());
    if (session && session.exerciseData[exerciseId]) return session.exerciseData[exerciseId];
    return null;
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
    $$(".collapse-ex-btn").forEach((el) => el.addEventListener("click", () => { expandedExerciseId = null; renderExerciseList(); }));
  }

  function currentSetsInDom(exId) {
    const rows = $$(`.set-row[data-ex-id="${exId}"]`);
    return rows.map((row) => ({
      weight: parseNum($(".weight-input", row).value),
      reps: parseNum($(".reps-input", row).value),
      note: $(".note-input", row).value
    }));
  }

  function onSetInput(e) {
    const row = e.target.closest(".set-row");
    const exId = row.dataset.exId;
    const sets = currentSetsInDom(exId);
    const card = row.closest(".exercise-card");
    const ex = allExercises().find((x) => x.id === exId);
    updateOneRM(card, ex, sets);
    schedulePersist(exId, sets);
  }

  async function onAddSet(e) {
    const exId = e.target.dataset.ex;
    const existing = localEntry(exId);
    const sets = existing ? existing.sets.slice() : [{ weight: null, reps: null, note: "" }];
    sets.push({ weight: null, reps: null, note: "" });
    await ensureTodaySessionId(currentSplitId);
    const session = state.sessions.find((s) => s.splitId === currentSplitId && s.date === todayStr());
    session.exerciseData[exId] = { sets, _rowId: existing ? existing._rowId : null };
    renderExerciseList();
    persistSets(exId, sets);
  }

  async function onDelSet(e) {
    const row = e.target.closest(".set-row");
    const exId = row.dataset.exId;
    const idx = parseInt(row.dataset.index, 10);
    const sets = currentSetsInDom(exId);
    sets.splice(idx, 1);
    if (!sets.length) {
      await deleteSetRow(exId);
    } else {
      await persistSets(exId, sets);
    }
    renderExerciseList();
  }

  async function onRemoveExercise(e) {
    const exId = e.target.dataset.ex;
    const split = getSplit(currentSplitId);
    const ex = split.exercises.find((x) => x.id === exId);
    if (!ex) return;
    if (!confirm(`"${ex.name}" aus ${split.name} entfernen? Bisherige Werte bleiben in der Historie erhalten.`)) return;
    const { error } = await sb.from("exercises").update({ archived: true }).eq("id", exId);
    if (error) { showError(error.message); return; }
    split.exercises = split.exercises.filter((x) => x.id !== exId);
    if (expandedExerciseId === exId) expandedExerciseId = null;
    renderExerciseList();
  }

  function onMicClick(e) {
    const row = e.target.closest(".set-row");
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { alert("Spracheingabe wird von diesem Browser nicht unterstützt."); return; }
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
    $("#modal-save").addEventListener("click", async () => {
      const name = $("#new-ex-name").value.trim();
      if (!name) return;
      const bw = $("#new-ex-bw").checked;
      const split = getSplit(currentSplitId);
      const { data, error } = await sb.from("exercises")
        .insert({ user_id: currentUser.id, split_id: currentSplitId, name, bodyweight: bw, position: split.exercises.length })
        .select().single();
      if (error) { showError(error.message); return; }
      split.exercises.push({ id: data.id, name: data.name, bodyweight: data.bodyweight });
      expandedExerciseId = data.id;
      closeModal();
      renderExerciseList();
    });
  }

  async function onRepeatLast() {
    const prev = getPreviousSession(currentSplitId, todayStr());
    if (!prev) { alert("Kein früheres Training für diesen Split gefunden."); return; }
    await ensureTodaySessionId(currentSplitId);
    const today = state.sessions.find((s) => s.splitId === currentSplitId && s.date === todayStr());
    const exIds = Object.keys(prev.exerciseData);
    for (const exId of exIds) {
      const src = prev.exerciseData[exId];
      const sets = src.sets.map((s) => ({ weight: s.weight, reps: s.reps, note: "" }));
      today.exerciseData[exId] = { sets, _rowId: today.exerciseData[exId] ? today.exerciseData[exId]._rowId : null };
      await persistSets(exId, sets);
    }
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

    const last7 = new Set();
    state.sessions.forEach((s) => { if (hasRealData(s) && s.date >= daysAgoStr(6)) last7.add(s.date); });
    $("#stat-streak").textContent = last7.size;

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

    $("#analysis-text").textContent = buildAnalysisText(trends, up, flat);

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

    const VISIBLE_CAP = 5;
    const splitOrder = state.splits.map((s) => s.id);
    const splitRank = (splitId) => { const i = splitOrder.indexOf(splitId); return i === -1 ? 999 : i; };

    // renders a pre-sorted array of rows, inserting a split-name header whenever the split changes
    function renderGroupedList(container, rows, expanded, cap, getSplitName, buildRowEl, expandLabel, onToggle) {
      container.innerHTML = "";
      const visible = expanded ? rows : rows.slice(0, cap);
      let lastSplit = null;
      visible.forEach((row) => {
        const splitName = getSplitName(row);
        if (splitName !== lastSplit) {
          const header = document.createElement("div");
          header.className = "list-group-label";
          header.textContent = splitName;
          container.appendChild(header);
          lastSplit = splitName;
        }
        container.appendChild(buildRowEl(row));
      });
      if (rows.length > cap) {
        const moreBtn = document.createElement("button");
        moreBtn.className = "ghost-btn small full show-more-btn";
        moreBtn.textContent = expanded ? "Weniger anzeigen" : `Alle ${rows.length} anzeigen`;
        moreBtn.addEventListener("click", onToggle);
        container.appendChild(moreBtn);
      }
    }

    const trendList = $("#trend-list");
    if (!trends.length) {
      trendList.innerHTML = `<p class="muted small">Noch nicht genug Daten — trainiere mindestens zweimal dieselbe Übung.</p>`;
    } else {
      const sortedTrends = [...trends].sort((a, b) => {
        const r = splitRank(a.ex.splitId) - splitRank(b.ex.splitId);
        if (r !== 0) return r;
        return (b.trend.dir === "up") - (a.trend.dir === "up");
      });
      renderGroupedList(
        trendList, sortedTrends, trendExpanded, VISIBLE_CAP,
        (row) => row.ex.splitName,
        ({ ex, trend }) => {
          const list = sessionsForExercise(ex.id);
          const last = topValue(list[list.length - 1].entry, ex.bodyweight);
          const prev = topValue(list[list.length - 2].entry, ex.bodyweight);
          const unit = ex.bodyweight ? "Wdh" : "kg";
          const row = document.createElement("div");
          row.className = "trend-row";
          row.innerHTML = `<span>${ex.name}</span><span class="trend-value">${fmtWeight(prev)} → ${fmtWeight(last)} ${unit} <span>${trend.dir === "up" ? "↑" : trend.dir === "down" ? "↓" : "–"}</span></span>`;
          return row;
        },
        null,
        () => { trendExpanded = !trendExpanded; renderDashboard(); }
      );
    }

    const prList = $("#pr-list");
    const withData = exercises.filter((ex) => sessionsForExercise(ex.id).length > 0);
    if (!withData.length) {
      prList.innerHTML = `<p class="muted small">Noch keine Rekorde erfasst.</p>`;
    } else {
      const prRows = withData.map((ex) => {
        const list = sessionsForExercise(ex.id);
        const values = list.map((l) => ({ date: l.date, v: topValue(l.entry, ex.bodyweight) }));
        const best = values.reduce((a, b) => (b.v > a.v ? b : a));
        return { ex, best };
      }).sort((a, b) => {
        const r = splitRank(a.ex.splitId) - splitRank(b.ex.splitId);
        if (r !== 0) return r;
        return (a.best.date < b.best.date ? 1 : -1);
      });
      renderGroupedList(
        prList, prRows, prExpanded, VISIBLE_CAP,
        (row) => row.ex.splitName,
        ({ ex, best }) => {
          const unit = ex.bodyweight ? "Wdh" : "kg";
          const row = document.createElement("div");
          row.className = "pr-row";
          row.innerHTML = `<span>${ex.name}</span><span class="pr-badge">${fmtWeight(best.v)} ${unit} · ${best.date}</span>`;
          return row;
        },
        null,
        () => { prExpanded = !prExpanded; renderDashboard(); }
      );
    }

    const select = $("#volume-exercise-select");
    const prevSelected = select.value;
    select.innerHTML = withData.map((ex) => `<option value="${ex.id}">${ex.splitName} — ${ex.name}</option>`).join("");
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

  // Smooth, gradient-filled line chart — minimal App Store Connect–style trend line.
  // IMPORTANT: cssHeight must be passed in explicitly, not read back from canvas.height/getAttribute("height") —
  // setting canvas.height (a DOM property) reflects into the "height" attribute, so re-reading it after a draw
  // would pick up the already-scaled device-pixel value and balloon the canvas taller on every re-render.
  function drawSmoothChart(canvas, values, cssHeight) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
    const cssH = cssHeight || 90;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!values || values.length < 2) {
      ctx.fillStyle = "#b3b3ae";
      ctx.font = "12.5px -apple-system, sans-serif";
      ctx.fillText("Noch nicht genug Daten", 4, cssH / 2);
      return;
    }

    const padX = 4, padTop = 12, padBottom = 8;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) || 1;
    const innerH = cssH - padTop - padBottom;
    const stepX = values.length > 1 ? (cssW - padX * 2) / (values.length - 1) : 0;
    const pts = values.map((v, i) => ({
      x: padX + i * stepX,
      y: padTop + innerH - ((v - min) / range) * innerH
    }));

    function tracePath() {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    }

    // gradient fill under the curve
    const grad = ctx.createLinearGradient(0, padTop, 0, cssH);
    grad.addColorStop(0, "rgba(17,17,17,0.14)");
    grad.addColorStop(1, "rgba(17,17,17,0)");
    ctx.beginPath();
    tracePath();
    ctx.lineTo(pts[pts.length - 1].x, cssH);
    ctx.lineTo(pts[0].x, cssH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // the line itself
    ctx.beginPath();
    tracePath();
    ctx.strokeStyle = "#111111";
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    // endpoint marker
    const lastPt = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(17,17,17,0.14)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#111111";
    ctx.fill();
  }

  function drawVolumeChart(exerciseId) {
    const ex = allExercises().find((e) => e.id === exerciseId);
    if (!ex) return;
    const list = sessionsForExercise(exerciseId);
    const values = list.map((l) => topValue(l.entry, ex.bodyweight));
    const unit = ex.bodyweight ? "Wdh" : "kg";
    const current = values.length ? values[values.length - 1] : null;
    $("#volume-current").textContent = current !== null ? fmtWeight(current) : "–";
    $("#volume-unit").textContent = unit;
    const trendEl = $("#volume-trend");
    if (values.length >= 2) {
      const prev = values[values.length - 2];
      const delta = current - prev;
      trendEl.textContent = (delta > 0 ? "↑ " : delta < 0 ? "↓ " : "– ") + fmtWeight(Math.abs(delta)) + " " + unit + " seit letztem Training";
    } else {
      trendEl.textContent = "Noch nicht genug Daten für einen Trend";
    }
    drawSmoothChart($("#volume-chart"), values, 130);
  }

  /* ================= nutrition ================= */
  function todayProteinEntry() {
    let day = state.protein.find((p) => p.date === todayStr());
    if (!day) { day = { date: todayStr(), entries: [] }; state.protein.push(day); }
    return day;
  }

  function drawRing(canvas, current, goal) {
    // fixed 72x72 CSS size, scaled for device pixel ratio so it stays crisp —
    // canvas.width/height are set explicitly every time (never read back), so this can't runaway like the line charts once did
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const size = 72;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const pct = goal ? Math.max(0, Math.min(1, current / goal)) : 0;
    ctx.strokeStyle = "#f2f2f0";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#111111";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 28, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
  }

  function macroValueForDate(macro, d) {
    const nEntries = state.nutrition.filter((n) => n.date === d);
    if (macro === "calories") return nEntries.reduce((s, e) => s + e.calories, 0);
    if (macro === "carbs") return nEntries.reduce((s, e) => s + e.carbs, 0);
    if (macro === "fat") return nEntries.reduce((s, e) => s + e.fat, 0);
    if (macro === "protein") {
      const quickAdd = (state.protein.find((p) => p.date === d) || { entries: [] }).entries.reduce((s, e) => s + e.amount, 0);
      const fromMeals = nEntries.reduce((s, e) => s + e.protein, 0);
      return quickAdd + fromMeals;
    }
    return 0;
  }

  function macroEntriesForDate(macro, d) {
    const rows = [];
    state.nutrition.filter((n) => n.date === d).forEach((n) => {
      const val = macro === "calories" ? n.calories : macro === "carbs" ? n.carbs : macro === "fat" ? n.fat : n.protein;
      rows.push({
        id: n.id, time: n.time, label: n.foodName,
        valueText: fmtWeight(val) + (macro === "calories" ? " kcal" : " g"),
        source: "nutrition"
      });
    });
    if (macro === "protein") {
      const day = state.protein.find((p) => p.date === d);
      if (day) day.entries.forEach((e) => rows.push({ id: e.id, time: e.time, label: "Eiweiß", valueText: fmtWeight(e.amount) + " g", source: "protein" }));
    }
    return rows.sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  }

  function macroHistoryLast14(macro) {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = daysAgoStr(i);
      const hasDay = macro === "protein"
        ? (state.protein.some((p) => p.date === d) || state.nutrition.some((n) => n.date === d))
        : state.nutrition.some((n) => n.date === d);
      if (hasDay) out.push(macroValueForDate(macro, d));
    }
    return out;
  }

  async function deleteMacroEntry(row) {
    if (row.source === "protein") {
      const { error } = await sb.from("protein_entries").delete().eq("id", row.id);
      if (error) { showError(error.message); return; }
      const day = state.protein.find((p) => p.date === todayStr());
      if (day) day.entries = day.entries.filter((e) => e.id !== row.id);
    } else {
      const { error } = await sb.from("nutrition_entries").delete().eq("id", row.id);
      if (error) { showError(error.message); return; }
      state.nutrition = state.nutrition.filter((n) => n.id !== row.id);
    }
    renderNutrition();
  }

  function buildNutritionAnalysisText() {
    if (!state.nutrition.length && !state.protein.length) {
      return "Sammle noch Daten — trage Mahlzeiten oder Eiweiß ein, um eine Analyse zu sehen.";
    }
    const last7 = [];
    for (let i = 1; i <= 7; i++) last7.push(daysAgoStr(i));
    const proteinAvg = last7.reduce((s, d) => s + macroValueForDate("protein", d), 0) / 7;
    const kcalAvg = last7.reduce((s, d) => s + macroValueForDate("calories", d), 0) / 7;
    const today = todayStr();
    const proteinToday = macroValueForDate("protein", today);
    const kcalToday = macroValueForDate("calories", today);
    const parts = [];
    if (proteinAvg > 0) {
      const diff = proteinToday - proteinAvg;
      parts.push(diff >= 0
        ? `Protein liegt heute ${fmtWeight(diff)} g über deinem 7-Tage-Schnitt.`
        : `Protein liegt heute ${fmtWeight(Math.abs(diff))} g unter deinem 7-Tage-Schnitt.`);
    }
    if (kcalAvg > 0) {
      const diff = kcalToday - kcalAvg;
      parts.push(diff >= 0
        ? `Kalorien liegen ${Math.round(Math.abs(diff))} kcal über dem Schnitt.`
        : `Kalorien liegen ${Math.round(Math.abs(diff))} kcal unter dem Schnitt.`);
    }
    return parts.length ? parts.join(" ") : "Noch nicht genug Verlauf für eine Analyse.";
  }

  function renderNutrition() {
    if (nutritionDetailMacro) {
      $("#nutrition-overview").classList.add("hidden");
      $("#nutrition-detail").classList.remove("hidden");
      renderMacroDetail(nutritionDetailMacro);
    } else {
      $("#nutrition-overview").classList.remove("hidden");
      $("#nutrition-detail").classList.add("hidden");
      renderNutritionOverview();
    }
  }

  function openMacroDetail(macro) { nutritionDetailMacro = macro; renderNutrition(); }
  function closeMacroDetail() { nutritionDetailMacro = null; renderNutrition(); }

  function renderNutritionOverview() {
    const d = todayStr();
    const kcal = macroValueForDate("calories", d);
    const protein = macroValueForDate("protein", d);
    const carbs = macroValueForDate("carbs", d);
    const fat = macroValueForDate("fat", d);
    const kcalGoal = state.settings.calorieGoal;

    $("#calorie-hero-label").textContent = `${Math.round(kcal)} / ${Math.round(kcalGoal)} kcal`;
    const bar = $("#calorie-bar");
    bar.innerHTML = "";
    const segs = 4;
    const pct = kcalGoal ? Math.min(1, kcal / kcalGoal) : 0;
    const filledSegs = Math.round(pct * segs);
    for (let i = 0; i < segs; i++) {
      const seg = document.createElement("span");
      seg.className = "progress-seg" + (i < filledSegs ? " filled" : "");
      bar.appendChild(seg);
    }

    $("#macro-protein-current").textContent = Math.round(protein);
    $("#macro-protein-goal").textContent = Math.round(state.settings.proteinGoal);
    $("#macro-carbs-current").textContent = Math.round(carbs);
    $("#macro-carbs-goal").textContent = Math.round(state.settings.carbsGoal);
    $("#macro-fat-current").textContent = Math.round(fat);
    $("#macro-fat-goal").textContent = Math.round(state.settings.fatGoal);

    $("#nutrition-analysis-text").textContent = buildNutritionAnalysisText();
  }

  function renderMacroDetail(macro) {
    const cfg = MACRO_CONFIG[macro];
    const d = todayStr();
    const current = macroValueForDate(macro, d);
    const goal = state.settings[cfg.goalKey];

    $("#nutrition-detail-label").textContent = `${cfg.label} heute`;
    $("#nutrition-detail-current").textContent = Math.round(current);
    $("#nutrition-detail-goal").textContent = Math.round(goal);
    $("#nutrition-detail-unit").textContent = cfg.unit;
    const remaining = goal - current;
    $("#nutrition-detail-remaining").textContent = remaining > 0 ? `noch ${Math.round(remaining)} ${cfg.unit} bis zum Ziel` : "Ziel erreicht";
    $("#nutrition-quick-add").classList.toggle("hidden", !cfg.showQuickAdd);

    drawRing($("#nutrition-ring"), current, goal);
    drawSmoothChart($("#nutrition-history-chart"), macroHistoryLast14(macro), 100);

    const rows = macroEntriesForDate(macro, d);
    $("#nutrition-log-toggle-label").textContent = `${rows.length} Eintr${rows.length === 1 ? "ag" : "äge"} heute`;
    const list = $("#nutrition-log-list");
    list.innerHTML = "";
    if (!rows.length) {
      list.innerHTML = `<p class="muted small">Heute noch nichts erfasst.</p>`;
    } else {
      rows.forEach((row) => {
        const el = document.createElement("div");
        el.className = "protein-entry";
        el.innerHTML = `<span>${row.time || ""} · ${row.label}</span><span>${row.valueText}</span><button class="icon-btn" aria-label="Eintrag löschen" style="width:26px;height:26px;font-size:12px;">×</button>`;
        el.querySelector("button").addEventListener("click", () => deleteMacroEntry(row));
        list.appendChild(el);
      });
    }
  }

  async function addProtein(amount) {
    const now = new Date();
    const time = now.toTimeString().slice(0, 5);
    const { data, error } = await sb.from("protein_entries")
      .insert({ user_id: currentUser.id, date: todayStr(), amount, entry_time: time })
      .select().single();
    if (error) { showError(error.message); return; }
    const day = todayProteinEntry();
    day.entries.push({ id: data.id, amount: Number(data.amount), time: data.entry_time });
    renderNutrition();
  }

  /* ================= food search (Open Food Facts) ================= */
  function onAddMeal() {
    // modal-sheet-scroll: keeps the title/input (and the Abbrechen button) fixed in place,
    // only the results list in between scrolls - so the search field never moves out of view
    // and the cancel button is always reachable regardless of how many results come back.
    openModal(`
      <h3>Mahlzeit hinzufügen</h3>
      <input id="food-search-input" type="text" placeholder="z. B. Buttertoast" autocomplete="off" />
      <div id="food-search-results" class="modal-scroll-body"></div>
      <div class="modal-actions">
        <button class="ghost-btn" id="modal-cancel">Abbrechen</button>
      </div>
    `, "modal-sheet-scroll");
    $("#modal-cancel").addEventListener("click", closeModal);
    const input = $("#food-search-input");
    let debounceTimer;
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (q.length < 2) { $("#food-search-results").innerHTML = ""; return; }
      debounceTimer = setTimeout(() => searchFoods(q), 400);
    });
    input.focus();
  }

  // Matches Cyrillic / Arabic / CJK characters so results in the wrong script get filtered out.
  const NON_LATIN_RE = /[Ѐ-ӿ؀-ۿݐ-ݿ一-鿿]/;
  const ALL_DIGITS_RE = /^[\d\s./-]+$/; // rejects entries whose "name" is just a barcode

  function pickFoodName(p) {
    return p.product_name_de || p.product_name || p.product_name_en || "";
  }

  function isSoldInGermany(p) {
    return Array.isArray(p.countries_tags) && p.countries_tags.includes("en:germany");
  }

  function hasRealNutrition(p) {
    const n = p.nutriments || {};
    return ["energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g"]
      .some((k) => Number(n[k]) > 0);
  }

  async function fetchJsonOrThrow(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function searchFoods(query) {
    const results = $("#food-search-results");
    if (!results) return;
    results.innerHTML = `<p class="muted small">Suche …</p>`;

    // The legacy world.openfoodfacts.org search backend (/api/v2/search, /cgi/search.pl) has been
    // unreliable (intermittent HTTP 503s). search-a-licious is OFF's actively maintained replacement.
    // We query both in parallel and merge results, so a hiccup in either source doesn't break search.
    // countries_tags_en=Germany asks the server to only return products sold in Germany (imports,
    // fast-food chains etc. included, as long as they're tagged) - this is a best-effort request param,
    // the real gate is the client-side isSoldInGermany() filter below.
    const attempts = await Promise.allSettled([
      fetchJsonOrThrow(`https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&countries_tags_en=Germany&page_size=40`)
        .then((d) => d.hits || d.products || []),
      fetchJsonOrThrow(`https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(query)}&countries_tags_en=Germany&page_size=40&fields=code,product_name,product_name_de,brands,serving_size,serving_quantity,nutriments,countries_tags`)
        .then((d) => d.products || [])
    ]);

    if (!results.isConnected) return;

    if (attempts.every((r) => r.status === "rejected")) {
      results.innerHTML = `<p class="muted small">Lebensmittel-Datenbank gerade nicht erreichbar. Versuch's gleich nochmal.</p>`;
      return;
    }

    const byKey = new Map();
    attempts.forEach((r) => {
      if (r.status !== "fulfilled") return;
      (r.value || []).forEach((p) => {
        const key = p.code || pickFoodName(p);
        if (key && !byKey.has(key)) byKey.set(key, p);
      });
    });

    // Hard filter: only real names (no barcode-as-name junk), only Latin script, only products
    // actually sold in Germany, and only entries that carry usable nutrition data.
    let products = [...byKey.values()]
      .map((p) => ({ ...p, _name: pickFoodName(p) }))
      .filter((p) =>
        p._name &&
        !NON_LATIN_RE.test(p._name) &&
        !ALL_DIGITS_RE.test(p._name) &&
        isSoldInGermany(p) &&
        hasRealNutrition(p)
      );

    if (!products.length) {
      results.innerHTML = `<p class="muted small">Keine Treffer für den deutschen Markt gefunden. Versuch's mit einem anderen Begriff (z. B. Markenname).</p>`;
      return;
    }

    results.innerHTML = "";
    products.forEach((p) => {
      const n = p.nutriments || {};
      const kcal = n["energy-kcal_100g"];
      const row = document.createElement("div");
      row.className = "food-result-row";
      row.innerHTML = `
        <div>
          <p class="food-result-name">${p._name}</p>
          <p class="muted small">${p.brands || ""}${p.serving_size ? " · " + p.serving_size : ""}</p>
        </div>
        <span class="muted small">${kcal ? Math.round(kcal) + " kcal/100g" : ""}</span>
      `;
      row.addEventListener("click", () => openQuantityStep({ ...p, product_name: p._name }));
      results.appendChild(row);
    });
  }

  function openQuantityStep(product) {
    const n = product.nutriments || {};
    const kcal100 = Number(n["energy-kcal_100g"]) || 0;
    const protein100 = Number(n["proteins_100g"]) || 0;
    const carbs100 = Number(n["carbohydrates_100g"]) || 0;
    const fat100 = Number(n["fat_100g"]) || 0;
    const servingGrams = Number(product.serving_quantity) || null;
    const servingLabel = product.serving_size || null;
    const useServing = !!servingGrams;

    openModal(`
      <h3>${product.product_name}</h3>
      <p class="muted small" style="margin-top:-8px;">${product.brands || ""}</p>
      <label style="font-size:12.5px;color:var(--text-secondary);display:block;margin:10px 0 6px;">
        ${useServing ? `Menge in Portionen (1 Portion = ${servingLabel || servingGrams + " g"})` : "Menge in Gramm"}
      </label>
      <input id="qty-input" type="text" inputmode="decimal" value="1" placeholder="${useServing ? "z. B. 0,75" : "z. B. 100"}" />
      <div class="modal-actions">
        <button class="ghost-btn" id="modal-cancel">Abbrechen</button>
        <button class="primary-btn" id="modal-save">Hinzufügen</button>
      </div>
    `);
    $("#modal-cancel").addEventListener("click", closeModal);
    $("#modal-save").addEventListener("click", async () => {
      const qty = parseNum($("#qty-input").value);
      if (!qty) return;
      const grams = useServing ? qty * servingGrams : qty;
      const factor = grams / 100;
      const payload = {
        user_id: currentUser.id,
        date: todayStr(),
        food_name: product.product_name,
        brand: product.brands || null,
        quantity: qty,
        quantity_unit: useServing ? "serving" : "g",
        serving_label: servingLabel,
        grams,
        calories: Math.round(kcal100 * factor),
        protein: Math.round(protein100 * factor * 10) / 10,
        carbs: Math.round(carbs100 * factor * 10) / 10,
        fat: Math.round(fat100 * factor * 10) / 10,
        entry_time: new Date().toTimeString().slice(0, 5),
        source: "openfoodfacts"
      };
      const { data, error } = await sb.from("nutrition_entries").insert(payload).select().single();
      if (error) { showError(error.message); return; }
      state.nutrition.push({
        id: data.id, date: payload.date, foodName: payload.food_name, brand: payload.brand,
        quantity: payload.quantity, quantityUnit: payload.quantity_unit, servingLabel: payload.serving_label,
        grams: payload.grams, calories: payload.calories, protein: payload.protein, carbs: payload.carbs, fat: payload.fat,
        time: payload.entry_time
      });
      closeModal();
      renderNutrition();
    });
  }

  /* ================= bodyweight ================= */
  function sortedWeightEntries() { return [...state.bodyweight].sort((a, b) => (a.date > b.date ? 1 : -1)); }

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
      pill.classList.remove("hidden");
      trendEl.textContent = "seit letztem Eintrag (" + list[list.length - 2].date + ")";
    } else {
      pill.textContent = "";
      pill.classList.add("hidden");
      trendEl.textContent = list.length ? "Noch zu wenige Einträge für einen Trend" : "Trage dein Gewicht ein, um den Verlauf zu sehen";
    }

    const last30 = [];
    for (let i = 29; i >= 0; i--) {
      const d = daysAgoStr(i);
      const rec = state.bodyweight.find((w) => w.date === d);
      if (rec) last30.push(rec.value);
    }
    drawSmoothChart($("#weight-history-chart"), last30, 100);

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
        row.querySelector("button").addEventListener("click", async () => {
          const { error } = await sb.from("bodyweight_entries").delete().eq("id", entry.id);
          if (error) { showError(error.message); return; }
          state.bodyweight = state.bodyweight.filter((w) => w.id !== entry.id);
          renderWeight();
        });
        logList.appendChild(row);
      });
    }
  }

  async function saveWeightEntry() {
    const v = parseNum($("#weight-input").value);
    if (v === null) return;
    const { data, error } = await sb.from("bodyweight_entries")
      .upsert({ user_id: currentUser.id, date: todayStr(), value: v }, { onConflict: "user_id,date" })
      .select().single();
    if (error) { showError(error.message); return; }
    const existing = state.bodyweight.find((w) => w.date === todayStr());
    if (existing) { existing.value = Number(data.value); existing.id = data.id; }
    else state.bodyweight.push({ id: data.id, date: data.date, value: Number(data.value) });
    renderWeight();
  }

  /* ================= modal ================= */
  let savedScrollY = 0;
  function lockBodyScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
  }
  function unlockBodyScroll() {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    window.scrollTo(0, savedScrollY);
  }

  function openModal(html, sheetClass) {
    const root = $("#modal-root");
    // Locking the body while the modal is open stops iOS Safari's native "scroll focused
    // input into view" behavior from jumping/zooming the whole page behind the fixed overlay.
    lockBodyScroll();
    root.innerHTML = `<div class="modal-backdrop"><div class="modal-sheet${sheetClass ? " " + sheetClass : ""}">${html}</div></div>`;
    root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) closeModal();
    });
  }
  function closeModal() { $("#modal-root").innerHTML = ""; unlockBodyScroll(); }

  function onMenuClick() {
    openModal(`
      <h3>Menü</h3>
      <div class="modal-actions" style="flex-direction:column;">
        <button class="ghost-btn full" id="m-goal">Ernährungsziele ändern</button>
        <button class="ghost-btn full" id="m-export-csv">Trainingsdaten als CSV exportieren</button>
        <button class="ghost-btn full" id="m-delete-split">Aktuellen Split löschen</button>
        <button class="ghost-btn full" id="m-signout">Abmelden</button>
        <button class="ghost-btn full" id="m-close">Schließen</button>
      </div>
    `);
    $("#m-close").addEventListener("click", closeModal);
    $("#m-goal").addEventListener("click", () => {
      openModal(`
        <h3>Ernährungsziele</h3>
        <label style="font-size:12.5px;color:var(--text-secondary);">Kalorien (kcal)</label>
        <input id="goal-kcal-input" type="text" inputmode="numeric" value="${state.settings.calorieGoal}" />
        <label style="font-size:12.5px;color:var(--text-secondary);">Protein (g)</label>
        <input id="goal-protein-input" type="text" inputmode="numeric" value="${state.settings.proteinGoal}" />
        <label style="font-size:12.5px;color:var(--text-secondary);">Carbs (g)</label>
        <input id="goal-carbs-input" type="text" inputmode="numeric" value="${state.settings.carbsGoal}" />
        <label style="font-size:12.5px;color:var(--text-secondary);">Fett (g)</label>
        <input id="goal-fat-input" type="text" inputmode="numeric" value="${state.settings.fatGoal}" />
        <div class="modal-actions">
          <button class="ghost-btn" id="modal-cancel">Abbrechen</button>
          <button class="primary-btn" id="modal-save">Speichern</button>
        </div>
      `);
      $("#modal-cancel").addEventListener("click", closeModal);
      $("#modal-save").addEventListener("click", async () => {
        const kcal = parseNum($("#goal-kcal-input").value);
        const protein = parseNum($("#goal-protein-input").value);
        const carbs = parseNum($("#goal-carbs-input").value);
        const fat = parseNum($("#goal-fat-input").value);
        if (!kcal || !protein || !carbs || !fat) return;
        const { error } = await sb.from("user_settings").upsert({
          user_id: currentUser.id, calorie_goal: kcal, protein_goal: protein, carbs_goal: carbs, fat_goal: fat
        }, { onConflict: "user_id" });
        if (error) { showError(error.message); return; }
        state.settings.calorieGoal = kcal;
        state.settings.proteinGoal = protein;
        state.settings.carbsGoal = carbs;
        state.settings.fatGoal = fat;
        closeModal();
        renderNutrition();
      });
    });
    $("#m-export-csv").addEventListener("click", exportCsv);
    $("#m-delete-split").addEventListener("click", onDeleteCurrentSplit);
    $("#m-signout").addEventListener("click", async () => { closeModal(); await signOut(); });
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

  /* ================= view switching ================= */
  function switchView(view) {
    currentView = view;
    ["workout", "dashboard", "protein", "weight"].forEach((v) => {
      $("#view-" + v).classList.toggle("hidden", v !== view);
    });
    $$("#bottom-nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $("#split-tabs").classList.toggle("hidden", view !== "workout");
    if (VIEW_TITLES[view]) $("#page-title").textContent = VIEW_TITLES[view];
    if (view === "workout") renderExerciseList();
    if (view === "dashboard") renderDashboard();
    if (view === "protein") { nutritionDetailMacro = null; renderNutrition(); }
    if (view === "weight") renderWeight();
  }

  /* ================= boot ================= */
  let appInited = false;

  function bindAppEventsOnce() {
    if (appInited) return;
    appInited = true;
    $$("#bottom-nav button").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
    $("#add-exercise-btn").addEventListener("click", onAddExercise);
    $("#repeat-last-btn").addEventListener("click", onRepeatLast);
    $("#empty-add-split-btn").addEventListener("click", onAddSplit);
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

    $("#details-toggle-btn").addEventListener("click", () => {
      const section = $("#details-section");
      const expanded = section.classList.toggle("hidden") === false;
      $("#details-toggle-label").textContent = expanded ? "Details ausblenden" : "Details anzeigen";
    });
    $$("#trend-pr-tabs .seg-btn").forEach((btn) => btn.addEventListener("click", () => setDashboardTab(btn.dataset.tab)));
    $("#nutrition-log-toggle-btn").addEventListener("click", () => {
      const list = $("#nutrition-log-list");
      const expanded = list.classList.toggle("hidden") === false;
      $("#nutrition-log-toggle-arrow").textContent = expanded ? "ausblenden ‹" : "anzeigen ›";
    });
    $$(".macro-block").forEach((el) => el.addEventListener("click", () => openMacroDetail(el.dataset.macro)));
    $("#calorie-hero-card").addEventListener("click", () => openMacroDetail("calories"));
    $("#nutrition-back-btn").addEventListener("click", closeMacroDetail);
    $("#add-meal-btn").addEventListener("click", onAddMeal);

    setupServiceWorker();
  }

  function setDashboardTab(tab) {
    dashboardTab = tab;
    $$("#trend-pr-tabs .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("#trend-list").classList.toggle("hidden", tab !== "trend");
    $("#pr-list").classList.toggle("hidden", tab !== "pr");
  }

  function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("service-worker.js");

        const promptUpdate = (worker) => {
          worker.postMessage("skipWaiting");
        };

        if (reg.waiting) promptUpdate(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              promptUpdate(worker);
            }
          });
        });

        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
        reg.update().catch(() => {});
        // also re-check periodically while the app stays open, so a fresh deploy
        // is picked up within a minute instead of only on the next full open/close
        setInterval(() => reg.update().catch(() => {}), 60000);
      } catch (e) { /* ignore */ }
    });
  }

  async function bootApp() {
    $("#auth-gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
    try {
      await fetchAllData();
    } catch (err) {
      showError("Konnte Daten nicht laden: " + err.message);
      return;
    }
    bindAppEventsOnce();
    renderTabs();
    switchView("dashboard");
  }

  function showAuthGate() {
    $("#app").classList.add("hidden");
    $("#auth-gate").classList.remove("hidden");
  }

  function initAuthUI() {
    $$("#auth-tabs button").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.authMode)));
    $("#auth-form").addEventListener("submit", onAuthSubmit);
    setAuthMode("signin");
  }

  async function init() {
    initAuthUI();
    const { data: { session } } = await sb.auth.getSession();
    if (session) { currentUser = session.user; await bootApp(); }
    else { showAuthGate(); }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session && (!currentUser || currentUser.id !== session.user.id)) {
        currentUser = session.user;
        bootApp();
      }
      if (event === "SIGNED_OUT") {
        currentUser = null;
        state = { splits: [], sessions: [], protein: [], bodyweight: [], settings: { proteinGoal: 150 } };
        currentSplitId = null;
        appInited = false;
        showAuthGate();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
