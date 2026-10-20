import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface SceneViewerProps {
  transform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
  };
  onTransformChange?: (newTransform: {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
  }) => void;
  isHost?: boolean;
}

export const SceneViewer: React.FC<SceneViewerProps> = ({ transform }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      currentMount.clientWidth / currentMount.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    currentMount.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x38bdf8, 2);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    // Initial default 3D educational model: geometric molecule-like structure
    const geometry = new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      metalness: 0.2,
      roughness: 0.3,
      wireframe: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;

    let reqId: number;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!currentMount) return;
      camera.aspect = currentMount.clientWidth / currentMount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(reqId);
      window.removeEventListener('resize', handleResize);
      currentMount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  // Sync transform changes
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.position.set(...transform.position);
      meshRef.current.rotation.set(...transform.rotation);
      meshRef.current.scale.setScalar(transform.scale);
    }
  }, [transform]);

  return <div ref={mountRef} className="w-full h-full absolute inset-0 pointer-events-none" />;
};
