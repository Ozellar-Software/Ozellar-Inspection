import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CameraIcon,
  XIcon,
  CheckIcon,
  WarningIcon,
  TrashIcon,
} from '../../icons';
import { db } from '../../offline/db';
import { localWrite, localDelete } from '../../offline/outbox';
import './CameraCaptureModal.css';

export interface CapturedPhoto {
  id: string;
  file: File;
  previewUrl: string;
  isDefect: boolean;
}

export interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSavePhotos: (photos: { file: File; isDefect: boolean }[]) => Promise<string[] | void>;
  title?: string;
}

export function CameraCaptureModal({
  isOpen,
  onClose,
  onSavePhotos,
  title,
}: CameraCaptureModalProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [captureMode, setCaptureMode] = useState<'normal' | 'defect'>('normal');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isSaving, setIsSaving] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef(true);
  const capturedRef = useRef(capturedPhotos);
  capturedRef.current = capturedPhotos;

  // Stop camera stream completely and release hardware pipeline
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      try {
        const tracks = streamRef.current.getTracks();
        tracks.forEach((track) => {
          track.stop();
          track.enabled = false;
        });
      } catch (err) {
        console.warn('Error stopping camera tracks:', err);
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch (err) {
        // ignore
      }
    }

    setStream(null);
  }, []);

  // Clean close handler that stops streams before invoking parent onClose
  const handleClose = useCallback(() => {
    stopStream();
    capturedRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setCapturedPhotos([]);
    onClose();
  }, [stopStream, onClose]);

  // Start camera stream
  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    stopStream();
    setCameraError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (isMountedRef.current) {
        setCameraError('Direct camera streaming is not supported on this browser. Use the native capture button below.');
      }
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // If component unmounted or modal closed during permission request
      if (!isMountedRef.current) {
        mediaStream.getTracks().forEach((track) => {
          track.stop();
          track.enabled = false;
        });
        return;
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      console.warn('getUserMedia ideal facing failed:', err);

      // Try fallback to any video source
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!isMountedRef.current) {
          fallbackStream.getTracks().forEach((track) => {
            track.stop();
            track.enabled = false;
          });
          return;
        }

        streamRef.current = fallbackStream;
        setStream(fallbackStream);

        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (fallbackErr: any) {
        if (!isMountedRef.current) return;
        setCameraError(
          err.name === 'NotAllowedError'
            ? 'Camera access was denied. Please allow camera permissions or use the native camera file picker.'
            : 'Could not connect to camera hardware. Use the native camera button below.'
        );
      }
    }
  }, [stopStream]);

  // Attach stream to video element whenever stream state updates
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  // Handle open/close and stream lifecycle with unmount guarantee
  useEffect(() => {
    isMountedRef.current = true;

    if (isOpen) {
      startCamera(facingMode);
    } else {
      stopStream();
      capturedRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setCapturedPhotos([]);
    }

    return () => {
      isMountedRef.current = false;
      stopStream();
      capturedRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  // Snap photo from active video stream using selected captureMode (Normal or Defect) - stored immediately!
  const handleSnap = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);

    // Trigger visual shutter flash
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 140);

    const isDefectPhoto = captureMode === 'defect';

    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
        const previewUrl = URL.createObjectURL(blob);

        // Store photo immediately!
        setIsSaving(true);
        try {
          const ids = await onSavePhotos([{ file, isDefect: isDefectPhoto }]);
          const photoId = (ids && ids[0]) || crypto.randomUUID();
          const newPhoto: CapturedPhoto = {
            id: photoId,
            file,
            previewUrl: URL.createObjectURL(blob),
            isDefect: isDefectPhoto,
          };
          setCapturedPhotos((prev) => [...prev, newPhoto]);
        } catch (err: any) {
          console.error('Failed to store captured photo:', err);
          alert(`Failed to save photo: ${err.message || 'Unknown error'}`);
        } finally {
          setIsSaving(false);
        }
      },
      'image/jpeg',
      0.92
    );
  };

  // Add photos from native file input (fallback or mobile) - stored immediately!
  const handleFallbackFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const isDefectPhoto = captureMode === 'defect';
    setIsSaving(true);
    try {
      const ids = await onSavePhotos(list.map((file) => ({ file, isDefect: isDefectPhoto })));
      const newPhotos: CapturedPhoto[] = list.map((file, idx) => ({
        id: (ids && ids[idx]) || crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        isDefect: isDefectPhoto,
      }));
      setCapturedPhotos((prev) => [...prev, ...newPhotos]);
    } catch (err: any) {
      console.error('Failed to store fallback captured photos:', err);
      alert(`Failed to save photos: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Toggle defect on captured photo (updates DB directly)
  const toggleDefect = async (id: string) => {
    const target = capturedPhotos.find((p) => p.id === id);
    if (!target) return;
    const nextDefect = !target.isDefect;
    setCapturedPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isDefect: nextDefect } : p))
    );
    try {
      const existing = await db.photos.get(id);
      if (existing) {
        await localWrite('photos', id, { ...existing, isDefect: nextDefect });
      }
    } catch (err) {
      console.error('Failed to update photo defect status:', err);
    }
  };

  // Remove photo from filmstrip & delete from DB
  const removePhoto = async (id: string) => {
    setCapturedPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    try {
      await localDelete('photos', id);
    } catch (err) {
      console.error('Failed to delete photo:', err);
    }
  };

  // Switch camera between front and back
  const handleSwitchCamera = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  const defectCount = capturedPhotos.filter((p) => p.isDefect).length;

  return (
    <div className="ccm-overlay" onClick={handleClose}>
      <div className="ccm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Hidden Canvas for Frame Capture */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Fallback Native Camera Input */}
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFallbackFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {/* ── Header ── */}
        <div className="ccm-header">
          <div className="ccm-title-wrap">
            <h2 className="ccm-title">Camera Capture</h2>
            {title && <span className="ccm-subtitle">{title}</span>}
          </div>
          <div className="ccm-header-actions">
            {!cameraError && (
              <button
                type="button"
                className="btn btn-outline btn-sm ccm-btn-switch"
                onClick={handleSwitchCamera}
                title="Switch Camera (Front/Rear)"
              >
                Switch Camera
              </button>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm ccm-btn-switch"
              onClick={() => fallbackInputRef.current?.click()}
              title="Open Device Native Camera"
            >
              <CameraIcon style={{ width: 14, height: 14 }} />
              Device Camera
            </button>
            <button
              type="button"
              className="ccm-close-btn"
              onClick={handleClose}
              disabled={isSaving}
              aria-label="Close camera"
            >
              <XIcon />
            </button>
          </div>
        </div>

        {/* ── Viewfinder Area ── */}
        <div className="ccm-viewfinder-wrap">
          {!cameraError ? (
            <div className="ccm-video-container">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="ccm-video"
              />
              {shutterFlash && <div className="ccm-shutter-flash" />}

              {/* Viewfinder crosshairs (turn red when in Defect mode) */}
              <div className={`ccm-crosshairs ${captureMode === 'defect' ? 'defect' : ''}`}>
                <span className="ccm-corner tl" />
                <span className="ccm-corner tr" />
                <span className="ccm-corner bl" />
                <span className="ccm-corner br" />
              </div>
            </div>
          ) : (
            <div className="ccm-fallback-prompt">
              <CameraIcon style={{ width: 44, height: 44, color: '#0284c7' }} />
              <p className="ccm-error-text">{cameraError}</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => fallbackInputRef.current?.click()}
              >
                <CameraIcon style={{ width: 18, height: 18 }} />
                <span>Open Device Camera</span>
              </button>
            </div>
          )}

          {/* Shutter Button Bar & Mode Selector (when camera active) */}
          {!cameraError && (
            <div className="ccm-shutter-bar">
              {/* Pre-Capture Mode Selector: choose Normal or Defect BEFORE taking picture */}
              <div className="ccm-pre-mode-bar">
                <button
                  type="button"
                  className={`ccm-mode-pill normal ${captureMode === 'normal' ? 'active' : ''}`}
                  onClick={() => setCaptureMode('normal')}
                  title="Capture next photos as Normal"
                >
                  <CheckIcon style={{ width: 13, height: 13 }} />
                  <span>Normal</span>
                </button>
                <button
                  type="button"
                  className={`ccm-mode-pill defect ${captureMode === 'defect' ? 'active' : ''}`}
                  onClick={() => setCaptureMode('defect')}
                  title="Capture next photos as Defect"
                >
                  <WarningIcon style={{ width: 13, height: 13 }} />
                  <span>Defect</span>
                </button>
              </div>

              <div className="ccm-shutter-row">
                <button
                  type="button"
                  className={`ccm-shutter-btn ${captureMode === 'defect' ? 'is-defect-mode' : ''}`}
                  onClick={handleSnap}
                  disabled={isSaving}
                  aria-label={`Capture ${captureMode} photo`}
                  title={`Capture photo (${captureMode.toUpperCase()} mode)`}
                >
                  <span className="ccm-shutter-inner" />
                </button>
              </div>

              <span className="ccm-shutter-hint">
                Mode: <b className={captureMode === 'defect' ? 'ccm-hint-defect' : 'ccm-hint-normal'}>{captureMode.toUpperCase()}</b> • Tap shutter to snap & store image directly
              </span>
            </div>
          )}
        </div>

        {/* ── Snapped Photos Filmstrip / Classification (Shows once photos are captured) ── */}
        {capturedPhotos.length > 0 && (
          <div className="ccm-filmstrip-section">
            <div className="ccm-filmstrip-header">
              <span className="ccm-filmstrip-title">
                Captured & Stored ({capturedPhotos.length})
              </span>
              <span className="ccm-filmstrip-summary">
                {defectCount > 0 ? (
                  <span className="ccm-defect-text">{defectCount} Defect</span>
                ) : (
                  'All Normal'
                )}
              </span>
            </div>

            <div className="ccm-photos-row">
              {capturedPhotos.map((p, idx) => (
                <div
                  key={p.id}
                  className={`ccm-photo-chip ${p.isDefect ? 'is-defect' : 'is-normal'}`}
                >
                  <img src={p.previewUrl} alt={`Captured ${idx + 1}`} className="ccm-photo-thumb" />
                  <span className="ccm-photo-idx">{idx + 1}</span>

                  <div className="ccm-chip-controls">
                    <button
                      type="button"
                      className={`ccm-type-toggle ${p.isDefect ? 'defect' : 'normal'}`}
                      onClick={() => toggleDefect(p.id)}
                      title={p.isDefect ? 'Click to mark as Normal' : 'Click to mark as Defect'}
                    >
                      {p.isDefect ? (
                        <>
                          <WarningIcon style={{ width: 10, height: 10 }} />
                          Defect
                        </>
                      ) : (
                        <>
                          <CheckIcon style={{ width: 10, height: 10 }} />
                          Normal
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="ccm-chip-del"
                      onClick={() => removePhoto(p.id)}
                      title="Delete photo"
                    >
                      <TrashIcon style={{ width: 11, height: 11 }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
