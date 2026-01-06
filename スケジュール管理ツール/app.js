(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const fmt = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' });
  const now = () => new Date();
  const fmtDate = (d) => fmt.format(d);

  const state = {
    inProgress: [],
    completed: [],
    someday: [],
    expandedWeeks: {},
  };

  const STORAGE_KEY = 'schedule_mock_state_v1';

  function saveState() {
    try {
      const toJson = (arr) => arr.map((t) => ({
        id: t.id,
        title: t.title,
        memo: t.memo || '',
        addedAt: t.addedAt instanceof Date ? t.addedAt.toISOString() : t.addedAt,
        completedAt: t.completedAt ? (t.completedAt instanceof Date ? t.completedAt.toISOString() : t.completedAt) : undefined,
      }));
      const payload = {
        inProgress: toJson(state.inProgress),
        completed: toJson(state.completed),
        someday: toJson(state.someday),
        expandedWeeks: state.expandedWeeks || {},
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {
      // ignore persistence errors
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      const parseArr = (arr) => Array.isArray(arr) ? arr.map((t) => ({
        id: t.id,
        title: t.title,
        memo: t.memo || '',
        addedAt: t.addedAt ? new Date(t.addedAt) : new Date(),
        completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
      })) : [];
      state.inProgress = parseArr(data.inProgress);
      state.completed = parseArr(data.completed);
      state.someday = parseArr(data.someday);
      state.expandedWeeks = data.expandedWeeks || {};
    } catch (_) {
      // ignore load errors
    }
  }

  const el = {
    form: $('#add-form'),
    input: $('#task-input'),
    memo: $('#task-memo'),
    inProgressList: $('#in-progress-list'),
    completedList: $('#completed-list'),
    somedayList: $('#someday-list'),
    countInProgress: $('#count-in-progress'),
    countCompleted: $('#count-completed'),
    countSomeday: $('#count-someday'),
  };

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function addTask(title, memo) {
    state.inProgress.unshift({
      id: uid(),
      title,
      memo: memo || '',
      addedAt: now(),
    });
    saveState();
    render();
  }

  function completeTask(id) {
    const idx = state.inProgress.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [t] = state.inProgress.splice(idx, 1);
    state.completed.unshift({ ...t, completedAt: now() });
    saveState();
    render();
  }

  function deleteTask(list, id) {
    const arr = list === 'completed' ? state.completed : state.inProgress;
    const idx = arr.findIndex((t) => t.id === id);
    if (idx !== -1) {
      arr.splice(idx, 1);
      saveState();
      render();
    }
  }

  function taskItemTemplate(task, { completed = false, list = 'inProgress', index = 0 } = {}) {
    const meta = completed
      ? `追加: ${fmtDate(task.addedAt)} ・ 完了: ${fmtDate(task.completedAt)}`
      : `追加: ${fmtDate(task.addedAt)}`;

    return `
      <li class="task ${completed ? 'task--completed' : list === 'someday' ? 'task--someday' : ''}" data-id="${task.id}" data-index="${index}" draggable="${list !== 'completed'}">
        <div>
          <p class="task__title">${escapeHtml(task.title)}</p>
          <div class="task__meta">${meta}</div>
          ${task.memo ? `<div class=\"task__memo\">${escapeHtml(task.memo)}</div>` : ''}
        </div>
        <div class="task__actions">
          ${completed
            ? `<button class="btn btn--ghost js-edit" aria-label="編集">編集</button>
               <button class="btn btn--ghost js-delete-completed" aria-label="削除">削除</button>`
            : `<button class="btn btn--primary js-complete" aria-label="完了">完了</button>
               <button class="btn btn--ghost js-edit" aria-label="編集">編集</button>
               <button class="btn btn--ghost js-delete-inprogress" aria-label="削除">削除</button>`}
        </div>
      </li>`;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"]+/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    })[c]);
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function editFormTemplate(task, { completed = false } = {}) {
    const meta = completed
      ? `追加: ${fmtDate(task.addedAt)} ・ 完了: ${fmtDate(task.completedAt)}`
      : `追加: ${fmtDate(task.addedAt)}`;
    return `
      <li class="task ${completed ? 'task--completed' : ''}" data-id="${task.id}">
        <form class="task-edit">
          <div>
            <input name="title" type="text" value="${escapeAttr(task.title)}" aria-label="タイトル" required />
          </div>
          <div>
            <textarea name="memo" aria-label="メモ" placeholder="メモ（任意）">${escapeHtml(task.memo || '')}</textarea>
          </div>
          <div class="task__meta">${meta}</div>
          <div class="task__actions">
            <button type="submit" class="btn btn--primary js-save">保存</button>
            <button type="button" class="btn btn--ghost js-cancel">キャンセル</button>
          </div>
        </form>
      </li>`;
  }

  // Sunday-based week helpers and renderer for completed grouping
  function startOfSundayWeek(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0 (Sun) - 6 (Sat)
    date.setDate(date.getDate() - day); // back to Sunday
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function firstSundayOfYear(year) {
    const d = new Date(year, 0, 1);
    const day = d.getDay();
    const diff = (7 - day) % 7; // days to next Sunday (0 if already Sunday)
    const first = new Date(year, 0, 1 + diff);
    first.setHours(0, 0, 0, 0);
    return first;
  }

  function getSundayWeekYear(d) {
    const ws = startOfSundayWeek(d);
    let y = ws.getFullYear();
    const firstSun = firstSundayOfYear(y);
    if (ws < firstSun) y = y - 1;
    return y;
  }

  function getSundayWeekNumber(d) {
    const ws = startOfSundayWeek(d);
    const y = getSundayWeekYear(d);
    const firstSun = firstSundayOfYear(y);
    const diffDays = Math.round((ws - firstSun) / 86400000);
    return 1 + Math.floor(diffDays / 7);
  }

  function renderCompletedWithWeeks() {
    const groups = [];
    const map = new Map();
    for (const t of state.completed) {
      const year = getSundayWeekYear(t.completedAt);
      const week = getSundayWeekNumber(t.completedAt);
      const key = `${year}-${String(week).padStart(2, '0')}`;
      if (!map.has(key)) {
        const rec = { key, header: key, tasks: [] };
        map.set(key, rec);
        groups.push(rec);
      }
      map.get(key).tasks.push(t);
    }

    let html = '';
    for (const g of groups) {
      const expanded = !!state.expandedWeeks[g.key];
      html += `
        <li class="week-header">
          <button class="week-toggle" data-week-key="${g.key}" aria-expanded="${expanded}">
            ${g.header}
          </button>
        </li>
      `;
      html += `
        <ul class="week-group ${expanded ? 'is-open' : 'is-closed'}" data-week-key="${g.key}">
          ${g.tasks.map((t) => taskItemTemplate(t, { completed: true })).join('')}
        </ul>
      `;
    }
    el.completedList.innerHTML = html;
  }

  function render() {
    el.inProgressList.innerHTML = state.inProgress.map((t, i) => taskItemTemplate(t, { list: 'inProgress', index: i })).join('');
    el.somedayList.innerHTML = state.someday.map((t, i) => taskItemTemplate(t, { list: 'someday', index: i })).join('');
    renderCompletedWithWeeks();

    el.countInProgress.textContent = String(state.inProgress.length);
    el.countCompleted.textContent = String(state.completed.length);
    el.countSomeday.textContent = String(state.someday.length);

    updateSuggestions();
  }

  // Event: add
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = el.input.value.trim();
    if (!title) return;
    const memo = (el.memo?.value || '').trim();
    addTask(title, memo);
    el.input.value = '';
    if (el.memo) el.memo.value = '';
    el.input.focus();
  });

  // Event delegation for in-progress actions
  el.inProgressList.addEventListener('click', (e) => {
    const li = e.target.closest('li.task');
    if (!li) return;
    const id = li.getAttribute('data-id');
    if (e.target.closest('.js-complete')) {
      completeTask(id);
    } else if (e.target.closest('.js-edit')) {
      const t = state.inProgress.find((x) => x.id === id);
      if (!t) return;
      li.outerHTML = editFormTemplate(t, { completed: false });
    } else if (e.target.closest('.js-delete-inprogress')) {
      deleteTask('inProgress', id);
    }
  });

  // Event delegation for someday actions (same as in-progress)
  el.somedayList.addEventListener('click', (e) => {
    const li = e.target.closest('li.task');
    if (!li) return;
    const id = li.getAttribute('data-id');
    if (e.target.closest('.js-complete')) {
      // Completing from someday moves to completed
      const idx = state.someday.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const [t] = state.someday.splice(idx, 1);
      state.completed.unshift({ ...t, completedAt: now() });
      saveState();
      render();
    } else if (e.target.closest('.js-edit')) {
      const t = state.someday.find((x) => x.id === id);
      if (!t) return;
      li.outerHTML = editFormTemplate(t, { completed: false });
    } else if (e.target.closest('.js-delete-inprogress')) {
      const idx = state.someday.findIndex((t) => t.id === id);
      if (idx !== -1) {
        state.someday.splice(idx, 1);
        saveState();
        render();
      }
    }
  });

  // Save/cancel edit in in-progress
  el.inProgressList.addEventListener('submit', (e) => {
    const form = e.target.closest('form.task-edit');
    if (!form) return;
    e.preventDefault();
    const li = form.closest('li.task');
    const id = li.getAttribute('data-id');
    const t = state.inProgress.find((x) => x.id === id);
    if (!t) return;
    const formData = new FormData(form);
    t.title = (formData.get('title') || '').toString();
    t.memo = (formData.get('memo') || '').toString();
    saveState();
    render();
  });

  el.inProgressList.addEventListener('click', (e) => {
    const btn = e.target.closest('.js-cancel');
    if (!btn) return;
    const li = btn.closest('li.task');
    const id = li.getAttribute('data-id');
    const t = state.inProgress.find((x) => x.id === id);
    if (!t) return;
    li.outerHTML = taskItemTemplate(t, { completed: false });
  });

  // Event delegation for completed actions
  el.completedList.addEventListener('click', (e) => {
    // Toggle week accordion
    const toggle = e.target.closest('.week-toggle');
    if (toggle) {
      const key = toggle.getAttribute('data-week-key');
      state.expandedWeeks[key] = !state.expandedWeeks[key];
      saveState();
      renderCompletedWithWeeks();
      return;
    }

    const li = e.target.closest('li.task');
    if (!li) return;
    const id = li.getAttribute('data-id');
    if (e.target.closest('.js-delete-completed')) {
      deleteTask('completed', id);
    } else if (e.target.closest('.js-edit')) {
      const t = state.completed.find((x) => x.id === id);
      if (!t) return;
      li.outerHTML = editFormTemplate(t, { completed: true });
    }
  });

  // Save/cancel edit in completed
  el.completedList.addEventListener('submit', (e) => {
    const form = e.target.closest('form.task-edit');
    if (!form) return;
    e.preventDefault();
    const li = form.closest('li.task');
    const id = li.getAttribute('data-id');
    const t = state.completed.find((x) => x.id === id);
    if (!t) return;
    const formData = new FormData(form);
    t.title = (formData.get('title') || '').toString();
    t.memo = (formData.get('memo') || '').toString();
    saveState();
    render();
  });

  // Save/cancel edit in someday
  el.somedayList.addEventListener('submit', (e) => {
    const form = e.target.closest('form.task-edit');
    if (!form) return;
    e.preventDefault();
    const li = form.closest('li.task');
    const id = li.getAttribute('data-id');
    const t = state.someday.find((x) => x.id === id);
    if (!t) return;
    const formData = new FormData(form);
    t.title = (formData.get('title') || '').toString();
    t.memo = (formData.get('memo') || '').toString();
    saveState();
    render();
  });

  el.completedList.addEventListener('click', (e) => {
    const btn = e.target.closest('.js-cancel');
    if (!btn) return;
    const li = btn.closest('li.task');
    const id = li.getAttribute('data-id');
    const t = state.completed.find((x) => x.id === id);
    if (!t) return;
    li.outerHTML = taskItemTemplate(t, { completed: true });
  });

  // Suggestions (datalist) from historical titles
  function updateSuggestions() {
    const set = new Set();
    for (const t of state.inProgress) set.add(t.title);
    for (const t of state.someday) set.add(t.title);
    for (const t of state.completed) set.add(t.title);
    const list = document.getElementById('task-suggestions');
    if (!list) return;
    list.innerHTML = Array.from(set)
      .filter((s) => s && typeof s === 'string')
      .slice(0, 100)
      .map((s) => `<option value="${escapeAttr(s)}"></option>`) // escapeAttr exists above
      .join('');
  }

  el.somedayList.addEventListener('click', (e) => {
    const btn = e.target.closest('.js-cancel');
    if (!btn) return;
    const li = btn.closest('li.task');
    const id = li.getAttribute('data-id');
    const t = state.someday.find((x) => x.id === id);
    if (!t) return;
    li.outerHTML = taskItemTemplate(t, { completed: false, list: 'someday' });
  });

  // Drag & Drop: reorder in inProgress and someday, and move from inProgress -> someday
  const dragData = { fromList: null, fromIndex: -1, id: null };

  function onDragStart(listName) {
    return (e) => {
      const li = e.target.closest('li.task');
      if (!li) return;
      dragData.fromList = listName;
      const idxAttr = li.getAttribute('data-index');
      let idx = Number(idxAttr);
      if (!Number.isInteger(idx) || idx < 0) {
        const arr = listName === 'inProgress' ? state.inProgress : state.someday;
        const idTmp = li.getAttribute('data-id');
        idx = arr.findIndex((t) => t.id === idTmp);
      }
      dragData.fromIndex = idx;
      dragData.id = li.getAttribute('data-id');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragData.id); } catch(_) {}
      li.classList.add('dragging');
    };
  }

  function getOrCreateIndicator(ul) {
    let ind = ul.querySelector('.drop-indicator');
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'drop-indicator';
      ul.appendChild(ind);
    }
    return ind;
  }

  function updateIndicator(ul, index) {
    const ind = getOrCreateIndicator(ul);
    const items = Array.from(ul.querySelectorAll('li.task'));
    let top = 0;
    if (items.length === 0 || index <= 0) {
      top = 0;
    } else if (index >= items.length) {
      const last = items[items.length - 1];
      top = last.offsetTop + last.offsetHeight + 10; // 10px list gap
    } else {
      top = items[index].offsetTop;
    }
    ind.style.top = `${top}px`;
  }

  function computeIndexFromPoint(ul, e) {
    const items = Array.from(ul.querySelectorAll('li.task'));
    for (let i = 0; i < items.length; i++) {
      const li = items[i];
      const rect = li.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) return i;
    }
    return items.length;
  }

  function attachDnd(ul, listName) {
    ul.addEventListener('dragstart', onDragStart(listName), true);
    ul.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      ul.classList.add('droppable--over');
      const toIndex = computeIndexFromPoint(ul, e);
      ul.dataset.dropIndex = String(toIndex);
      updateIndicator(ul, toIndex);
    });
    ul.addEventListener('dragenter', () => { ul.classList.add('droppable--over'); });
    ul.addEventListener('dragleave', (e) => {
      if (!ul.contains(e.relatedTarget)) {
        ul.classList.remove('droppable--over');
        const ind = ul.querySelector('.drop-indicator');
        if (ind) ind.remove();
      }
    });
    ul.addEventListener('drop', (e) => {
      e.preventDefault();
      const toIndex = ul.dataset.dropIndex != null ? Number(ul.dataset.dropIndex) : computeIndexFromPoint(ul, e);
      if (dragData.fromList === 'inProgress' && listName === 'someday') {
        // move from inProgress -> someday
        const item = state.inProgress.splice(dragData.fromIndex, 1)[0];
        if (!item) return;
        state.someday.splice(Math.min(toIndex, state.someday.length), 0, item);
        saveState();
        render();
        return;
      }
      if (dragData.fromList === 'someday' && listName === 'inProgress') {
        // move from someday -> inProgress
        const item = state.someday.splice(dragData.fromIndex, 1)[0];
        if (!item) return;
        state.inProgress.splice(Math.min(toIndex, state.inProgress.length), 0, item);
        saveState();
        render();
        return;
      }
      if (dragData.fromList === listName) {
        const arr = listName === 'inProgress' ? state.inProgress : state.someday;
        const [item] = arr.splice(dragData.fromIndex, 1);
        if (!item) return;
        const insertAt = Math.min(toIndex, arr.length);
        arr.splice(insertAt, 0, item);
        saveState();
        render();
      }
      ul.classList.remove('droppable--over');
      const ind = ul.querySelector('.drop-indicator');
      if (ind) ind.remove();
    });
    ul.addEventListener('dragend', () => {
      ul.classList.remove('droppable--over');
      const dragging = ul.querySelector('.dragging');
      if (dragging) dragging.classList.remove('dragging');
      const ind = ul.querySelector('.drop-indicator');
      if (ind) ind.remove();
    });
  }

  attachDnd(el.inProgressList, 'inProgress');
  attachDnd(el.somedayList, 'someday');

  // Load saved state and initial render
  loadState();
  render();
})();
