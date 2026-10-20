import React, { useRef, useState, useEffect, useCallback } from 'react';
import { StrokeData } from '../types/events';
import { recognizeShape } from '../utils/shapeRecognition';
import { ARSceneHandle } from './ARScene';
import {
  Pen,
  Eraser,
  Type,
  Trash2,
  Check,
  X,
  Palette,
  Power,
} from 'lucide-react';

interface WhiteboardProps {
  onStrokeAdd: (stroke: StrokeData) => void;
  onClear?: () => void;
  externalStrokes: StrokeData[];
  isActive: boolean;
  onToggleActive?: (active: boolean) => void;
  arSceneRef?: React.RefObject<ARSceneHandle | null>;
}

type ToolMode = 'pen' | 'eraser' | 'text';

const COLOR_PALETTE = [
  '#f43f5e', // Rose
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#eab308', // Yellow
  '#a855f7', // Purple
  '#ffffff', // White
];

export const Whiteboard: React.FC<WhiteboardProps> = ({
  onStrokeAdd,
  onClear,
  externalStrokes,
  isActive,
  onToggleActive,
  arSceneRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Tools & Styling
  const [tool, setTool] = useState<ToolMode>('pen');
  const [color, setColor] = useState('#f43f5e');
  const [brushSize, setBrushSize] = useState(3);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Drawing state (all normalized coordinates: [0..1])
  const [isDrawing, setIsDrawing] = useState(false);
  const currentNormalizedStrokeRef = useRef<[number, number][]>([]);

  // Batching: buffer stroke points and broadcast every ~50ms
  const batchPointsRef = useRef<[number, number][]>([]);
  const batchIntervalRef = useRef<number | null>(null);

  // Text annotation tool state
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number } | null>(null);
  const [textInputVal, setTextInputVal] = useState('');

  // Shape Recognition Prompt
  const [shapeToast, setShapeToast] = useState<{
    type: 'sphere' | 'cube';
    position: [number, number, number];
  } | null>(null);

  /**
   * Redraw all strokes (normalized coordinates [0..1]) onto DPI-scaled canvas
   */
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Render external strokes
    externalStrokes.forEach((stroke) => {
      if (stroke.tool === 'text') {
        if (stroke.points.length > 0 && stroke.text) {
          const pt = stroke.points[0];
          ctx.save();
          ctx.fillStyle = stroke.color;
          ctx.font = `bold ${Math.max(14, stroke.width * 5)}px sans-serif`;
          ctx.fillText(stroke.text, pt[0] * width, pt[1] * height);
          ctx.restore();
        }
        return;
      }

      if (stroke.points.length < 2) return;

      ctx.save();
      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = stroke.width * 6;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width * 2;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0][0] * width, stroke.points[0][1] * height);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i][0] * width, stroke.points[i][1] * height);
      }
      ctx.stroke();
      ctx.restore();
    });

    // Render in-progress stroke if currently drawing
    const current = currentNormalizedStrokeRef.current;
    if (current.length >= 2) {
      ctx.save();
      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = brushSize * 6;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        ctx.lineWidth = brushSize * 2;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(current[0][0] * width, current[0][1] * height);
      for (let i = 1; i < current.length; i++) {
        ctx.lineTo(current[i][0] * width, current[i][1] * height);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [externalStrokes, tool, color, brushSize]);

  // Handle window resizing & devicePixelRatio
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      renderCanvas();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderCanvas]);

  useEffect(() => {
    renderCanvas();
  }, [externalStrokes, renderCanvas]);

  // Flush batched points
  const flushBatch = useCallback(() => {
    if (batchPointsRef.current.length < 2) return;
    onStrokeAdd({
      points: [...batchPointsRef.current],
      color,
      width: brushSize,
      tool,
    });
    // Keep last point for smooth continuity
    batchPointsRef.current = [batchPointsRef.current[batchPointsRef.current.length - 1]];
  }, [color, brushSize, tool, onStrokeAdd]);

  // Pointer Event Handlers (touch, pen, mouse)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isActive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    if (tool === 'text') {
      setTextInputPos({ x: normX, y: normY });
      setTextInputVal('');
      return;
    }

    setIsDrawing(true);
    canvas.setPointerCapture(e.pointerId);

    const firstPt: [number, number] = [normX, normY];
    currentNormalizedStrokeRef.current = [firstPt];
    batchPointsRef.current = [firstPt];

    // Start 50ms batching interval
    if (batchIntervalRef.current) clearInterval(batchIntervalRef.current);
    batchIntervalRef.current = window.setInterval(flushBatch, 50);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isActive || tool === 'text') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const pt: [number, number] = [normX, normY];
    currentNormalizedStrokeRef.current.push(pt);
    batchPointsRef.current.push(pt);
    renderCanvas();
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (batchIntervalRef.current) {
      clearInterval(batchIntervalRef.current);
      batchIntervalRef.current = null;
    }

    // Final flush
    if (batchPointsRef.current.length > 1) {
      onStrokeAdd({
        points: [...batchPointsRef.current],
        color,
        width: brushSize,
        tool,
      });
    }
    batchPointsRef.current = [];

    // Check for geometric shape recognition on the full stroke
    const fullStroke = currentNormalizedStrokeRef.current;
    if (tool === 'pen' && fullStroke.length >= 12) {
      const recognized = recognizeShape(fullStroke);
      if (recognized.type === 'circle') {
        const posX = (recognized.bounds.centerX - 0.5) * 2;
        const posY = -(recognized.bounds.centerY - 0.5) * 2;
        setShapeToast({ type: 'sphere', position: [posX, posY, 0] });
      } else if (recognized.type === 'rectangle') {
        const posX = (recognized.bounds.centerX - 0.5) * 2;
        const posY = -(recognized.bounds.centerY - 0.5) * 2;
        setShapeToast({ type: 'cube', position: [posX, posY, 0] });
      }
    }

    currentNormalizedStrokeRef.current = [];
    renderCanvas();
  };

  // Confirm text placement
  const handleTextConfirm = () => {
    if (textInputPos && textInputVal.trim()) {
      onStrokeAdd({
        points: [[textInputPos.x, textInputPos.y]],
        color,
        width: brushSize,
        tool: 'text',
        text: textInputVal.trim(),
      });
    }
    setTextInputPos(null);
    setTextInputVal('');
  };

  // Convert shape to 3D primitive in ARScene
  const handleConvertShape = () => {
    if (!shapeToast || !arSceneRef?.current) return;
    arSceneRef.current.addPrimitive(shapeToast.type, shapeToast.position);
    setShapeToast(null);
  };

  return (
    <>
      {/* Canvas Overlay */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`absolute inset-0 z-10 w-full h-full ${
          isActive ? 'cursor-crosshair pointer-events-auto touch-none' : 'pointer-events-none'
        }`}
      />

      {/* Text Annotation Input Box (if placed) */}
      {isActive && textInputPos && (
        <div
          className="absolute z-30 flex items-center gap-1 bg-slate-900/90 border border-purple-500/40 p-1.5 rounded-xl shadow-2xl backdrop-blur-md"
          style={{
            left: `${textInputPos.x * 100}%`,
            top: `${textInputPos.y * 100}%`,
            transform: 'translate(-10%, -120%)',
          }}
        >
          <input
            type="text"
            autoFocus
            value={textInputVal}
            onChange={(e) => setTextInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTextConfirm();
              if (e.key === 'Escape') setTextInputPos(null);
            }}
            placeholder="Type note..."
            className="bg-transparent text-xs text-white px-2 py-1 focus:outline-none w-36"
            style={{ color }}
          />
          <button
            onClick={handleTextConfirm}
            className="p-1 bg-emerald-600/80 hover:bg-emerald-500 text-white rounded-lg transition"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setTextInputPos(null)}
            className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Whiteboard Toolbar */}
      <div className="absolute top-20 left-4 z-30 flex flex-col gap-2 pointer-events-auto">
        <div className="flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-md border border-purple-500/30 p-1.5 rounded-2xl shadow-xl">
          {/* Main on/off toggle */}
          {onToggleActive && (
            <button
              onClick={() => onToggleActive(!isActive)}
              className={`p-2 rounded-xl transition ${
                isActive
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/40'
                  : 'bg-slate-800/80 text-purple-300 hover:text-white'
              }`}
              title={isActive ? 'Turn Whiteboard Off (Pass through to 3D)' : 'Turn Whiteboard On'}
            >
              <Power className="w-4 h-4" />
            </button>
          )}

          {isActive && (
            <>
              <div className="w-[1px] h-5 bg-purple-500/30" />

              {/* Pen */}
              <button
                onClick={() => setTool('pen')}
                className={`p-2 rounded-xl transition ${
                  tool === 'pen' ? 'bg-purple-600 text-white' : 'text-purple-300 hover:text-white'
                }`}
                title="Pen Tool"
              >
                <Pen className="w-4 h-4" />
              </button>

              {/* Eraser */}
              <button
                onClick={() => setTool('eraser')}
                className={`p-2 rounded-xl transition ${
                  tool === 'eraser' ? 'bg-purple-600 text-white' : 'text-purple-300 hover:text-white'
                }`}
                title="Eraser Tool"
              >
                <Eraser className="w-4 h-4" />
              </button>

              {/* Text Tool */}
              <button
                onClick={() => setTool('text')}
                className={`p-2 rounded-xl transition ${
                  tool === 'text' ? 'bg-purple-600 text-white' : 'text-purple-300 hover:text-white'
                }`}
                title="Text Annotation (Click canvas to place)"
              >
                <Type className="w-4 h-4" />
              </button>

              {/* Brush size slider */}
              <div className="flex items-center px-1">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-16 h-1 accent-purple-500 cursor-pointer"
                  title={`Brush size: ${brushSize}`}
                />
              </div>

              {/* Color picker button */}
              <div className="relative">
                <button
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  className="p-1.5 rounded-xl border border-purple-500/30 flex items-center gap-1"
                  title="Choose Colour"
                >
                  <span
                    className="w-4 h-4 rounded-full border border-white/40 shadow-inner"
                    style={{ backgroundColor: color }}
                  />
                  <Palette className="w-3 h-3 text-purple-300" />
                </button>

                {showColorPicker && (
                  <div className="absolute top-10 left-0 bg-slate-900 border border-purple-500/30 p-2 rounded-xl shadow-2xl flex gap-1.5 z-40">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setColor(c);
                          setShowColorPicker(false);
                        }}
                        className={`w-5 h-5 rounded-full border transition hover:scale-110 ${
                          color === c ? 'border-white ring-2 ring-purple-400' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Clear canvas */}
              {onClear && (
                <button
                  onClick={onClear}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-rose-600/80 text-rose-300 hover:text-white transition"
                  title="Clear Whiteboard for All"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Shape Recognition 3D Conversion Toast */}
      {shapeToast && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 bg-slate-900/95 border border-cyan-500/50 rounded-2xl shadow-2xl backdrop-blur-md animate-fade-in pointer-events-auto">
          <span className="text-xs text-cyan-200">
            Convert recognized shape to <strong>{shapeToast.type === 'sphere' ? 'Sphere' : 'Cube'}</strong>?
          </span>
          <button
            onClick={handleConvertShape}
            className="flex items-center gap-1 px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold transition"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Yes</span>
          </button>
          <button
            onClick={() => setShapeToast(null)}
            className="p-1 text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
};
