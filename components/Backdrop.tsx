'use client';

import { useEffect, useRef } from 'react';

// Fluid background: a WebGL fragment shader doing domain-warped fbm noise
// in a dim smoke palette (ink -> dusk violet -> slate -> orchid). The
// cursor stirs the field — a soft swirl and glow follow the pointer and
// settle when it stops. Renders at reduced resolution, pauses when the
// tab is hidden, respects prefers-reduced-motion, and falls back to a
// static gradient without WebGL.

const FRAG = `
precision highp float;
uniform float u_time;
uniform vec2 u_res;
uniform vec2 u_mouse;
uniform float u_mstr;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = uv * asp;
  float t = u_time * 0.09;

  // cursor influence: a soft swirl well around the pointer
  vec2 m = u_mouse * asp;
  vec2 dm = p - m;
  float md = length(dm);
  float well = exp(-md * md * 7.0) * u_mstr;
  vec2 swirl = vec2(-dm.y, dm.x) * well * 1.6;

  vec2 q = vec2(fbm(p * 1.2 + t), fbm(p * 1.2 - t * 0.6 + 4.0));
  vec2 r = vec2(
    fbm(p * 1.6 + q * 2.2 + swirl + vec2(1.7, 9.2) + t * 1.2),
    fbm(p * 1.6 + q * 2.2 + swirl + vec2(8.3, 2.8) - t * 0.9)
  );
  float f = fbm(p * 1.4 + r * 2.4 + swirl * 0.8);

  vec3 ink    = vec3(0.016, 0.018, 0.032);
  vec3 dusk   = vec3(0.24, 0.20, 0.46);
  vec3 slate  = vec3(0.15, 0.20, 0.38);
  vec3 orchid = vec3(0.42, 0.24, 0.55);
  vec3 mist   = vec3(0.42, 0.42, 0.62);

  vec3 col = mix(ink, dusk, smoothstep(0.12, 0.72, f));
  col = mix(col, slate, smoothstep(0.3, 0.9, q.y * f * 1.8) * 0.85);
  col = mix(col, orchid, smoothstep(0.48, 0.98, r.x * f * 1.6) * 0.55);
  col = mix(col, mist, smoothstep(0.68, 1.05, r.y * q.x * 2.1) * 0.28);

  // faint luminous halo where the cursor stirs
  col += vec3(0.24, 0.20, 0.42) * well * 0.7;

  float vig = smoothstep(1.35, 0.35, length(uv - vec2(0.5, 0.45)));
  col *= mix(0.85, 1.05, vig);
  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export function Backdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false });
    if (!gl) return; // CSS fallback stays visible

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');
    const uStr = gl.getUniformLocation(prog, 'u_mstr');

    const SCALE = 0.35;
    const resize = () => {
      canvas.width = Math.max(420, Math.floor(window.innerWidth * SCALE));
      canvas.height = Math.max(300, Math.floor(window.innerHeight * SCALE));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    // smoothed cursor: position eases toward the pointer, strength rises
    // with movement and decays when it stops — the stir settles naturally
    let tx = 0.5, ty = 0.5, mx = 0.5, my = 0.5, str = 0, targetStr = 0;
    const onMove = (e: MouseEvent) => {
      const nx = e.clientX / window.innerWidth;
      const ny = 1 - e.clientY / window.innerHeight;
      targetStr = Math.min(1, targetStr + Math.hypot(nx - tx, ny - ty) * 14);
      tx = nx;
      ty = ny;
    };
    window.addEventListener('mousemove', onMove);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let running = true;
    const start = performance.now();

    const frame = () => {
      if (!running) return;
      mx += (tx - mx) * 0.06;
      my += (ty - my) * 0.06;
      targetStr *= 0.965;
      str += (targetStr - str) * 0.08;
      gl.uniform1f(uTime, (performance.now() - start) / 1000);
      gl.uniform2f(uMouse, mx, my);
      gl.uniform1f(uStr, reduced ? 0 : str);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame();

    const onVis = () => {
      running = !document.hidden;
      if (running && !reduced) frame();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <>
      {/* static fallback + base coat while the shader boots */}
      <div className="backdrop-fallback" />
      <canvas ref={canvasRef} className="fluid" aria-hidden="true" />
      <div className="veil" />
      <div className="grain" />
    </>
  );
}
