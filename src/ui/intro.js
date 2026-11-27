// The start screen: the logo's pixels fly into place over stars and colour bars, then the
// reminder, then "What section are you?". The diary site is loaded only after that.
(() => {
  const intro = document.querySelector('#intro');
  const app = document.querySelector('#app');
  const canvas = document.querySelector('#splash');
  const disclaimer = document.querySelector('#disclaimer');
  const agree = document.querySelector('#agree');
  const chooser = document.querySelector('#chooser');
  const sections = [...chooser.querySelectorAll('button')];
  const g = canvas.getContext('2d');
  const FONT = window.keygenFont;

  const LENGTH = 3400; // the whole splash, in milliseconds
  const SCALE = 4; // one canvas pixel is 4×4 on screen
  const FLIGHT = 1000; // how long a dot takes to arrive
  app.inert = true; // nothing behind the start screen can be reached

  // A fixed number sequence, so the animation is the same every time.
  let seed = 11;
  const step = () => { seed = (seed * 75 + 74) % 65537; return seed / 65537; };
  const stars = Array.from({ length: 140 }, () => ({ angle: step() * Math.PI * 2, depth: step(), speed: 0.12 + step() * 0.5 }));

  let width = 0;
  let height = 0;
  let dots = [];
  let barTop = 0;

  // Places the two words in the middle and gives every dot a starting point off its place.
  function arrange() {
    width = canvas.width = Math.max(200, Math.ceil(window.innerWidth / SCALE));
    height = canvas.height = Math.max(140, Math.ceil(window.innerHeight / SCALE));
    const big = Math.max(2, Math.floor((width * 0.5) / 23));
    const small = Math.max(2, Math.floor((width * 0.66) / 53));
    const top = Math.round((height - (7 * big + 8 + 7 * small + 16)) / 2);
    seed = 29;
    dots = [];
    const word = (text, y, size, colours, wait) => {
      const left = Math.round((width - (text.length * 6 * size - size)) / 2);
      [...text].forEach((letter, n) => {
        FONT[letter].forEach((row, r) => {
          [...row].forEach((mark, c) => {
            if (mark !== '#') return;
            dots.push({
              x: left + (n * 6 + c) * size, y: y + r * size, size, letter: n,
              colour: colours[Math.floor((r * colours.length) / 7)],
              fromX: step() * width, fromY: step() < 0.5 ? -10 - step() * height : height + step() * height,
              wait: wait + step() * 500
            });
          });
        });
      });
    };
    word('ODWD', top, big, ['#35f2ff', '#35f2ff', '#35f2ff', '#2ab4ff'], 100);
    word('AUTOPILOT', top + 7 * big + 8, small, ['#ff8cf9', '#ff3df5', '#d02ee8'], 600);
    barTop = top + 7 * big + 8 + 7 * small + 10;
  }

  function draw(elapsed) {
    g.fillStyle = '#05010f';
    g.fillRect(0, 0, width, height);

    // Stars rushing outwards from the middle.
    const reach = Math.hypot(width, height) / 2;
    for (const star of stars) {
      const depth = (star.depth + (elapsed / 1000) * star.speed) % 1;
      const r = depth * depth * reach;
      g.fillStyle = depth > 0.7 ? '#ffffff' : depth > 0.4 ? '#8d86b8' : '#4b4474';
      g.fillRect(Math.round(width / 2 + Math.cos(star.angle) * r), Math.round(height / 2 + Math.sin(star.angle) * r), depth > 0.85 ? 2 : 1, 1);
    }
    // Two "copper bars" swinging behind the logo.
    for (const [hue, phase] of [[290, 0], [185, Math.PI]]) {
      const y = Math.round(height / 2 + Math.sin(elapsed / 420 + phase) * height * 0.3);
      for (let i = -8; i <= 8; i++) {
        g.fillStyle = 'hsla(' + hue + ', 100%, ' + (38 - Math.abs(i) * 4) + '%, 0.4)';
        g.fillRect(0, y + i, width, 1);
      }
    }
    // The dots arrive, then each letter bobs gently. Dark outlines go down first.
    const placed = dots.map((d) => {
      const t = Math.min(1, Math.max(0, (elapsed - d.wait) / FLIGHT));
      const ease = 1 - Math.pow(1 - t, 3);
      const bob = t === 1 ? Math.round(Math.sin(elapsed / 220 + d.letter * 0.7)) : 0;
      return { ...d, t, x: Math.round(d.fromX + (d.x - d.fromX) * ease), y: Math.round(d.fromY + (d.y - d.fromY) * ease) + bob };
    });
    g.fillStyle = '#000';
    for (const d of placed) if (d.t === 1) g.fillRect(d.x - 1, d.y - 1, d.size + 2, d.size + 2);
    for (const d of placed) {
      g.fillStyle = d.colour;
      g.fillRect(d.x, d.y, d.size, d.size);
    }
    // Loading bar.
    const wide = Math.round(width * 0.4);
    const left = Math.round((width - wide) / 2);
    g.fillStyle = '#8b6cff';
    g.fillRect(left - 1, barTop - 1, wide + 2, 5);
    g.fillStyle = '#000';
    g.fillRect(left, barTop, wide, 3);
    g.fillStyle = '#39ff88';
    const filled = Math.round(wide * Math.min(1, elapsed / (LENGTH - 300)));
    for (let x = 0; x < filled; x += 4) g.fillRect(left + x, barTop, Math.min(3, filled - x), 3);
  }

  let began = null;
  let running = 0;
  let over = false;
  function tick(time) {
    if (began === null) began = time;
    draw(time - began);
    running = requestAnimationFrame(tick);
  }

  // Ends the splash and shows the reminder. The button wakes a moment later, so the click or key
  // that skipped the splash cannot also accept the reminder.
  function finish() {
    if (over) return;
    over = true;
    clearTimeout(timer);
    cancelAnimationFrame(running);
    draw(LENGTH);
    intro.classList.add('done');
    disclaimer.hidden = false;
    setTimeout(() => { agree.disabled = false; agree.focus(); }, 700);
  }

  function skip(event) {
    if (over) return;
    event.preventDefault();
    finish();
  }

  const resized = () => { if (intro.hidden) return; arrange(); if (over) draw(LENGTH); };
  window.addEventListener('resize', resized);
  window.addEventListener('keydown', skip);
  intro.addEventListener('pointerdown', skip);
  agree.addEventListener('keydown', (event) => { if (event.repeat) event.preventDefault(); });
  // Then the section question, with last time's answer ready.
  agree.addEventListener('click', async () => {
    disclaimer.hidden = true;
    chooser.hidden = false;
    const { settings } = await window.odwd.state();
    const last = sections.find((b) => b.dataset.section === settings.category) || sections[0];
    last.classList.add('chosen');
    setTimeout(() => { for (const b of sections) b.disabled = false; last.focus(); }, 400);
  });

  for (const button of sections) {
    button.addEventListener('keydown', (event) => { if (event.repeat) event.preventDefault(); });
    button.addEventListener('click', async () => {
      for (const b of sections) b.disabled = true;
      await window.odwd.dispatch({ type: 'settings', patch: { category: button.dataset.section } });
      intro.hidden = true;
      app.inert = false;
      window.removeEventListener('keydown', skip);
      window.removeEventListener('resize', resized);
      window.odwd.enter();
    });
  }

  const timer = setTimeout(finish, LENGTH);
  arrange();
  draw(0);
  running = requestAnimationFrame(tick);
})();
