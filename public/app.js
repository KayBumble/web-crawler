'use strict';

const form = document.getElementById('crawl-form');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const downloadLink = document.getElementById('download');
const formError = document.getElementById('form-error');
const filterInput = document.getElementById('filter');
const emptyMessage = document.getElementById('empty');

let activeTab = 'pages';

function link(url) {
  const a = document.createElement('a');
  a.href = url;
  a.textContent = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function addRow(panel, cells) {
  const tr = document.createElement('tr');
  for (const cell of cells) {
    const td = document.createElement('td');
    if (cell instanceof Node) td.append(cell);
    else td.textContent = cell ?? '';
    tr.append(td);
  }
  tr.hidden = !matchesFilter(tr);
  document.querySelector(`[data-panel="${panel}"] tbody`).append(tr);
  updateEmpty();
}

function matchesFilter(row) {
  const query = filterInput.value.trim().toLowerCase();
  return !query || row.textContent.toLowerCase().includes(query);
}

function updateEmpty() {
  const rows = document.querySelectorAll(`[data-panel="${activeTab}"] tbody tr:not([hidden])`);
  emptyMessage.hidden = rows.length > 0;
}

function setRunning(running) {
  startButton.disabled = running;
  stopButton.disabled = !running;
  document.getElementById('stat-status').textContent = running ? 'Crawling' : 'Idle';
}

function updateStats(stats) {
  if (!stats) return;
  setRunning(stats.running);
  for (const key of ['pages', 'files', 'queued', 'skipped', 'errors']) {
    document.getElementById(`stat-${key}`).textContent = stats[key];
  }
  if (stats.processed > 0) downloadLink.hidden = false;
}

const events = new EventSource('/api/events');
const on = (name, handler) => events.addEventListener(name, (e) => handler(JSON.parse(e.data)));

on('reset', () => {
  document.querySelectorAll('tbody').forEach((tbody) => tbody.replaceChildren());
  downloadLink.hidden = true;
  updateEmpty();
});
on('stats', updateStats);
on('page', (p) => addRow('pages', [p.title || '(untitled)', link(p.url), p.depth, p.links]));
on('file', (f) => addRow('files', [link(f.url), f.contentType || 'linked file', f.foundOn ? link(f.foundOn) : '']));
on('skipped', (s) => addRow('skipped', [link(s.url), s.reason]));
on('failed', (e) => addRow('errors', [e.url ? link(e.url) : '', e.message]));
on('done', () => setRunning(false));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  const data = new FormData(form);
  const body = {
    seeds: data.get('seeds'),
    maxPages: Number(data.get('maxPages')),
    maxDepth: Number(data.get('maxDepth')),
    politenessMs: Number(data.get('politenessMs')),
    concurrency: Number(data.get('concurrency')),
    sameHost: data.get('sameHost') === 'on',
  };
  const res = await fetch('/api/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    formError.textContent = (await res.json()).error;
    formError.hidden = false;
  }
});

stopButton.addEventListener('click', () => fetch('/api/stop', { method: 'POST' }));

document.querySelectorAll('[role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== activeTab;
    });
    updateEmpty();
  });
});

filterInput.addEventListener('input', () => {
  document.querySelectorAll('tbody tr').forEach((row) => {
    row.hidden = !matchesFilter(row);
  });
  updateEmpty();
});
