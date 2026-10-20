import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useAuth } from '../context/AuthContext';
import {
  Box,
  Hand,
  Bot,
  PenTool,
  Video,
  BarChart3,
  ArrowRight,
  Sparkles,
  Layers,
  Share2,
  Cpu,
  LogIn,
  LayoutDashboard,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [roomCode, setRoomCode] = useState('');
  const [webGLSupported, setWebGLSupported] = useState(true);

  // Canvas & Three.js Hero refs
  const heroContainerRef = useRef<HTMLDivElement>(null);
  const heroCanvasRef = useRef<HTMLCanvasElement>(null);
  const demoCanvasRef = useRef<HTMLCanvasElement>(null);
  const mousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scrollProgress = useRef<number>(0);
  const isTabVisible = useRef<boolean>(true);
  const isHeroInView = useRef<boolean>(true);

  // Handle Room Code submission
  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();
    if (cleanCode.length > 0) {
      navigate(`/lobby/${cleanCode}`);
    }
  };

  // 1. Hero Three.js Setup with Scroll-Linked Pose & Mouse Parallax
  useEffect(() => {
    const canvas = heroCanvasRef.current;
    if (!canvas) return;

    // Check WebGL availability safely
    try {
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        setWebGLSupported(false);
        return;
      }
    } catch {
      setWebGLSupported(false);
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Three scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020617, 0.08);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.8, 4.2);

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
    } catch {
      setWebGLSupported(false);
      return;
    }

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xa855f7, 3.5); // Purple glow
    keyLight.position.set(3, 4, 3);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 2.5); // Cyan fill
    fillLight.position.set(-3, 2, -2);
    scene.add(fillLight);

    // Subtle floor grid
    const grid = new THREE.GridHelper(20, 30, 0x9333ea, 0x1e1b4b);
    grid.position.y = -1.2;
    scene.add(grid);

    // Floating particles
    const particleCount = window.innerWidth < 768 ? 40 : 100;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 8;
      positions[i + 1] = (Math.random() - 0.5) * 6;
      positions[i + 2] = (Math.random() - 0.5) * 6;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xc084fc,
      size: 0.035,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // Model Root
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Placeholder fallback box while GLB loads
    const placeholderGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const placeholderMat = new THREE.MeshStandardMaterial({
      color: 0x7e22ce,
      roughness: 0.3,
      metalness: 0.8,
      wireframe: true,
    });
    const placeholderMesh = new THREE.Mesh(placeholderGeo, placeholderMat);
    modelGroup.add(placeholderMesh);

    // Load actual GLB engine model
    const loader = new GLTFLoader();
    loader.load(
      '/models/Mechanical_2CylinderEngine.glb',
      (gltf) => {
        modelGroup.remove(placeholderMesh);
        placeholderGeo.dispose();
        placeholderMat.dispose();

        const model = gltf.scene;
        // Center and normalize bounding box
        const bbox = new THREE.Box3().setFromObject(model);
        const center = bbox.getCenter(new THREE.Vector3());
        const size = bbox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2.0 / maxDim;

        model.position.sub(center);
        model.scale.setScalar(scale);

        // Enhance metallic/smooth shaders
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (mesh.material) {
              const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
              if (mat.roughness !== undefined) mat.roughness = 0.35;
              if (mat.metalness !== undefined) mat.metalness = 0.7;
            }
          }
        });

        modelGroup.add(model);
      },
      undefined,
      () => {
        // Fallback remains nicely visible
      }
    );

    // Resize handler
    const updateSize = () => {
      if (!canvas || !renderer) return;
      const width = canvas.parentElement?.clientWidth || window.innerWidth;
      const height = canvas.parentElement?.clientHeight || window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    // Scroll progress observer
    const onScroll = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress.current = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / 1200)) : 0;
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Mouse parallax tracking
    const onMouseMove = (e: MouseEvent) => {
      if (prefersReducedMotion) return;
      mousePos.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mousePos.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', onMouseMove);

    // Tab visibility & Intersection Observer pause logic
    const onVisibilityChange = () => {
      isTabVisible.current = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const observer = new IntersectionObserver(
      ([entry]) => {
        isHeroInView.current = entry.isIntersecting;
      },
      { threshold: 0.05 }
    );
    if (heroContainerRef.current) observer.observe(heroContainerRef.current);

    // Render loop
    let animId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (!isTabVisible.current || !isHeroInView.current || !renderer) return;

      clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Slow rotation & idle float if motion allowed
      if (!prefersReducedMotion) {
        particles.rotation.y = elapsed * 0.04;

        // Mouse parallax target
        const targetRotY = (elapsed * 0.3) + (mousePos.current.x * 0.4) + (scrollProgress.current * Math.PI * 1.5);
        const targetRotX = (mousePos.current.y * 0.25) + (scrollProgress.current * 0.2);
        const targetCamZ = 4.2 - (scrollProgress.current * 1.4); // Zoom in on scroll

        modelGroup.rotation.y += (targetRotY - modelGroup.rotation.y) * 0.05;
        modelGroup.rotation.x += (targetRotX - modelGroup.rotation.x) * 0.05;
        camera.position.z += (targetCamZ - camera.position.z) * 0.05;
        modelGroup.position.y = Math.sin(elapsed * 1.2) * 0.08 - (scrollProgress.current * 0.4);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer.disconnect();

      // Disposals
      particleGeometry.dispose();
      particleMaterial.dispose();
      scene.clear();
      renderer?.dispose();
    };
  }, []);

  // 2. Mini Live Demo Strip Canvas (Looping highlight animation)
  useEffect(() => {
    const canvas = demoCanvasRef.current;
    if (!canvas || !webGLSupported) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, canvas.clientWidth / canvas.clientHeight, 0.1, 50);
    camera.position.set(0, 1.2, 3.2);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    } catch {
      return;
    }

    const amb = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xc084fc, 2.5);
    dir.position.set(2, 3, 2);
    scene.add(dir);

    // Demo group: Central gear + orbiting inspected component
    const demoGroup = new THREE.Group();
    scene.add(demoGroup);

    const baseMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.25, 24),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 })
    );
    demoGroup.add(baseMesh);

    const pistonMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.8, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0xa855f7,
        emissive: 0x7e22ce,
        emissiveIntensity: 0.6,
        metalness: 0.9,
        roughness: 0.2,
      })
    );
    pistonMesh.position.set(0, 0.5, 0);
    demoGroup.add(pistonMesh);

    let animId: number;
    let clock = new THREE.Clock();

    const renderDemo = () => {
      animId = requestAnimationFrame(renderDemo);
      if (!isTabVisible.current || !renderer) return;

      const t = clock.getElapsedTime();
      if (!prefersReducedMotion) {
        demoGroup.rotation.y = t * 0.8;
        pistonMesh.position.y = 0.5 + Math.sin(t * 3) * 0.15;
      }
      renderer.render(scene, camera);
    };
    renderDemo();

    return () => {
      cancelAnimationFrame(animId);
      baseMesh.geometry.dispose();
      (baseMesh.material as THREE.Material).dispose();
      pistonMesh.geometry.dispose();
      (pistonMesh.material as THREE.Material).dispose();
      scene.clear();
      renderer?.dispose();
    };
  }, [webGLSupported]);

  const features = useMemo(
    () => [
      {
        icon: <Box className="w-6 h-6 text-purple-400" />,
        title: 'Shared 3D CAD Models',
        description:
          'Synchronized mechanical, electronic, and engineering specimens in real time with explode, isolate, and slice tools.',
      },
      {
        icon: <Hand className="w-6 h-6 text-cyan-400" />,
        title: 'Touchless Hand Gestures',
        description:
          'Pinch-to-zoom, rotate, and air-ink draw directly on virtual hardware using pure computer vision in your browser.',
      },
      {
        icon: <Bot className="w-6 h-6 text-indigo-400" />,
        title: 'AI Tutor in the Loop',
        description:
          'Google Gemini assistant explains assembly steps, identifies selected CAD parts, and generates interactive quizzes.',
      },
      {
        icon: <PenTool className="w-6 h-6 text-pink-400" />,
        title: 'Collaborative Whiteboard',
        description:
          'Shared canvas with geometric shape auto-detection, annotations, and instant model anchoring for engineering diagrams.',
      },
      {
        icon: <Video className="w-6 h-6 text-emerald-400" />,
        title: 'Ultra-low Latency Video',
        description:
          'Direct peer-to-peer WebRTC video grids with adaptive audio and screen sharing alongside 3D spatial viewports.',
      },
      {
        icon: <BarChart3 className="w-6 h-6 text-amber-400" />,
        title: 'Live Session Analytics',
        description:
          'Automated student engagement heatmaps, quiz scores, and downloadable post-session PDF learning summaries.',
      },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-purple-500/30 font-sans overflow-x-hidden">
      {/* Navigation Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-slate-950/70 border-b border-purple-900/30 transition-all">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="p-2 rounded-xl bg-purple-600/20 border border-purple-500/40 text-purple-400 shadow-lg shadow-purple-600/20 group-hover:scale-105 transition-transform">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-purple-200 via-purple-300 to-indigo-200 bg-clip-text text-transparent">
              HoloCollab
            </span>
          </Link>

          <nav className="flex items-center gap-4">
            {user ? (
              <Link
                to="/dashboard"
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all shadow-lg shadow-purple-600/30 hover:shadow-purple-600/50"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Go to Dashboard</span>
              </Link>
            ) : (
              <Link
                to="/login"
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-purple-500/30 text-purple-200 text-sm font-medium transition-all hover:border-purple-500/60"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign in</span>
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section with Interactive 3D Model */}
      <section
        ref={heroContainerRef}
        className="relative min-h-[92vh] flex items-center justify-center pt-24 pb-16 px-6 overflow-hidden"
      >
        {/* Fallback gradient background if WebGL fails */}
        <div
          className={`absolute inset-0 bg-gradient-to-b from-purple-950/40 via-slate-950 to-slate-950 pointer-events-none transition-opacity ${
            webGLSupported ? 'opacity-80' : 'opacity-100'
          }`}
        />

        {/* 3D Background Canvas */}
        <canvas
          ref={heroCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-0"
          aria-hidden="true"
        />

        {/* Hero Content Overlay */}
        <div className="relative z-10 max-w-4xl mx-auto text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-950/60 border border-purple-500/30 text-purple-300 text-xs font-semibold uppercase tracking-wider mb-6 backdrop-blur-md shadow-inner">
            <Cpu className="w-3.5 h-3.5" />
            Next-Gen Spatial Classroom
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold tracking-tight text-white mb-6 leading-[1.1]">
            Learn together. <br />
            <span className="bg-gradient-to-r from-purple-400 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent">
              Hands on. In 3D.
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-slate-300 max-w-2xl mb-10 leading-relaxed font-normal">
            Shared interactive CAD models, touchless hand-gesture control, and an embedded AI tutor — all directly in your browser with zero downloads.
          </p>

          {/* Action Strip: Start Session + Inline Room Join */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-lg mb-8">
            <Link
              to={user ? '/dashboard' : '/register'}
              className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-base shadow-xl shadow-purple-600/30 hover:shadow-purple-600/50 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <span>Start a session</span>
              <ArrowRight className="w-5 h-5" />
            </Link>

            <form
              onSubmit={handleJoinByCode}
              className="w-full sm:w-auto flex-1 flex items-center bg-slate-900/90 border border-purple-500/40 rounded-2xl p-1.5 focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-500/20 backdrop-blur-lg shadow-lg"
            >
              <input
                type="text"
                placeholder="ROOM CODE"
                maxLength={6}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="w-full bg-transparent px-3 py-2 text-sm text-center uppercase tracking-widest font-mono text-purple-200 placeholder:text-slate-500 focus:outline-none"
                aria-label="Enter 6-digit room code to join"
              />
              <button
                type="submit"
                disabled={!roomCode.trim()}
                className="px-4 py-2 rounded-xl bg-purple-700/60 hover:bg-purple-600 text-white text-xs font-semibold tracking-wide uppercase transition-all disabled:opacity-40 disabled:pointer-events-none"
              >
                Join
              </button>
            </form>
          </div>

          {/* Scroll Pose Hint */}
          <div className="inline-flex items-center gap-2 text-xs text-slate-400/80 animate-pulse mt-4">
            <span>Scroll to inspect internal assembly</span>
            <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
          </div>
        </div>
      </section>

      {/* Section 1: How It Works */}
      <section className="py-24 px-6 border-t border-purple-900/20 bg-slate-950/80 relative">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-xs uppercase tracking-widest font-bold text-purple-400 mb-2">Step-by-step</h2>
            <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight">How it works</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-3xl bg-slate-900/60 border border-purple-500/20 backdrop-blur-md relative overflow-hidden group hover:border-purple-500/40 transition-colors">
              <span className="text-5xl font-black text-purple-500/20 absolute top-4 right-6 group-hover:text-purple-500/30 transition-colors">
                01
              </span>
              <div className="w-12 h-12 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 mb-6">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Create a room</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Educators launch a room in seconds and select from standard engineering assemblies or upload custom glTF/GLB models.
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-slate-900/60 border border-purple-500/20 backdrop-blur-md relative overflow-hidden group hover:border-purple-500/40 transition-colors">
              <span className="text-5xl font-black text-purple-500/20 absolute top-4 right-6 group-hover:text-purple-500/30 transition-colors">
                02
              </span>
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-6">
                <Share2 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Share the code</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Invite students with a 6-character room code. No plugins or native installations needed — runs smoothly on desktop and mobile.
              </p>
            </div>

            <div className="p-8 rounded-3xl bg-slate-900/60 border border-purple-500/20 backdrop-blur-md relative overflow-hidden group hover:border-purple-500/40 transition-colors">
              <span className="text-5xl font-black text-purple-500/20 absolute top-4 right-6 group-hover:text-purple-500/30 transition-colors">
                03
              </span>
              <div className="w-12 h-12 rounded-2xl bg-fuchsia-600/20 border border-fuchsia-500/30 flex items-center justify-center text-fuchsia-400 mb-6">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Learn in 3D together</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Manipulate hardware components collaboratively with touchless gestures, whiteboard diagrams, and AI assistance.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Core Feature Cards */}
      <section className="py-24 px-6 border-t border-purple-900/20 bg-slate-900/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-xs uppercase tracking-widest font-bold text-purple-400 mb-2">Capabilities</h2>
            <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight">Built for collaborative technical education</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feat, idx) => (
              <div
                key={idx}
                className="p-6 rounded-2xl bg-slate-950/60 border border-purple-500/20 hover:border-purple-500/40 backdrop-blur-sm transition-all hover:translate-y-[-2px] flex flex-col justify-between"
              >
                <div>
                  <div className="p-3 w-fit rounded-xl bg-slate-900/90 border border-purple-500/30 mb-4 shadow-sm">
                    {feat.icon}
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{feat.title}</h3>
                  <p className="text-sm text-slate-300 leading-relaxed">{feat.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 3: Live Demo Strip */}
      <section className="py-20 px-6 border-t border-purple-900/20 bg-slate-950 relative overflow-hidden">
        <div className="max-w-5xl mx-auto rounded-3xl bg-gradient-to-r from-purple-950/40 to-slate-900/70 border border-purple-500/30 p-8 sm:p-12 flex flex-col md:flex-row items-center gap-8 shadow-2xl">
          <div className="flex-1 text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold mb-4">
              Live Inspection
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold text-white mb-4">Instant part recognition & isolation</h3>
            <p className="text-sm text-slate-300 leading-relaxed mb-6">
              Hover over or pinch any CAD component to highlight its material mesh, trigger AI part explanations, and inspect assembly clearances without losing sync with your classmates.
            </p>
            <div className="flex items-center gap-4 text-xs font-mono text-purple-300">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Live 60 FPS WebGL
              </span>
              <span>•</span>
              <span>Zero Plugin Latency</span>
            </div>
          </div>

          {/* Mini Looping Canvas */}
          <div className="w-full md:w-72 h-64 relative rounded-2xl overflow-hidden bg-slate-900/90 border border-purple-500/30 shadow-inner flex items-center justify-center">
            <canvas ref={demoCanvasRef} className="w-full h-full" aria-hidden="true" />
            <div className="absolute bottom-3 left-3 bg-purple-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg border border-purple-500/40 text-[11px] font-mono text-purple-200 pointer-events-none">
              Part #02: Piston Pin
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Built By Footer */}
      <footer className="border-t border-purple-900/30 bg-slate-950 py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 text-center sm:text-left text-sm text-slate-400">
          <div>
            <p className="font-semibold text-slate-200">HoloCollab EduMeet</p>
            <p className="text-xs text-slate-400 mt-1">
              AI + Augmented Reality Collaborative Learning Platform
            </p>
          </div>

          <div className="text-xs text-slate-400 sm:text-right">
            <p>Designed and built for advanced collaborative engineering education.</p>
            <p className="mt-1">All rights reserved © 2026</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
