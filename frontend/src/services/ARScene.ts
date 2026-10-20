import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAD_PART_METADATA } from '../constants/cadPartNames';

export type FilterMode = 'realistic' | 'blue' | 'red';

export interface TransformState {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

export interface LabelInfo {
  visible: boolean;
  x: number;
  y: number;
  name: string;
  displayName: string;
  isHover: boolean;
}

export function formatPartName(rawName?: string | null): string {
  if (!rawName || !rawName.trim()) {
    return 'Unnamed part';
  }
  const trimmed = rawName.trim();
  const genericCadMatch = trimmed.match(/^(?:body|solid|mesh|component|part)[-_ ]*(\d+)$/i);
  if (genericCadMatch) {
    return `Part ${genericCadMatch[1]}`;
  }
  let formatted = trimmed.replace(/_+/g, ' ');
  formatted = formatted.replace(/\s+/g, ' ').trim();
  if (!formatted) {
    return 'Unnamed part';
  }
  return formatted;
}

export class ARScene {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private modelRoot: THREE.Group;
  private loader: GLTFLoader;
  private raycaster: THREE.Raycaster;

  private reqId: number | null = null;
  private isOscillating: boolean = false;
  private oscillationTime: number = 0;
  private currentFilter: FilterMode = 'realistic';

  // Material management: always store clones of the true originals
  private originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();
  private activeClonedMaterials: THREE.Material[] = [];

  // Selection & Isolation State
  private selectedNode: THREE.Object3D | null = null;
  private hoverNode: THREE.Object3D | null = null;
  private highlightTimeoutId: number | null = null;
  private groupMap: Map<string, THREE.Object3D[]> = new Map();

  // Pointer interaction state
  private isPointerDown: boolean = false;
  private pointerButton: number = 0;
  private pointerDownX: number = 0;
  private pointerDownY: number = 0;
  private pointerDownTime: number = 0;
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;
  private initialPinchDist: number | null = null;
  private isTouchDevice: boolean = false;

  // Callbacks
  private onTransformChange?: (transform: TransformState) => void;
  private onPartSelectCallback?: (name: string | null) => void;
  private onLabelUpdate?: (info: LabelInfo) => void;
  private onInteractionEnd?: () => void;
  private wheelEndTimer: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onTransformChange?: (transform: TransformState) => void,
    onPartSelect?: (name: string | null) => void,
    onLabelUpdate?: (info: LabelInfo) => void,
    onInteractionEnd?: () => void
  ) {
    this.canvas = canvas;
    this.onTransformChange = onTransformChange;
    this.onPartSelectCallback = onPartSelect;
    this.onLabelUpdate = onLabelUpdate;
    this.onInteractionEnd = onInteractionEnd;

    this.scene = new THREE.Scene();
    this.modelRoot = new THREE.Group();
    this.scene.add(this.modelRoot);

    const width = canvas.parentElement?.clientWidth || window.innerWidth;
    const height = canvas.parentElement?.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.05, 100);
    this.camera.position.set(0, 0, 3);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.loader = new GLTFLoader();
    this.raycaster = new THREE.Raycaster();

    this.setupLighting();
    this.setupPointerControls();
    this.startLoop();

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(4, 6, 5);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x818cf8, 0.8);
    dirLight2.position.set(-4, -2, -3);
    this.scene.add(dirLight2);
  }

  private handleResize = (): void => {
    if (!this.canvas.parentElement) return;
    const width = this.canvas.parentElement.clientWidth;
    const height = this.canvas.parentElement.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };

  private startLoop(): void {
    const animate = () => {
      this.reqId = requestAnimationFrame(animate);

      if (this.isOscillating) {
        this.oscillationTime += 0.015;
        this.modelRoot.position.y = Math.sin(this.oscillationTime) * 0.1;
        this.modelRoot.rotation.y += 0.005;
        this.notifyTransform();
      }

      this.updateLabelPosition();
      this.renderer.render(this.scene, this.camera);
    };
    this.reqId = requestAnimationFrame(animate);
  }

  private updateLabelPosition(): void {
    const targetNode = this.selectedNode || (!this.isTouchDevice ? this.hoverNode : null);
    if (!targetNode || !this.onLabelUpdate) {
      if (this.onLabelUpdate) {
        this.onLabelUpdate({
          visible: false,
          x: 0,
          y: 0,
          name: '',
          displayName: '',
          isHover: false,
        });
      }
      return;
    }

    const box = new THREE.Box3();
    if (targetNode.userData?.group && this.groupMap.has(targetNode.userData.group)) {
      const gNodes = this.groupMap.get(targetNode.userData.group)!;
      for (const gn of gNodes) {
        box.union(new THREE.Box3().setFromObject(gn));
      }
    } else {
      box.setFromObject(targetNode);
    }
    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    box.getCenter(center);
    center.project(this.camera);

    const displayName = targetNode.userData?.displayName || formatPartName(targetNode.name);

    // If target is behind camera, don't show
    if (center.z > 1) {
      this.onLabelUpdate({
        visible: false,
        x: 0,
        y: 0,
        name: targetNode.name,
        displayName,
        isHover: !this.selectedNode,
      });
      return;
    }

    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;

    let screenX = ((center.x + 1) * width) / 2;
    let screenY = ((-center.y + 1) * height) / 2;

    // Clamp inside canvas and keep above the model
    const marginX = 60;
    const marginY = 40;
    screenX = Math.max(marginX, Math.min(width - marginX, screenX));
    screenY = Math.max(marginY, Math.min(height - 25, screenY));

    this.onLabelUpdate({
      visible: true,
      x: screenX,
      y: screenY,
      name: targetNode.name,
      displayName,
      isHover: !this.selectedNode,
    });
  }

  public loadModel(
    url: string,
    onProgress?: (percent: number) => void,
    onError?: (err: Error) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.disposeCurrentModel();

        this.loader.load(
          url,
          (gltf) => {
            const filename = url.split('/').pop()?.split('?')[0] || '';
            this.groupMap.clear();
            const metadata = CAD_PART_METADATA[filename];
            if (metadata) {
              for (const [pathStr, info] of Object.entries(metadata)) {
                const indices = pathStr.split('.').map((s) => parseInt(s, 10));
                let curr: THREE.Object3D | null = gltf.scene;
                for (const idx of indices) {
                  if (curr && curr.children && curr.children[idx]) {
                    curr = curr.children[idx];
                  } else {
                    curr = null;
                    break;
                  }
                }
                if (curr) {
                  curr.name = info.name;
                  curr.userData.displayName = info.name;
                  curr.userData.cadPath = pathStr;
                  if (info.group) {
                    curr.userData.group = info.group;
                    const grpList = this.groupMap.get(info.group) || [];
                    grpList.push(curr);
                    this.groupMap.set(info.group, grpList);
                  }
                }
              }
            }

            const model = gltf.scene;

            // Remove any embedded cameras so they don't offset bounding box
            const camerasToRemove: THREE.Object3D[] = [];
            model.traverse((child) => {
              if ((child as THREE.Camera).isCamera) {
                camerasToRemove.push(child);
              }
            });
            camerasToRemove.forEach((cam) => cam.removeFromParent());

            model.updateMatrixWorld(true);

            // Auto-center and auto-scale to unit box
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);

            // Center model geometry at origin
            model.position.set(-center.x, -center.y, -center.z);

            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0 && isFinite(maxDim)) {
              const scaleFactor = 1.8 / maxDim;
              this.modelRoot.scale.setScalar(scaleFactor);
              this.camera.position.set(0, 0, 3);
            }

            // Cache deep clones of original materials with solid opacity
            this.originalMaterials.clear();
            model.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                if (mesh.material) {
                  if (Array.isArray(mesh.material)) {
                    const clonedArr = mesh.material.map((m) => {
                      const clone = m.clone();
                      this.makeMaterialOpaque(clone);
                      return clone;
                    });
                    mesh.material = clonedArr;
                    this.originalMaterials.set(mesh, clonedArr.map((m) => m.clone()));
                  } else {
                    const clone = mesh.material.clone();
                    this.makeMaterialOpaque(clone);
                    mesh.material = clone;
                    this.originalMaterials.set(mesh, clone.clone());
                  }
                }
              }
            });

            this.modelRoot.add(model);
            this.applyFilter();
            resolve();
          },
          (xhr) => {
            if (onProgress && xhr.total > 0) {
              onProgress(Math.round((xhr.loaded / xhr.total) * 100));
            }
          },
          (error) => {
            console.error('Error loading glTF model:', error);
            const err = new Error(`Failed to load 3D model (${url}): ${error}`);
            if (onError) onError(err);
            reject(err);
          }
        );
      } catch (e: any) {
        if (onError) onError(e);
        reject(e);
      }
    });
  }

  private makeMaterialOpaque(mat: THREE.Material): void {
    mat.transparent = false;
    mat.opacity = 1.0;
    mat.depthWrite = true;
    mat.side = THREE.DoubleSide;
    mat.needsUpdate = true;
  }

  private cleanClonedMaterials(): void {
    for (const mat of this.activeClonedMaterials) {
      mat.dispose();
    }
    this.activeClonedMaterials = [];
  }

  private restoreMeshMaterial(mesh: THREE.Mesh): void {
    mesh.renderOrder = 0;
    const original = this.originalMaterials.get(mesh);
    if (!original) return;

    if (this.currentFilter === 'realistic') {
      if (Array.isArray(original)) {
        mesh.material = original.map((m) => {
          const c = m.clone();
          this.makeMaterialOpaque(c);
          return c;
        });
      } else {
        const c = original.clone();
        this.makeMaterialOpaque(c);
        mesh.material = c;
      }
    } else {
      mesh.material = this.createFilterMaterial(this.currentFilter);
    }
  }

  private countMeshesInObject(obj: THREE.Object3D): number {
    let count = 0;
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        count++;
      }
    });
    return count;
  }

  private resolveSelectablePart(hitMesh: THREE.Mesh): THREE.Object3D {
    // 1. Check if hitMesh or any ancestor has CAD metadata
    let current: THREE.Object3D | null = hitMesh;
    let cadNamedNode: THREE.Object3D | null = null;
    while (current && current !== this.modelRoot && current !== this.scene) {
      if (current.userData?.displayName || current.userData?.group) {
        cadNamedNode = current;
      }
      current = current.parent;
    }
    if (cadNamedNode) {
      return cadNamedNode;
    }

    // 2. Default logic: highest named ancestor with <= 40% meshes
    const totalMeshes = this.countMeshesInObject(this.modelRoot);
    if (totalMeshes <= 1) {
      return hitMesh;
    }

    const maxMeshes = 0.4 * totalMeshes;
    let highestNamedAncestor: THREE.Object3D | null = null;

    current = hitMesh;
    while (current && current !== this.modelRoot && current !== this.scene) {
      const name = current.name ? current.name.trim() : '';
      if (name.length > 0) {
        const count = this.countMeshesInObject(current);
        if (count <= maxMeshes) {
          highestNamedAncestor = current;
        } else {
          break;
        }
      }
      current = current.parent;
    }

    return highestNamedAncestor || hitMesh;
  }

  private applyIsolation(): void {
    this.cleanClonedMaterials();

    if (!this.selectedNode) {
      this.originalMaterials.forEach((_, mesh) => {
        this.restoreMeshMaterial(mesh);
      });
      return;
    }

    const isolatedMeshes = new Set<THREE.Mesh>();
    if (this.selectedNode.userData?.group && this.groupMap.has(this.selectedNode.userData.group)) {
      const groupNodes = this.groupMap.get(this.selectedNode.userData.group)!;
      for (const gNode of groupNodes) {
        gNode.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            isolatedMeshes.add(child as THREE.Mesh);
          }
        });
      }
    } else {
      this.selectedNode.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          isolatedMeshes.add(child as THREE.Mesh);
        }
      });
    }

    this.originalMaterials.forEach((original, mesh) => {
      const isIsolated = isolatedMeshes.has(mesh);

      if (isIsolated) {
        // Fully solid with slight emissive tint
        mesh.renderOrder = 1;
        if (Array.isArray(original)) {
          mesh.material = original.map((m) => {
            const clone = m.clone();
            this.makeMaterialOpaque(clone);
            if ('emissive' in clone && (clone as any).emissive) {
              (clone as any).emissive.set(0x38bdf8);
              (clone as any).emissiveIntensity = 0.35;
            }
            this.activeClonedMaterials.push(clone);
            return clone;
          });
        } else {
          const clone = original.clone();
          this.makeMaterialOpaque(clone);
          if ('emissive' in clone && (clone as any).emissive) {
            (clone as any).emissive.set(0x38bdf8);
            (clone as any).emissiveIntensity = 0.35;
          }
          this.activeClonedMaterials.push(clone);
          mesh.material = clone;
        }
      } else {
        // See-through: opacity 0.12, depthWrite false
        mesh.renderOrder = 0;
        if (Array.isArray(original)) {
          mesh.material = original.map((m) => {
            const clone = m.clone();
            clone.transparent = true;
            clone.opacity = 0.12;
            clone.depthWrite = false;
            clone.depthTest = true;
            clone.needsUpdate = true;
            this.activeClonedMaterials.push(clone);
            return clone;
          });
        } else {
          const clone = original.clone();
          clone.transparent = true;
          clone.opacity = 0.12;
          clone.depthWrite = false;
          clone.depthTest = true;
          clone.needsUpdate = true;
          this.activeClonedMaterials.push(clone);
          mesh.material = clone;
        }
      }
    });
  }

  public selectNode(node: THREE.Object3D | null, notifyCallback: boolean = true): void {
    if (this.highlightTimeoutId !== null) {
      clearTimeout(this.highlightTimeoutId);
      this.highlightTimeoutId = null;
    }

    this.selectedNode = node;
    this.hoverNode = null;
    this.applyIsolation();

    if (notifyCallback && this.onPartSelectCallback) {
      const partIdentifier = node
        ? (node.userData?.cadPath || node.userData?.displayName || node.name || 'Unnamed part')
        : null;
      this.onPartSelectCallback(partIdentifier);
    }
  }

  public selectPart(name: string | null, notifyCallback: boolean = false): boolean {
    if (name === null) {
      this.selectNode(null, notifyCallback);
      return true;
    }

    const query = name.trim();
    if (!query) {
      this.selectNode(null, notifyCallback);
      return true;
    }

    const lower = query.toLowerCase();
    let foundNode: THREE.Object3D | null = null;

    // Check group matches first
    if (this.groupMap.has(query)) {
      foundNode = this.groupMap.get(query)![0];
    } else {
      for (const [grpKey, grpList] of this.groupMap.entries()) {
        if (grpKey.toLowerCase() === lower && grpList.length > 0) {
          foundNode = grpList[0];
          break;
        }
      }
    }

    // 0. Exact match on cadPath or child-index path
    if (!foundNode) {
      this.modelRoot.traverse((child) => {
        if (!foundNode) {
          if (child.userData?.cadPath === query) {
            foundNode = child;
          }
        }
      });
    }

    // 1. Exact match on raw name or displayName
    if (!foundNode) {
      this.modelRoot.traverse((child) => {
        if (!foundNode) {
          if (child.name === query || child.userData?.displayName === query) {
            foundNode = child;
          }
        }
      });
    }

    // 2. Exact match on formatted name
    if (!foundNode) {
      this.modelRoot.traverse((child) => {
        if (!foundNode) {
          if (formatPartName(child.name) === query) {
            foundNode = child;
          }
        }
      });
    }

    // 3. Case-insensitive match on displayName or formatted name
    if (!foundNode) {
      this.modelRoot.traverse((child) => {
        if (!foundNode) {
          const formatted = formatPartName(child.name).toLowerCase();
          const disp = (child.userData?.displayName || '').toLowerCase();
          const raw = (child.name || '').toLowerCase();
          if (disp === lower || raw === lower || formatted === lower) {
            foundNode = child;
          }
        }
      });
    }

    if (!foundNode) {
      return false;
    }

    this.selectNode(foundNode, notifyCallback);
    return true;
  }

  public highlightObject(name: string): boolean {
    const success = this.selectPart(name, false);
    if (success) {
      if (this.highlightTimeoutId !== null) {
        clearTimeout(this.highlightTimeoutId);
      }
      this.highlightTimeoutId = window.setTimeout(() => {
        this.selectPart(null, false);
      }, 4000);
    }
    return success;
  }

  public addPrimitive(type: 'sphere' | 'cube', position?: [number, number, number]): void {
    const pos = position || [0, 0, 0];
    const material = new THREE.MeshStandardMaterial({
      color: type === 'sphere' ? 0x06b6d4 : 0xec4899,
      roughness: 0.3,
      metalness: 0.2,
    });
    const geometry =
      type === 'sphere'
        ? new THREE.SphereGeometry(0.35, 32, 32)
        : new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${type.charAt(0).toUpperCase() + type.slice(1)} Primitive`;
    mesh.position.set(pos[0], pos[1], pos[2]);
    this.modelRoot.add(mesh);
  }

  private disposeCurrentModel(): void {
    if (this.highlightTimeoutId !== null) {
      clearTimeout(this.highlightTimeoutId);
      this.highlightTimeoutId = null;
    }
    this.selectedNode = null;
    this.hoverNode = null;
    this.cleanClonedMaterials();
    this.groupMap.clear();

    if (this.onLabelUpdate) {
      this.onLabelUpdate({
        visible: false,
        x: 0,
        y: 0,
        name: '',
        displayName: '',
        isHover: false,
      });
    }

    while (this.modelRoot.children.length > 0) {
      const child = this.modelRoot.children[0];
      this.modelRoot.remove(child);
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      });
    }
    this.originalMaterials.clear();
  }

  public setTransform(transform: Partial<TransformState>): void {
    if (transform.position) {
      this.modelRoot.position.set(...transform.position);
    }
    if (transform.rotation) {
      this.modelRoot.rotation.set(...transform.rotation);
    }
    if (typeof transform.scale === 'number') {
      this.modelRoot.scale.setScalar(transform.scale);
    }
  }

  public getTransform(): TransformState {
    return {
      position: [this.modelRoot.position.x, this.modelRoot.position.y, this.modelRoot.position.z],
      rotation: [this.modelRoot.rotation.x, this.modelRoot.rotation.y, this.modelRoot.rotation.z],
      scale: this.modelRoot.scale.x,
    };
  }

  public reset(): void {
    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.rotation.set(0, 0, 0);
    this.modelRoot.scale.set(1, 1, 1);
    this.camera.position.set(0, 0, 3);
    this.selectNode(null);
    this.notifyTransform();
  }

  public setFilter(filter: FilterMode): void {
    this.currentFilter = filter;
    this.applyFilter();
  }

  private createFilterMaterial(filter: FilterMode): THREE.Material {
    if (filter === 'blue') {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.3,
        metalness: 0.1,
      });
      this.makeMaterialOpaque(mat);
      return mat;
    } else {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xf43f5e,
        roughness: 0.4,
        metalness: 0.2,
      });
      this.makeMaterialOpaque(mat);
      return mat;
    }
  }

  private applyFilter(): void {
    if (this.selectedNode) {
      this.applyIsolation();
      return;
    }
    this.cleanClonedMaterials();
    this.originalMaterials.forEach((_, mesh) => {
      this.restoreMeshMaterial(mesh);
    });
  }

  public toggleOscillation(enabled: boolean): void {
    this.isOscillating = enabled;
    if (!enabled) {
      this.modelRoot.position.y = 0;
      this.notifyTransform();
    }
  }

  // Pointer controls fallback
  private setupPointerControls(): void {
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });

    // Touch events for mobile/tablet pinch, drag and tap
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.selectNode(null);
    }
  };

  private getRaycastHit(clientX: number, clientY: number): THREE.Mesh | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const intersects = this.raycaster.intersectObjects(this.modelRoot.children, true);
    for (const hit of intersects) {
      if ((hit.object as THREE.Mesh).isMesh) {
        return hit.object as THREE.Mesh;
      }
    }
    return null;
  }

  private handleMouseDown = (e: MouseEvent): void => {
    this.isPointerDown = true;
    this.pointerButton = e.button;
    this.pointerDownX = e.clientX;
    this.pointerDownY = e.clientY;
    this.pointerDownTime = performance.now();
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isPointerDown) {
      // Desktop Hover Raycast
      if (!this.selectedNode) {
        const hitMesh = this.getRaycastHit(e.clientX, e.clientY);
        if (hitMesh) {
          this.hoverNode = this.resolveSelectablePart(hitMesh);
          this.canvas.style.cursor = 'pointer';
        } else {
          this.hoverNode = null;
          this.canvas.style.cursor = 'grab';
        }
      } else {
        const hitMesh = this.getRaycastHit(e.clientX, e.clientY);
        this.canvas.style.cursor = hitMesh ? 'pointer' : 'grab';
      }
      return;
    }

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;

    if (this.pointerButton === 0 && !e.shiftKey) {
      // Left drag: rotate
      this.modelRoot.rotation.y += dx * 0.01;
      this.modelRoot.rotation.x += dy * 0.01;
    } else {
      // Right drag or Shift + Left drag: pan
      this.modelRoot.position.x += dx * 0.005;
      this.modelRoot.position.y -= dy * 0.005;
    }

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.notifyTransform();
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    // Check click qualification: movement < 5px and time < 300ms
    const dist = Math.hypot(e.clientX - this.pointerDownX, e.clientY - this.pointerDownY);
    const dt = performance.now() - this.pointerDownTime;

    if (dist < 5 && dt < 300 && e.button === 0) {
      const hitMesh = this.getRaycastHit(e.clientX, e.clientY);
      if (hitMesh) {
        const part = this.resolveSelectablePart(hitMesh);
        this.selectNode(part);
      } else {
        this.selectNode(null);
      }
    }

    this.onInteractionEnd?.();
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    // Zoom by scaling the modelRoot so scale syncs across clients
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const currentScale = this.modelRoot.scale.x;
    const newScale = Math.max(0.05, Math.min(20, currentScale * zoomFactor));
    this.modelRoot.scale.setScalar(newScale);
    this.notifyTransform();

    if (this.wheelEndTimer !== null) {
      window.clearTimeout(this.wheelEndTimer);
    }
    this.wheelEndTimer = window.setTimeout(() => {
      this.wheelEndTimer = null;
      this.onInteractionEnd?.();
    }, 150);
  };

  private handleTouchStart = (e: TouchEvent): void => {
    this.isTouchDevice = true;
    if (e.touches.length === 1) {
      this.isPointerDown = true;
      this.pointerDownX = e.touches[0].clientX;
      this.pointerDownY = e.touches[0].clientY;
      this.pointerDownTime = performance.now();
      this.lastPointerX = e.touches[0].clientX;
      this.lastPointerY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      this.initialPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  };

  private handleTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    if (e.touches.length === 1 && this.isPointerDown) {
      const dx = e.touches[0].clientX - this.lastPointerX;
      const dy = e.touches[0].clientY - this.lastPointerY;
      this.modelRoot.rotation.y += dx * 0.01;
      this.modelRoot.rotation.x += dy * 0.01;
      this.lastPointerX = e.touches[0].clientX;
      this.lastPointerY = e.touches[0].clientY;
      this.notifyTransform();
    } else if (e.touches.length === 2 && this.initialPinchDist) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const pinchFactor = currentDist / this.initialPinchDist;
      const currentScale = this.modelRoot.scale.x;
      const newScale = Math.max(0.05, Math.min(20, currentScale * pinchFactor));
      this.modelRoot.scale.setScalar(newScale);
      this.initialPinchDist = currentDist;
      this.notifyTransform();
    }
  };

  private handleTouchEnd = (e: TouchEvent): void => {
    if (this.isPointerDown && e.changedTouches.length === 1 && !this.initialPinchDist) {
      const touch = e.changedTouches[0];
      const dist = Math.hypot(touch.clientX - this.pointerDownX, touch.clientY - this.pointerDownY);
      const dt = performance.now() - this.pointerDownTime;

      if (dist < 5 && dt < 300) {
        const hitMesh = this.getRaycastHit(touch.clientX, touch.clientY);
        if (hitMesh) {
          const part = this.resolveSelectablePart(hitMesh);
          this.selectNode(part);
        } else {
          this.selectNode(null);
        }
      }
    }

    this.isPointerDown = false;
    this.initialPinchDist = null;
    this.onInteractionEnd?.();
  };

  private notifyTransform(): void {
    if (this.onTransformChange) {
      this.onTransformChange(this.getTransform());
    }
  }

  public dispose(): void {
    if (this.reqId !== null) {
      cancelAnimationFrame(this.reqId);
    }
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);

    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);

    this.disposeCurrentModel();
    this.renderer.dispose();
  }
}
