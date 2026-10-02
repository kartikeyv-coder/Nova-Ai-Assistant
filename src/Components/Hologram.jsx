import React, { useContext, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Captions, Mic, MicOff, Sparkles } from 'lucide-react';
import { Data_Context } from '../Context/UserContext';

// ---------- palette per assistant state ----------
const PALETTE = {
  idle: { a: 0x00f3ff, b: 0x3b82f6, css: 'text-cyan-300', dot: 'bg-emerald-400', label: 'System ready' },
  listening: { a: 0xa855f7, b: 0xec4899, css: 'text-purple-300', dot: 'bg-purple-500 animate-ping', label: 'Listening…' },
  speaking: { a: 0x38bdf8, b: 0x22d3ee, css: 'text-sky-300', dot: 'bg-cyan-400 animate-pulse', label: 'NOVA speaking' },
};

const BAR_COUNT = 28;

// Fresnel glow shader (bright rim, transparent centre)
const glowVert = `
  varying vec3 vN; varying vec3 vV;
  void main(){
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const glowFrag = `
  uniform vec3 uColor; uniform float uPower; uniform float uIntensity;
  varying vec3 vN; varying vec3 vV;
  void main(){
    float f = pow(1.0 - abs(dot(vN, vV)), uPower);
    gl_FragColor = vec4(uColor, f * uIntensity);
  }`;

const HologramCore = () => {
  const mountRef = useRef(null);
  const barsRef = useRef(null);
  const levelBarRef = useRef(null);
  const clockRef = useRef(null);

  const { Speak, recognition, spokenText } = useContext(Data_Context);

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [caption, setCaption] = useState('');
  const [typed, setTyped] = useState('');
  const assistantState = isListening ? 'listening' : isSpeaking ? 'speaking' : 'idle';
  const theme = PALETTE[assistantState];

  const stateRef = useRef(assistantState);
  const is_Listening = useRef(false);
  const levelRef = useRef(0);      // live mic level 0..1
  const freqRef = useRef(null);    // live mic frequency data
  const toggleRef = useRef(() => { });

  // ---------- speech recognition control ----------
  const startListening = () => {
    if (is_Listening.current || !recognition) return;
    try { recognition.start(); } catch (e) { console.log('Speech Recognition Failed: ', e) }
    is_Listening.current = true;
    setIsListening(true);
  };

  const stop_Listening = () => {
    if (!is_Listening.current || !recognition) return;
    try { recognition.stop(); } catch (e) { /* already stopped */ }
    is_Listening.current = false;
    setIsListening(false);
  };

  const toggle = () => (is_Listening.current ? stop_Listening() : startListening());
  toggleRef.current = toggle;

  useEffect(() => { stateRef.current = assistantState; }, [assistantState]);

  // Keep UI in sync when recognition ends by itself (silence / error)
  useEffect(() => {
    if (!recognition) return;
    const onEnd = () => { is_Listening.current = false; setIsListening(false); };
    recognition.addEventListener('end', onEnd);
    recognition.addEventListener('error', onEnd);
    return () => {
      recognition.removeEventListener('end', onEnd);
      recognition.removeEventListener('error', onEnd);
    };
  }, [recognition]);

  // Detect when the browser is speaking (SpeechSynthesis)
  useEffect(() => {
    const id = setInterval(() => {
      setIsSpeaking(!!window.speechSynthesis?.speaking);
    }, 150);
    return () => clearInterval(id);
  }, []);

  // Spacebar toggles the mic
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Live clock in HUD
  useEffect(() => {
    const tick = () => {
      if (clockRef.current) clockRef.current.textContent = new Date().toLocaleTimeString([], { hour12: false });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Real microphone level while listening (drives the 3D core + waveform)
  useEffect(() => {
    if (!isListening) { levelRef.current = 0; freqRef.current = null; return; }
    let cancelled = false, raf, ctx, stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          levelRef.current = Math.min(1, (sum / data.length / 255) * 2.2);
          freqRef.current = data;
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { /* mic permission denied: fall back to simulated motion */ }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
      levelRef.current = 0;
      freqRef.current = null;
    };
  }, [isListening]);

  useEffect(() => {
    if (!spokenText) return;
    let i = 0;
    setTyped('');
    const id = setInterval(() => {
      i++;
      setTyped(spokenText.slice(0, i));
      if (i >= spokenText.length) clearInterval(id)
    }, 40)
    return () => clearInterval(id);
  }, [spokenText])

  // ---------- three.js scene ----------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let width = mount.clientWidth;
    let height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030712, 0.035);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.z = 8;
    let zoomTarget = 8;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const mainGroup = new THREE.Group();
    scene.add(mainGroup);

    // shared accent colours (lerped every frame for smooth state changes)
    const accentA = new THREE.Color(PALETTE.idle.a);
    const accentB = new THREE.Color(PALETTE.idle.b);
    const targetA = new THREE.Color();
    const targetB = new THREE.Color();

    // 1. morphing wireframe core
    const sphereGeo = new THREE.IcosahedronGeometry(2, 4);
    const sphereMat = new THREE.MeshBasicMaterial({ color: accentA, wireframe: true, transparent: true, opacity: 0.7 });
    const coreSphere = new THREE.Mesh(sphereGeo, sphereMat);
    mainGroup.add(coreSphere);
    const originalPositions = sphereGeo.attributes.position.clone();

    // 2. inner glowing core
    const innerGeo = new THREE.SphereGeometry(1.2, 32, 32);
    const innerMat = new THREE.MeshBasicMaterial({ color: accentA, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending });
    const innerSphere = new THREE.Mesh(innerGeo, innerMat);
    mainGroup.add(innerSphere);

    // 3. fresnel halo (also the click / hover hit-target)
    const haloGeo = new THREE.SphereGeometry(2.7, 48, 48);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: accentA.clone() }, uPower: { value: 2.4 }, uIntensity: { value: 0.9 } },
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    mainGroup.add(halo);

    // 4. orbital rings
    const ringGeo1 = new THREE.TorusGeometry(3.6, 0.03, 16, 120);
    const ringMat1 = new THREE.MeshBasicMaterial({ color: accentA, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
    const ring1 = new THREE.Mesh(ringGeo1, ringMat1);
    ring1.rotation.x = Math.PI / 2.6;
    mainGroup.add(ring1);

    const ringGeo2 = new THREE.TorusGeometry(4.2, 0.018, 12, 120);
    const ringMat2 = new THREE.MeshBasicMaterial({ color: accentB, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    const ring2 = new THREE.Mesh(ringGeo2, ringMat2);
    ring2.rotation.y = Math.PI / 3;
    mainGroup.add(ring2);

    // 5. data-stream ring (dots circling the core)
    const streamCount = 240;
    const streamPos = new Float32Array(streamCount * 3);
    for (let i = 0; i < streamCount; i++) {
      const a = (i / streamCount) * Math.PI * 2;
      streamPos[i * 3] = Math.cos(a) * 5;
      streamPos[i * 3 + 1] = 0;
      streamPos[i * 3 + 2] = Math.sin(a) * 5;
    }
    const streamGeo = new THREE.BufferGeometry();
    streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
    const streamMat = new THREE.PointsMaterial({ color: accentB, size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const stream = new THREE.Points(streamGeo, streamMat);
    stream.rotation.x = 0.5;
    stream.rotation.z = -0.35;
    mainGroup.add(stream);

    // 6. particle field (reacts to mouse: repelled / drawn around the cursor in 3D)
    const particleCount = 900;
    const particleGeo = new THREE.BufferGeometry();
    const basePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      const radius = 3.5 + Math.random() * 4.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      basePositions[i] = radius * Math.sin(phi) * Math.cos(theta);
      basePositions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
      basePositions[i + 2] = radius * Math.cos(phi);
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(basePositions.slice(), 3));
    const particleMat = new THREE.PointsMaterial({ color: accentA, size: 0.045, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending });
    const particleField = new THREE.Points(particleGeo, particleMat);
    mainGroup.add(particleField);

    // ---------- interaction ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(9, 9);
    let mouseX = 0, mouseY = 0;
    let hovering = false;
    let dragging = false;
    let moved = 0;
    let lastX = 0, lastY = 0;
    let userRotX = 0, userRotY = 0;
    let velX = 0, velY = 0;
    let pulse = 0; // click punch on the core
    const shockwaves = [];

    const spawnShockwave = () => {
      const geo = new THREE.RingGeometry(1, 1.06, 96);
      const mat = new THREE.MeshBasicMaterial({ color: accentA.clone(), transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      shockwaves.push({ mesh, geo, mat, born: performance.now() });
    };

    const updatePointer = (e) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseX = pointer.x;
      mouseY = pointer.y;
    };

    const onPointerDown = (e) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      mount.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e) => {
      updatePointer(e);
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        velY = dx * 0.006;
        velX = dy * 0.006;
        userRotY += velY;
        userRotX += velX;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };
    const onPointerUp = (e) => {
      dragging = false;
      mount.releasePointerCapture?.(e.pointerId);
      if (moved < 6) {
        // a click, not a drag
        updatePointer(e);
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.intersectObject(halo).length) {
          pulse = 1;
          spawnShockwave();
          toggleRef.current();
        }
      }
    };
    const onPointerLeave = () => { pointer.set(9, 9); mouseX = 0; mouseY = 0; };
    const onWheel = (e) => {
      e.preventDefault();
      zoomTarget = THREE.MathUtils.clamp(zoomTarget + e.deltaY * 0.004, 5.5, 12);
    };

    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', onPointerUp);
    mount.addEventListener('pointerleave', onPointerLeave);
    mount.addEventListener('wheel', onWheel, { passive: false });

    const handleResize = () => {
      width = mount.clientWidth;
      height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // ---------- animation ----------
    const clock = new THREE.Clock();
    let raf;
    let level = 0;
    let hoverScale = 1;
    const mouse3 = new THREE.Vector3();
    const bars = barsRef.current ? Array.from(barsRef.current.children) : [];

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const state = stateRef.current;

      // colours lerp smoothly towards the current state's palette
      targetA.setHex(PALETTE[state].a);
      targetB.setHex(PALETTE[state].b);
      accentA.lerp(targetA, 0.06);
      accentB.lerp(targetB, 0.06);
      sphereMat.color.copy(accentA);
      innerMat.color.copy(accentA);
      ringMat1.color.copy(accentA);
      particleMat.color.copy(accentA);
      ringMat2.color.copy(accentB);
      streamMat.color.copy(accentB);
      haloMat.uniforms.uColor.value.copy(accentA);

      // audio level: real mic when listening, simulated when speaking
      const target =
        state === 'listening' ? levelRef.current
          : state === 'speaking' ? 0.35 + 0.3 * Math.abs(Math.sin(t * 6) * Math.sin(t * 2.3))
            : 0;
      level += (target - level) * 0.15;

      const speed = state === 'listening' ? 2.0 : state === 'speaking' ? 1.7 : 1.0;

      // hover feedback
      raycaster.setFromCamera(pointer, camera);
      hovering = raycaster.intersectObject(halo).length > 0;
      mount.style.cursor = hovering ? 'pointer' : dragging ? 'grabbing' : 'grab';
      hoverScale += ((hovering ? 1.07 : 1) - hoverScale) * 0.1;
      pulse *= 0.92;
      const coreScale = hoverScale + pulse * 0.25 + level * 0.12;
      coreSphere.scale.setScalar(coreScale);
      innerSphere.scale.setScalar(coreScale * (1 + Math.sin(t * 2) * 0.03));
      haloMat.uniforms.uIntensity.value = 0.7 + level * 1.2 + (hovering ? 0.35 : 0) + pulse;
      sphereMat.opacity = 0.6 + level * 0.4;

      // spin
      coreSphere.rotation.y = t * 0.3 * speed;
      coreSphere.rotation.x = t * 0.15 * speed;
      ring1.rotation.z = t * 0.4 * speed;
      ring2.rotation.z = -t * 0.3 * speed;
      ring2.rotation.x = Math.sin(t * 0.5) * 0.2 + 0.3;
      stream.rotation.y = t * 0.5 * speed;
      particleField.rotation.y = -t * 0.06 * speed;

      // smooth wave morph (cheaper + nicer than per-vertex random noise)
      const amp = (state === 'idle' ? 0.06 : 0.1) + level * 0.35;
      const pos = sphereGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = originalPositions.getX(i);
        const y = originalPositions.getY(i);
        const z = originalPositions.getZ(i);
        const n = Math.sin(x * 2.2 + t * 2.4 * speed) * Math.cos(y * 2.0 + t * 1.9) * Math.sin(z * 2.4 + t * 1.5);
        const k = 1 + n * amp;
        pos.setXYZ(i, x * k, y * k, z * k);
      }
      pos.needsUpdate = true;

      // particles flow away from the cursor
      mouse3.set(mouseX * 6, mouseY * 4, 2).applyMatrix4(mainGroup.matrixWorld.clone().invert());
      const pp = particleGeo.attributes.position;
      for (let i = 0; i < particleCount; i++) {
        const bx = basePositions[i * 3];
        const by = basePositions[i * 3 + 1];
        const bz = basePositions[i * 3 + 2];
        const dx = bx - mouse3.x, dy = by - mouse3.y, dz = bz - mouse3.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const push = d2 < 6 ? (1 - d2 / 6) * 1.2 : 0;
        const len = Math.sqrt(d2) || 1;
        pp.setXYZ(
          i,
          pp.getX(i) + (bx + (dx / len) * push - pp.getX(i)) * 0.08,
          pp.getY(i) + (by + (dy / len) * push - pp.getY(i)) * 0.08,
          pp.getZ(i) + (bz + (dz / len) * push - pp.getZ(i)) * 0.08
        );
      }
      pp.needsUpdate = true;

      // drag rotation with inertia + gentle parallax
      if (!dragging) {
        velX *= 0.95;
        velY *= 0.95;
        userRotX += velX;
        userRotY += velY + 0.0012 * speed;
      }
      mainGroup.rotation.y += (userRotY + mouseX * 0.35 - mainGroup.rotation.y) * 0.08;
      mainGroup.rotation.x += (userRotX - mouseY * 0.3 - mainGroup.rotation.x) * 0.08;

      // zoom
      camera.position.z += (zoomTarget - camera.position.z) * 0.08;

      // shockwaves
      const now = performance.now();
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const s = shockwaves[i];
        const p = (now - s.born) / 1400;
        if (p >= 1) {
          scene.remove(s.mesh);
          s.geo.dispose();
          s.mat.dispose();
          shockwaves.splice(i, 1);
          continue;
        }
        s.mesh.scale.setScalar(1 + p * 6);
        s.mat.opacity = (1 - p) * 0.8;
      }

      // HUD waveform bars (DOM, no React re-render)
      const freq = freqRef.current;
      for (let i = 0; i < bars.length; i++) {
        let v;
        if (state === 'listening') v = freq ? freq[Math.floor((i / bars.length) * freq.length * 0.7)] / 255 : 0.15 + Math.abs(Math.sin(t * 5 + i)) * 0.3;
        else if (state === 'speaking') v = Math.abs(Math.sin(t * 5 + i * 0.5)) * (0.4 + 0.4 * Math.sin(t * 2 + i * 0.2) ** 2);
        else v = 0.06 + 0.04 * Math.sin(t * 1.5 + i * 0.4);
        bars[i].style.height = `${4 + v * 44}px`;
        bars[i].style.opacity = `${0.35 + v * 0.65}`;
      }
      if (levelBarRef.current) levelBarRef.current.style.width = `${Math.round(Math.min(1, level) * 100)}%`;

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', onPointerUp);
      mount.removeEventListener('pointerleave', onPointerLeave);
      mount.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      shockwaves.forEach((s) => { s.geo.dispose(); s.mat.dispose(); });
      [sphereGeo, innerGeo, haloGeo, ringGeo1, ringGeo2, streamGeo, particleGeo].forEach((g) => g.dispose());
      [sphereMat, innerMat, haloMat, ringMat1, ringMat2, streamMat, particleMat].forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, []);


  const corner = 'absolute w-8 h-8 border-cyan-400/50 pointer-events-none';

  return (
    <div className="relative w-full h-screen bg-slate-950 text-white overflow-hidden font-sans select-none">
      <style>{`
        @keyframes holo-scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
        @keyframes holo-spin { to { transform: rotate(360deg); } }
        @keyframes holo-spin-rev { to { transform: rotate(-360deg); } }
        @media (prefers-reduced-motion: reduce) { .holo-motion { animation: none !important; } }
      `}</style>

      {/* ambient background: radial glow + grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(6,182,212,0.12) 0%, rgba(3,7,18,0) 60%),' +
            'linear-gradient(rgba(34,211,238,0.05) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(34,211,238,0.05) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 48px 48px, 48px 48px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
        }}
      />

      {/* 3D canvas */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full touch-none" />

      {/* scanline sweep + CRT lines */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="holo-motion absolute left-0 w-full h-24 bg-gradient-to-b from-transparent via-cyan-400/10 to-transparent"
          style={{ animation: 'holo-scan 6s linear infinite' }}
        />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'repeating-linear-gradient(0deg, #fff 0, #fff 1px, transparent 1px, transparent 3px)' }}
        />
      </div>

      {/* HUD corner brackets */}
      {/* <div className={`${corner} top-24 left-6 border-t-2 border-l-2`} />
      <div className={`${corner} top-24 right-6 border-t-2 border-r-2`} />
      <div className={`${corner} bottom-6 left-6 border-b-2 border-l-2`} />
      <div className={`${corner} bottom-6 right-6 border-b-2 border-r-2`} /> */}

      {/* header */}
      <header className="absolute top-0 left-0 w-full px-8 py-5 flex justify-between items-center z-10 bg-slate-950/50 backdrop-blur-md border-b border-cyan-500/20">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
              Ai_Assistant
            </h1>
            <p className="text-xs tracking-widest text-cyan-400/60 uppercase">3D Quantum Hologram Core</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <span ref={clockRef} className="hidden sm:block font-mono text-sm text-cyan-300/70 tabular-nums" />
          <div className="flex items-center space-x-3 bg-slate-900/80 px-4 py-2 rounded-full border border-cyan-500/20">
            <span className={`w-2.5 h-2.5 rounded-full ${theme.dot}`} />
            <span className={`text-xs uppercase tracking-widest font-medium transition-colors duration-500 ${theme.css}`}>
              {theme.label}
            </span>
          </div>
        </div>
      </header>

      {/* left telemetry panel */}
      <aside className="hidden md:block absolute left-8 top-1/2 -translate-y-1/2 z-10 w-44 pointer-events-none">
        <div className="rounded-lg border border-cyan-500/20 bg-slate-950/50 backdrop-blur-md p-4 space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-cyan-400/60">Signal</p>
            <div className="mt-2 h-1.5 rounded-full bg-cyan-500/10 overflow-hidden">
              <div ref={levelBarRef} className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400" style={{ width: '0%' }} />
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-cyan-400/60">Mode</p>
            <p className={`mt-1 font-mono text-sm capitalize transition-colors duration-500 ${theme.css}`}>{assistantState}</p>
          </div>
          <div className="text-[11px] leading-5 text-slate-400">
            <p>Drag to rotate</p>
            <p>Scroll to zoom</p>
            <p>Click the core or press Space to talk</p>
          </div>
        </div>
      </aside>

      {/* bottom controls */}
      <div className="absolute bottom-10 left-0 w-full z-10 flex flex-col items-center space-y-5 pointer-events-none">
        {/* waveform */}
        <div ref={barsRef} className="flex items-end justify-center gap-1 h-12">
          {Array.from({ length: BAR_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`w-1 rounded-full transition-colors duration-500 ${assistantState === 'listening' ? 'bg-purple-400' : assistantState === 'speaking' ? 'bg-sky-400' : 'bg-cyan-400'
                }`}
              style={{ height: 4 }}
            />
          ))}
        </div>

        {/* mic button with spinning dial */}
        <div className="relative pointer-events-auto">
          <span
            className="holo-motion absolute -inset-3 rounded-full border border-dashed border-cyan-400/40"
            style={{ animation: `holo-spin ${isListening ? 4 : 14}s linear infinite` }}
          />
          <span
            className="holo-motion absolute -inset-5 rounded-full border border-dotted border-blue-400/30"
            style={{ animation: `holo-spin-rev ${isListening ? 6 : 20}s linear infinite` }}
          />
          <button
            onClick={toggle}
            aria-pressed={isListening}
            className={`group relative flex items-center space-x-3 px-8 py-4 rounded-full font-semibold text-sm tracking-wider uppercase transition-all duration-300 backdrop-blur-xl border focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${isListening
              ? 'bg-purple-600/30 border-purple-400 text-purple-200 shadow-[0_0_35px_rgba(168,85,247,0.5)] scale-105'
              : 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300 hover:bg-cyan-500/30 hover:border-cyan-300 shadow-[0_0_30px_rgba(6,182,212,0.3)] hover:scale-105'
              }`}
          >
            {isListening ? <Mic className="w-5 h-5 text-purple-200 animate-pulse" /> : <MicOff className="w-5 h-5 text-cyan-400" />}
            <span>{isListening ? 'Listening…' : 'Speak to NOVA'}</span>
          </button>
        </div>

        {/* live Caption */}
        <div
          className="absolute z-10 pointer-events-none
             left-1/2 -translate-x-1/2 bottom-56 w-[90%]
             md:left-auto md:translate-x-0 md:right-8 md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:w-80 lg:w-96"
        >
          <div className={`transition-all duration-500 ${spokenText ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
            <div className="rounded-lg border border-cyan-400/30 border-l-2 border-l-cyan-300 bg-slate-950/60 backdrop-blur-md px-5 py-4 shadow-[0_0_30px_rgba(56,189,248,0.2)]">
              <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-widest text-cyan-400/60 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                NOVA // transmitting
              </div>
              <p className="font-mono text-sm leading-relaxed text-sky-100 min-h-[1.5rem] max-h-64 overflow-y-auto">
                <span className="text-cyan-400/70">&gt; </span>
                {typed}
                <span className="inline-block w-2 h-4 ml-0.5 align-middle bg-cyan-300 animate-pulse" />
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HologramCore;