import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  ARScene,
  FilterMode,
  TransformState,
  LabelInfo,
  formatPartName,
} from '../services/ARScene';
import { RotateCcw, Activity, X } from 'lucide-react';

export interface ARSceneHandle {
  loadModel: (url: string) => Promise<void>;
  setTransform: (transform: Partial<TransformState>) => void;
  getTransform: () => TransformState;
  reset: () => void;
  highlightObject: (name: string) => boolean;
  selectPart: (name: string | null) => boolean;
  setFilter: (filter: FilterMode) => void;
  toggleOscillation: (enabled: boolean) => void;
  addPrimitive: (type: 'sphere' | 'cube', position?: [number, number, number]) => void;
}

interface ARSceneProps {
  modelUrl?: string;
  enableCamera?: boolean;
  onTransformChange?: (transform: TransformState) => void;
  onPartSelect?: (name: string | null) => void;
  onFilterChange?: (filter: FilterMode) => void;
  onInteractionEnd?: () => void;
  className?: string;
}

export const ARSceneComponent = forwardRef<ARSceneHandle, ARSceneProps>(
  (
    {
      modelUrl,
      enableCamera = true,
      onTransformChange,
      onPartSelect,
      onFilterChange,
      onInteractionEnd,
      className = '',
    },
    ref
  ) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const sceneInstanceRef = useRef<ARScene | null>(null);
    const labelRef = useRef<HTMLDivElement | null>(null);

    const onTransformChangeRef = useRef(onTransformChange);
    onTransformChangeRef.current = onTransformChange;

    const onPartSelectRef = useRef(onPartSelect);
    onPartSelectRef.current = onPartSelect;

    const onFilterChangeRef = useRef(onFilterChange);
    onFilterChangeRef.current = onFilterChange;

    const onInteractionEndRef = useRef(onInteractionEnd);
    onInteractionEndRef.current = onInteractionEnd;

    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Active control bar states
    const [filter, setFilterState] = useState<FilterMode>('realistic');
    const [oscillating, setOscillating] = useState(false);

    // Part Selection & Label States
    const [selectedPart, setSelectedPart] = useState<string | null>(null);
    const [labelMeta, setLabelMeta] = useState<{
      visible: boolean;
      isHover: boolean;
      displayName: string;
      x: number;
      y: number;
    }>({
      visible: false,
      isHover: false,
      displayName: '',
      x: 0,
      y: 0,
    });

    // Expose instance methods via imperative handle
    useImperativeHandle(ref, () => ({
      loadModel: async (url: string) => {
        if (!sceneInstanceRef.current) return;
        setLoading(true);
        setLoadError(null);
        setSelectedPart(null);
        await sceneInstanceRef.current.loadModel(
          url,
          (pct) => setProgress(pct),
          (err) => setLoadError(err.message)
        );
        setLoading(false);
      },
      setTransform: (transform) => sceneInstanceRef.current?.setTransform(transform),
      getTransform: () =>
        sceneInstanceRef.current?.getTransform() || {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: 1,
        },
      reset: () => {
        setSelectedPart(null);
        sceneInstanceRef.current?.reset();
      },
      highlightObject: (name) => sceneInstanceRef.current?.highlightObject(name) ?? false,
      selectPart: (name) => sceneInstanceRef.current?.selectPart(name) ?? false,
      setFilter: (f) => {
        setFilterState(f);
        sceneInstanceRef.current?.setFilter(f);
      },
      toggleOscillation: (enabled) => {
        setOscillating(enabled);
        sceneInstanceRef.current?.toggleOscillation(enabled);
      },
      addPrimitive: (type, pos) => {
        sceneInstanceRef.current?.addPrimitive(type, pos);
      },
    }));

    // Setup Video Feed
    useEffect(() => {
      let stream: MediaStream | null = null;
      let active = true;

      async function startVideo() {
        if (!enableCamera) return;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          });
          if (active && videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
          }
        } catch (err) {
          console.warn('Camera feed not available in ARScene', err);
        }
      }

      startVideo();

      return () => {
        active = false;
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      };
    }, [enableCamera]);

    // Setup Three.js AR Scene
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const arScene = new ARScene(
        canvas,
        (t) => onTransformChangeRef.current?.(t),
        (name) => {
          setSelectedPart(name);
          onPartSelectRef.current?.(name);
        },
        (info: LabelInfo) => {
          if (labelRef.current) {
            labelRef.current.style.left = `${info.x}px`;
            labelRef.current.style.top = `${info.y}px`;
          }
          setLabelMeta((prev) => {
            if (
              prev.visible === info.visible &&
              prev.isHover === info.isHover &&
              prev.displayName === info.displayName
            ) {
              return prev;
            }
            return {
              visible: info.visible,
              isHover: info.isHover,
              displayName: info.displayName,
              x: info.x,
              y: info.y,
            };
          });
        },
        () => onInteractionEndRef.current?.()
      );
      sceneInstanceRef.current = arScene;

      // Load model whenever modelUrl changes
      if (modelUrl) {
        setLoading(true);
        setLoadError(null);
        setSelectedPart(null);
        arScene
          .loadModel(
            modelUrl,
            (pct) => setProgress(pct),
            (err) => setLoadError(err.message)
          )
          .catch((err) => setLoadError(err.message))
          .finally(() => setLoading(false));
      }

      return () => {
        arScene.dispose();
        sceneInstanceRef.current = null;
      };
    }, [modelUrl]);

    const handleFilterChange = (newFilter: FilterMode) => {
      setFilterState(newFilter);
      sceneInstanceRef.current?.setFilter(newFilter);
      onFilterChangeRef.current?.(newFilter);
    };

    const handleOscillationToggle = () => {
      const next = !oscillating;
      setOscillating(next);
      sceneInstanceRef.current?.toggleOscillation(next);
    };

    const handleReset = () => {
      setSelectedPart(null);
      sceneInstanceRef.current?.reset();
    };

    const handleClearSelection = () => {
      setSelectedPart(null);
      sceneInstanceRef.current?.selectPart(null);
    };

    return (
      <div className={`relative w-full h-full overflow-hidden select-none bg-black ${className}`}>
        {/* Background Camera Feed */}
        {enableCamera && (
          <video
            ref={videoRef}
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1] pointer-events-none opacity-90"
          />
        )}

        {/* 3D AR Transparent Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing z-10"
        />

        {/* Dynamic 3D Anchor Label Pop-up */}
        {labelMeta.visible && (
          <div
            ref={labelRef}
            style={{
              left: `${labelMeta.x}px`,
              top: `${labelMeta.y}px`,
              transform: 'translate(-50%, -100%) translateY(-10px)',
            }}
            className={`absolute z-20 pointer-events-none transition-[opacity,background-color,border-color] duration-150 flex items-center gap-1.5 whitespace-nowrap ${
              labelMeta.isHover
                ? 'bg-white/90 text-slate-900 border border-white/60 shadow-lg text-xs font-semibold px-2.5 py-1 rounded-xl'
                : 'bg-slate-950/85 backdrop-blur-md text-slate-100 border border-purple-400/40 shadow-2xl text-xs font-semibold px-3 py-1.5 rounded-xl'
            }`}
          >
            <span>{labelMeta.displayName}</span>
            {!labelMeta.isHover && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearSelection();
                }}
                className="pointer-events-auto ml-1 p-0.5 text-slate-400 hover:text-white rounded hover:bg-white/20 transition"
                title="Clear selection (Esc)"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Persistent "Selected: ..." Status Line */}
        {selectedPart && (
          <div className="absolute top-20 left-4 z-20 flex items-center gap-2 px-3 py-1.5 bg-slate-950/85 backdrop-blur-md border border-purple-500/30 rounded-xl text-xs text-purple-200 shadow-xl pointer-events-auto animate-fadeIn">
            <span className="text-slate-400">Selected:</span>
            <span className="font-semibold text-white">{formatPartName(selectedPart)}</span>
            <button
              onClick={handleClearSelection}
              className="p-0.5 text-slate-400 hover:text-white rounded hover:bg-white/20 transition"
              title="Clear selection (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleClearSelection}
              className="ml-1 px-2 py-0.5 text-[11px] font-medium bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg transition shadow"
            >
              Show all
            </button>
          </div>
        )}

        {/* Loading Indicator */}
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-purple-400 mb-3" />
            <span className="text-xs font-mono text-purple-200">
              Loading 3D Asset {progress > 0 ? `${progress}%` : '...'}
            </span>
          </div>
        )}

        {/* Load Error Badge */}
        {loadError && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 px-4 py-2 bg-rose-950/80 border border-rose-500/40 rounded-xl text-xs text-rose-300 backdrop-blur">
            {loadError}
          </div>
        )}

        {/* Bottom Quick Controls Toolbar */}
        <div className="absolute bottom-5 left-1/2 transform -translate-x-1/2 z-20 flex items-center gap-2 p-1.5 bg-slate-900/80 backdrop-blur-md border border-purple-500/30 rounded-2xl shadow-2xl pointer-events-none">
          {/* Material Filters */}
          <div className="flex items-center gap-1 bg-purple-950/40 p-1 rounded-xl border border-purple-500/20 pointer-events-auto">
            <button
              onClick={() => handleFilterChange('realistic')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition ${
                filter === 'realistic'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-purple-300 hover:text-white'
              }`}
            >
              Realistic
            </button>
            <button
              onClick={() => handleFilterChange('blue')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition ${
                filter === 'blue'
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-purple-300 hover:text-white'
              }`}
            >
              Holo Blue
            </button>
            <button
              onClick={() => handleFilterChange('red')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition ${
                filter === 'red'
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-purple-300 hover:text-white'
              }`}
            >
              Highlight Red
            </button>
          </div>

          {/* Oscillation Toggle */}
          <button
            onClick={handleOscillationToggle}
            className={`p-2 rounded-xl text-xs font-medium border transition pointer-events-auto ${
              oscillating
                ? 'bg-purple-600 border-purple-400 text-white'
                : 'bg-purple-950/40 border-purple-500/20 text-purple-300 hover:text-white'
            }`}
            title="Toggle Float Oscillation"
          >
            <Activity className="w-4 h-4" />
          </button>

          {/* Reset Transform */}
          <button
            onClick={handleReset}
            className="p-2 bg-purple-950/40 hover:bg-purple-900/50 border border-purple-500/20 text-purple-300 hover:text-white rounded-xl transition pointer-events-auto"
            title="Reset Position"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }
);

ARSceneComponent.displayName = 'ARSceneComponent';
export default ARSceneComponent;
