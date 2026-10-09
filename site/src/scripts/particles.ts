/**
 * Zarrachalar maydoni — antigravity.google uslubida.
 *
 * Ularning effektini kursor bilan suratga olib, qismlarga ajratib
 * ko'rilgan (taxmin emas):
 *
 *   1. Butun maydonda juda mayda, xira kulrang nuqtalar — "chang".
 *   2. Kursor atrofida KATTA va KENG halqa (radius ekranning ~30%).
 *      Halqa ichidagi nuqtalar rangli kapsulaga aylanadi: qisqa,
 *      qalinroq, markazdan tashqariga qaragan.
 *   3. Rang halqa bo'ylab BURCHAKKA qarab o'zgaradi (gradient aylana).
 *   4. Halqa kursorga kechikib, yumshoq ergashadi va "nafas oladi".
 *
 * Hammasi bitta shader'da: har nuqta kursorgacha masofaga qarab
 * o'zini "chang" yoki "kapsula" qilib chizadi. Kutubxonasiz (~3 KB).
 *
 * Tezlik: ekrandan chiqsa/tab yashirinsa to'xtaydi, piksel zichligi
 * 1,75 bilan cheklangan, harakat kamaytirilganda bitta jim kadr.
 */

export type Tone = 'light' | 'dark';

interface Options {
  tone: Tone;
}

const VERT = `
attribute vec2 a_base;
attribute float a_seed;
uniform vec2 u_res;
uniform float u_dpr;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_radius;
uniform float u_strength;
varying float v_ring;
varying float v_angle;
varying float v_seed;
varying float v_hue;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 p = a_base;
  float t = u_time;

  // Juda sekin suzish — maydon "tirik", lekin tinch
  p += (vec2(noise(p * 0.004 + t * 0.05), noise(p * 0.004 - t * 0.05 + 9.1)) - 0.5) * 16.0;

  vec2 d = p - u_mouse;
  float dist = length(d);
  vec2 dir = dist > 0.001 ? d / dist : vec2(1.0, 0.0);

  // Keng, yumshoq halqa; radius sekin nafas oladi, har nuqta biroz o'zgacha
  float r = u_radius * (1.0 + 0.05 * sin(t * 0.9)) + (a_seed - 0.5) * u_radius * 0.18;
  float w = u_radius * 0.25;
  // Hamma nuqta ham rangga kirmaydi — halqa siyrak va "havodor" ko'rinsin
  float keep = step(0.42, a_seed);
  float ring = exp(-pow((dist - r) / w, 2.0)) * u_strength * keep;

  // Halqadagi zarracha tashqariga biroz itariladi va nafas bilan tebranadi
  p += dir * ring * (10.0 + 6.0 * sin(t * 1.3 + a_seed * 6.2832));

  v_ring = ring;
  v_angle = atan(dir.y, dir.x);
  v_seed = a_seed;
  // Rang halqa bo'ylab burchakka bog'liq, vaqt bilan sekin aylanadi
  v_hue = fract(v_angle / 6.2832 + 0.5 + t * 0.015);

  gl_PointSize = (4.0 + ring * 8.0) * u_dpr;
  vec2 clip = (p / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_dust;
uniform float u_dustA;
varying float v_ring;
varying float v_angle;
varying float v_seed;
varying float v_hue;

vec3 palette(float h) {
  // Uch rangli yopiq aylana: c1 → c2 → c3 → c1
  float x = h * 3.0;
  if (x < 1.0) return mix(u_c1, u_c2, smoothstep(0.0, 1.0, x));
  if (x < 2.0) return mix(u_c2, u_c3, smoothstep(0.0, 1.0, x - 1.0));
  return mix(u_c3, u_c1, smoothstep(0.0, 1.0, x - 2.0));
}

void main() {
  vec2 q = gl_PointCoord - 0.5;
  float c = cos(v_angle);
  float s = sin(v_angle);
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);

  // Kapsula: halqada cho'ziladi, tashqarida nuqtaga aylanadi
  float k = smoothstep(0.08, 0.6, v_ring);
  float hl = mix(0.0, 0.17, k) * (0.7 + 0.6 * v_seed);
  float hw = mix(0.16, 0.17, k);
  vec2 a = vec2(clamp(q.x, -hl, hl), 0.0);
  float dd = length(q - a);
  float shape = 1.0 - smoothstep(hw - 0.05, hw, dd);

  vec3 col = mix(u_dust, palette(v_hue), k);
  float alpha = shape * mix(u_dustA * (0.5 + v_seed), 0.95, k);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

/* Brend: teal → ko'k → binafsha. Chang — neytral kulrang. */
const PALETTE: Record<Tone, { c1: string; c2: string; c3: string; dust: string; dustA: number }> = {
  light: { c1: '#0fb39e', c2: '#3b6cff', c3: '#8b5cf6', dust: '#6b7c7a', dustA: 0.28 },
  dark: { c1: '#2cf0cf', c2: '#6f95ff', c3: '#b28cff', dust: '#cfe3df', dustA: 0.22 },
};

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[fx] shader:', gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

export function mountParticles(canvas: HTMLCanvasElement, opts: Options): () => void {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: 'low-power',
  });
  if (!gl) return () => {};

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return () => {};

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return () => {};
  gl.useProgram(prog);

  const u = (n: string) => gl.getUniformLocation(prog, n);
  const loc = {
    base: gl.getAttribLocation(prog, 'a_base'),
    seed: gl.getAttribLocation(prog, 'a_seed'),
    res: u('u_res'),
    dpr: u('u_dpr'),
    time: u('u_time'),
    mouse: u('u_mouse'),
    radius: u('u_radius'),
    strength: u('u_strength'),
  };

  const pal = PALETTE[opts.tone];
  gl.uniform3fv(u('u_c1'), rgb(pal.c1));
  gl.uniform3fv(u('u_c2'), rgb(pal.c2));
  gl.uniform3fv(u('u_c3'), rgb(pal.c3));
  gl.uniform3fv(u('u_dust'), rgb(pal.dust));
  gl.uniform1f(u('u_dustA'), pal.dustA);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const baseBuf = gl.createBuffer();
  const seedBuf = gl.createBuffer();
  let count = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  function build() {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl!.viewport(0, 0, canvas.width, canvas.height);

    // Siyrak: antigravity'da nuqtalar orasi ~30–40 px
    const spacing = w < 720 ? 30 : 34;
    const cols = Math.ceil(w / spacing) + 2;
    const rows = Math.ceil(h / spacing) + 2;
    const base = new Float32Array(cols * rows * 2);
    const seed = new Float32Array(cols * rows);
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        base[i * 2] = (x - 1 + Math.random()) * spacing;
        base[i * 2 + 1] = (y - 1 + Math.random()) * spacing;
        seed[i] = Math.random();
        i++;
      }
    }
    count = i;

    gl!.bindBuffer(gl!.ARRAY_BUFFER, baseBuf);
    gl!.bufferData(gl!.ARRAY_BUFFER, base, gl!.STATIC_DRAW);
    gl!.enableVertexAttribArray(loc.base);
    gl!.vertexAttribPointer(loc.base, 2, gl!.FLOAT, false, 0, 0);

    gl!.bindBuffer(gl!.ARRAY_BUFFER, seedBuf);
    gl!.bufferData(gl!.ARRAY_BUFFER, seed, gl!.STATIC_DRAW);
    gl!.enableVertexAttribArray(loc.seed);
    gl!.vertexAttribPointer(loc.seed, 1, gl!.FLOAT, false, 0, 0);

    gl!.uniform2f(loc.res, w, h);
    gl!.uniform1f(loc.dpr, dpr);
    // Katta halqa: kompyuterda ekranning ~30%, telefonda enining ~45%
    gl!.uniform1f(loc.radius, w < 720 ? w * 0.45 : Math.min(Math.max(w, h) * 0.28, 440));
  }

  // Kursor: halqa unga kechikib ergashadi; harakatsizlikda o'zi sekin suzadi
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, last: -1e9, strength: 0 };
  const setTarget = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = clientX - r.left;
    mouse.ty = clientY - r.top;
    mouse.last = performance.now();
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') setTarget(e.clientX, e.clientY);
  };
  const onTouch = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) setTarget(t.clientX, t.clientY);
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  canvas.parentElement?.addEventListener('touchstart', onTouch, { passive: true });
  canvas.parentElement?.addEventListener('touchmove', onTouch, { passive: true });

  build();
  mouse.x = mouse.tx = w * 0.5;
  mouse.y = mouse.ty = h * 0.46;

  let raf = 0;
  let visible = true;
  const t0 = performance.now();

  function frame(now: number) {
    raf = 0;
    if (!visible || document.hidden) return;
    const t = (now - t0) / 1000;

    const idle = now - mouse.last > (coarse ? 2500 : 4000);
    if (idle) {
      mouse.tx = w * (0.5 + 0.16 * Math.sin(t * 0.21));
      mouse.ty = h * (0.46 + 0.1 * Math.sin(t * 0.33 + 1.2));
    }
    // Kechikib ergashish — antigravity'dagi "og'irlik" hissi shundan
    const k = idle ? 0.012 : 0.05;
    mouse.x += (mouse.tx - mouse.x) * k;
    mouse.y += (mouse.ty - mouse.y) * k;
    mouse.strength += (1 - mouse.strength) * 0.03;

    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.uniform1f(loc.time, t);
    gl!.uniform2f(loc.mouse, mouse.x, mouse.y);
    gl!.uniform1f(loc.strength, mouse.strength);
    gl!.drawArrays(gl!.POINTS, 0, count);

    if (!reduced) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    },
    { rootMargin: '100px' },
  );
  io.observe(canvas);

  const onVis = () => {
    if (!document.hidden) start();
  };
  document.addEventListener('visibilitychange', onVis);

  let resizeTimer = 0;
  let lastW = window.innerWidth;
  const onResize = () => {
    // Telefonda manzil satri yashirilganda bo'y o'zgaradi — qayta qurish shart emas
    if (coarse && window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      build();
      start();
    }, 150);
  };
  window.addEventListener('resize', onResize);

  if (reduced) mouse.strength = 1;
  start();
  canvas.classList.add('is-on');

  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVis);
  };
}
