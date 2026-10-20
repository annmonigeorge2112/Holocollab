import { useState, useEffect, useCallback } from 'react';
import { socketManager } from '../services/SocketManager';
import { ARSceneHandle } from '../components/ARScene';
import { SAMPLE_MODELS, SampleModel } from '../constants/models';
import { ServerModelLoadPayload } from '../types/events';

export interface UsePresentationOptions {
  sessionId: string;
  isHost: boolean;
  arSceneRef: React.RefObject<ARSceneHandle | null>;
  models?: SampleModel[];
  initialIndex?: number;
}

export interface UsePresentationReturn {
  currentSlideIndex: number;
  currentModel: SampleModel;
  models: SampleModel[];
  isHost: boolean;
  goToSlide: (index: number) => void;
  nextSlide: () => void;
  prevSlide: () => void;
}

export function usePresentation({
  sessionId,
  isHost,
  arSceneRef,
  models = SAMPLE_MODELS,
  initialIndex = 0,
}: UsePresentationOptions): UsePresentationReturn {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(initialIndex);

  // Listen to remote model_load broadcasts (e.g. from host or late-join sync)
  useEffect(() => {
    const handleRemoteModelLoad = (data: ServerModelLoadPayload) => {
      if (!data.assetUrl) return;

      const matchedIndex = models.findIndex((m) => m.url === data.assetUrl);
      if (matchedIndex !== -1) {
        setCurrentSlideIndex(matchedIndex);
      }
      if (arSceneRef.current) {
        arSceneRef.current.loadModel(data.assetUrl);
      }
    };

    socketManager.on('model_load', handleRemoteModelLoad);

    return () => {
      socketManager.off('model_load', handleRemoteModelLoad);
    };
  }, [models, arSceneRef]);

  const goToSlide = useCallback(
    (index: number) => {
      if (index < 0 || index >= models.length) return;
      const targetModel = models[index];
      setCurrentSlideIndex(index);

      if (arSceneRef.current) {
        arSceneRef.current.loadModel(targetModel.url);
      }

      // If host, broadcast model_load to all session participants
      if (isHost && sessionId) {
        socketManager.emit('model_load', {
          sessionId,
          assetUrl: targetModel.url,
        });
      }
    },
    [models, isHost, sessionId, arSceneRef]
  );

  const nextSlide = useCallback(() => {
    goToSlide((currentSlideIndex + 1) % models.length);
  }, [currentSlideIndex, models.length, goToSlide]);

  const prevSlide = useCallback(() => {
    goToSlide((currentSlideIndex - 1 + models.length) % models.length);
  }, [currentSlideIndex, models.length, goToSlide]);

  return {
    currentSlideIndex,
    currentModel: models[currentSlideIndex] || models[0],
    models,
    isHost,
    goToSlide,
    nextSlide,
    prevSlide,
  };
}
