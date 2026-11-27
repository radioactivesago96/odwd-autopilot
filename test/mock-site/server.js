'use strict';
// A local imitation of the Online Daily Work Diary. Used by the tests; nothing reaches the real site.
const http = require('node:http');

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const time12 = (value) => {
  const [h, m] = value.split(':').map(Number);
  return String(h % 12 || 12).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
};
const page = (title, body) => '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + title + '</title></head><body>' +
  '<nav><a href="/odwd/index.php">Dashboard</a> <a href="/odwd/daily.php">Daily Logs</a></nav>' + body + '</body></html>';

const loginPage = () => '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Login - Work Diary</title></head><body>' +
  '<form method="POST" action="/odwd/index.php"><input name="username" id="username"><input type="password" name="password" id="password">' +
  '<button type="submit">Login</button></form></body></html>';

const dashboard = (flags) => page('Dashboard - Work Diary',
  '<h4>Submit or Update a Task</h4><form id="task">' +
  (flags.editing ? '<input type="hidden" name="task_id" value="7">' : '') +
  '<input type="hidden" name="user_id" value="3">' +
  '<label for="log_date">Date</label><input type="date" id="log_date">' +
  '<label for="start_time">Start Time</label><input type="time" id="start_time">' +
  '<label for="end_time">End Time</label><input type="time" id="end_time">' +
  (flags.noNight ? '' : '<label><input type="checkbox" id="nightshift"> Night shift</label>') +
  '<label for="task_description">Task Description</label><textarea id="task_description"></textarea>' +
  '<button type="submit">Save Task</button></form><script>' +
  'document.getElementById("task").addEventListener("submit", function (event) {' +
  ' event.preventDefault();' +
  ' var v = function (id) { var el = document.getElementById(id); return el ? (el.type === "checkbox" ? el.checked : el.value) : null; };' +
  ' fetch("/odwd/save.php", { method: "POST", body: JSON.stringify({ date: v("log_date"), start: v("start_time"), end: v("end_time"), night: v("nightshift"), description: v("task_description") }) })' +
  '  .then(function (r) { return r.text().then(function (t) { if (!r.ok) { alert("Error saving task: " + t); return; }' +
  (flags.reloadOnSave ? ' location.reload();' : ' document.getElementById("task").reset();') + ' }); });' +
  '});</script>');

function logsPage(saved, start, end) {
  const rows = saved.filter((e) => e.date >= start && e.date <= end);
  if (!rows.length) return page('Logs', '<p>No logs found for this date.</p>');
  return page('Logs', '<table><tr><th>Start Time</th><th>End Time</th><th>Time Spent</th><th>Task Description</th></tr>' +
    rows.map((e) => '<tr><td>' + time12(e.start) + '</td><td>' + time12(e.end) + '</td><td>x</td><td>' + escape(e.description) + '</td></tr>').join('') +
    '</table>');
}

function start() {
  const saved = [];
  const flags = { failNext: false, logout: false, dropSave: false, reloadOnSave: false, noNight: false, editing: false };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const signedIn = !flags.logout && /(^|; )sid=1/.test(req.headers.cookie || '');
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
      res.end(body);
    };
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (url.pathname === '/odwd/index.php' && req.method === 'POST') {
        flags.logout = false;
        return send(302, '', { 'set-cookie': 'sid=1; path=/', location: '/odwd/index.php' });
      }
      if (url.pathname === '/odwd/save.php') {
        if (!signedIn) return send(401, 'logged out');
        if (flags.failNext) { flags.failNext = false; return send(500, 'Database is down'); }
        if (!flags.dropSave) saved.push(JSON.parse(body));
        return send(200, 'ok');
      }
      if (!signedIn) return send(200, loginPage());
      if (url.pathname === '/odwd/view_logs_detail.php') {
        return send(200, logsPage(saved, url.searchParams.get('start'), url.searchParams.get('end')));
      }
      if (url.pathname === '/odwd/index.php') return send(200, dashboard(flags));
      return send(200, page('Daily Logs', '<p>Daily logs</p>'));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: 'http://127.0.0.1:' + server.address().port,
      saved: () => saved.slice(),
      clear: () => { saved.length = 0; },
      set: (change) => Object.assign(flags, change),
      close: () => server.close()
    }));
  });
}

module.exports = { start };
