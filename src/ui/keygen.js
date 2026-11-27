// The retro banner: a pixel logo over drifting stars and colour bars, and the FX switch.
(() => {
  const canvas = document.querySelector('#banner');
  const g = canvas.getContext('2d');
  const button = document.querySelector('#fx');
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  // 5×7 pixel letters, only the ones the logo needs.
  const FONT = {
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####']
  };

  window.keygenFont = FONT; // the start screen draws with the same letters

  // A fixed little number sequence places the stars.
  let seed = 7;
  const step = () => { seed = (seed * 75 + 74) % 65537; return seed / 65537; };
  const stars = Array.from({ length: 60 }, () => ({ x: step() * canvas.width, y: step() * canvas.height, speed: 0.3 + step() * 1.4 }));

  function word(text, top, size, colours, wave, frame) {
    const width = text.length * 6 * size - size;
    const start = Math.round((canvas.width - width) / 2);
    // A dark outline first, then the letters, so they stay readable over the bars.
    for (const outline of [true, false]) {
      [...text].forEach((letter, n) => {
        const lift = wave ? Math.round(Math.sin(frame / 9 + n * 0.7) * 2) : 0;
        FONT[letter].forEach((row, y) => {
          [...row].forEach((dot, x) => {
            if (dot !== '#') return;
            const left = start + n * 6 * size + x * size;
            const high = top + y * size + lift;
            g.fillStyle = outline ? '#000' : colours[Math.floor((y * colours.length) / 7)];
            if (outline) g.fillRect(left - 2, high - 2, size + 4, size + 4);
            else g.fillRect(left, high, size, size);
          });
        });
      });
    }
  }

  function draw(frame, moving) {
    g.fillStyle = '#05010f';
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (const star of stars) {
      const x = (star.x - (moving ? frame * star.speed : 0)) % canvas.width;
      g.fillStyle = star.speed > 1.1 ? '#ffffff' : star.speed > 0.7 ? '#8d86b8' : '#4b4474';
      g.fillRect(Math.round(x < 0 ? x + canvas.width : x), Math.round(star.y), 1, 1);
    }
    // Two "copper bars" gliding behind the logo.
    for (const [hue, phase] of [[290, 0], [185, Math.PI]]) {
      const y = Math.round(canvas.height / 2 + Math.sin((moving ? frame / 28 : 0.9) + phase) * 30);
      for (let i = -5; i <= 5; i++) {
        g.fillStyle = 'hsla(' + hue + ', 100%, ' + (38 - Math.abs(i) * 5) + '%, 0.45)';
        g.fillRect(0, y + i, canvas.width, 1);
      }
    }
    word('ODWD', 7, 5, ['#35f2ff', '#35f2ff', '#35f2ff', '#2ab4ff'], moving, frame);
    word('AUTOPILOT', 49, 3, ['#ff8cf9', '#ff3df5', '#d02ee8'], moving, frame);
  }

  let on = !calm.matches;
  try {
    const saved = localStorage.getItem('odwd-fx');
    if (saved) on = saved === 'on';
  } catch (error) {
    // No storage: the default stays.
  }

  let frame = 0;
  let last = 0;
  let running = 0;
  function tick(time) {
    running = requestAnimationFrame(tick);
    if (time - last < 40) return; // about 25 frames a second is plenty
    last = time;
    draw(++frame, true);
  }

  function apply() {
    document.body.classList.toggle('fx-off', !on);
    button.setAttribute('aria-pressed', String(on));
    cancelAnimationFrame(running);
    draw(frame, false);
    if (on) running = requestAnimationFrame(tick);
  }

  button.addEventListener('click', () => {
    on = !on;
    try {
      localStorage.setItem('odwd-fx', on ? 'on' : 'off');
    } catch (error) {
      // Not remembered, still switched.
    }
    apply();
  });
  apply();
})();
