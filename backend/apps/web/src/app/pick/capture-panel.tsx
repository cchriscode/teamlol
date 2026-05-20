'use client';

// Experimental screen-capture → champ-select auto-detect.
//
// Flow:
//   1. User clicks "캡처 시작" → browser dialog → user picks LoL window
//   2. Live preview appears; user clicks on a champion icon in the preview
//      to register its bounding rect (one click per slot — calibration)
//   3. After all 20 slots are calibrated (10 picks + 10 bans), detection
//      loop runs every 2s: crop each rect, pHash-match against ddragon,
//      auto-fill into setPick / setBan if confidence is high.
//
// Calibration coords are saved to localStorage so the user only does it
// once per resolution.

import { useCallback, useEffect, useRef, useState } from 'react';
import { startCapture, type CaptureSession } from '@/lib/screen-capture/capture';
import { ensureHashesLoaded, matchChampion, type MatchResult } from '@/lib/screen-capture/champion-matcher';

const STORAGE_KEY = 'tlol_capture_slots_v1';
// Hamming distance threshold below which a match is considered confident.
const CONFIDENCE_DISTANCE = 14;
// Side of the cropped region around each calibration click (in source pixels).
const SLOT_HALF_SIZE = 32;

type SlotKind = 'myPick' | 'enemyPick' | 'myBan' | 'enemyBan';
interface SlotRect {
  kind: SlotKind;
  idx: number;        // 0..4 (pick) or 0..4 (ban)
  x: number; y: number; w: number; h: number;
  label: string;      // 'B1 (블루)', 'R1 (적)', '벤 1 (블루)' ...
}

const SLOT_PLAN: Array<{ kind: SlotKind; idx: number; label: string }> = [
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'myPick' as const,    idx: i, label: `우리 픽 ${i + 1}` })),
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'enemyPick' as const, idx: i, label: `적 픽 ${i + 1}` })),
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'myBan' as const,     idx: i, label: `우리 밴 ${i + 1}` })),
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'enemyBan' as const,  idx: i, label: `적 밴 ${i + 1}` })),
];

interface Props {
  championKeys: string[];
  ddragonVersion: string;
  setPick: (side: 'my' | 'enemy', idx: number, champion: string | undefined) => void;
  setBan:  (side: 'my' | 'enemy', idx: number, champion: string | undefined) => void;
}

export function CapturePanel({ championKeys, ddragonVersion, setPick, setBan }: Props) {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [slots, setSlots] = useState<SlotRect[]>(() => loadSlots());
  const [calibratingIdx, setCalibratingIdx] = useState<number>(slots.length);   // points at next slot to calibrate
  const [hashStatus, setHashStatus] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Record<string, MatchResult | null>>({});
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Preload pHashes the first time capture is mounted.
  useEffect(() => {
    if (championKeys.length === 0) return;
    ensureHashesLoaded(championKeys, ddragonVersion, (done, total) => setHashStatus({ done, total }))
      .then(() => setHashStatus({ done: championKeys.length, total: championKeys.length }))
      .catch((e) => setError(`챔프 사진 준비 실패: ${e?.message ?? e}`));
  }, [championKeys, ddragonVersion]);

  // Live preview redraw — pulled on rAF so the user sees the LoL window
  // tick in real time while calibrating.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      const canvas = previewRef.current;
      if (canvas) session.drawFrame(canvas);
      requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelled = true; };
  }, [session]);

  // Detection loop once all slots are calibrated.
  useEffect(() => {
    if (!session || slots.length < SLOT_PLAN.length) return;
    const id = setInterval(() => {
      const next: Record<string, MatchResult | null> = {};
      for (const slot of slots) {
        const cropped = session.cropFrame({ x: slot.x, y: slot.y, w: slot.w, h: slot.h });
        if (!cropped) { next[slotKey(slot)] = null; continue; }
        const matches = matchChampion(cropped, 1);
        const top = matches[0];
        next[slotKey(slot)] = top ?? null;
        if (top && top.distance <= CONFIDENCE_DISTANCE) {
          if (slot.kind === 'myPick')     setPick('my',    slot.idx, top.championKey);
          if (slot.kind === 'enemyPick')  setPick('enemy', slot.idx, top.championKey);
          if (slot.kind === 'myBan')      setBan('my',     slot.idx, top.championKey);
          if (slot.kind === 'enemyBan')   setBan('enemy',  slot.idx, top.championKey);
        }
      }
      setDetections(next);
    }, 2000);
    return () => clearInterval(id);
  }, [session, slots, setPick, setBan]);

  const start = useCallback(async () => {
    try {
      setError(null);
      const s = await startCapture();
      setSession(s);
    } catch (e) {
      setError((e as Error)?.message ?? '캡처 시작 실패');
    }
  }, []);

  const stop = useCallback(() => {
    session?.stop();
    setSession(null);
  }, [session]);

  // Calibration click handler — converts canvas click coords back to source
  // pixel coords and stores a rect centered on the click.
  const onPreviewClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!session) return;
    if (calibratingIdx >= SLOT_PLAN.length) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const plan = SLOT_PLAN[calibratingIdx];
    const newSlot: SlotRect = {
      kind: plan.kind, idx: plan.idx, label: plan.label,
      x: Math.max(0, Math.round(cx - SLOT_HALF_SIZE)),
      y: Math.max(0, Math.round(cy - SLOT_HALF_SIZE)),
      w: SLOT_HALF_SIZE * 2,
      h: SLOT_HALF_SIZE * 2,
    };
    const updated = [...slots, newSlot];
    setSlots(updated);
    setCalibratingIdx(calibratingIdx + 1);
    saveSlots(updated);
    void dpr;     // currently unused but retained for HiDPI tuning
  }, [session, slots, calibratingIdx]);

  const resetCalibration = useCallback(() => {
    setSlots([]);
    setCalibratingIdx(0);
    saveSlots([]);
    setDetections({});
  }, []);

  const isCalibrating = calibratingIdx < SLOT_PLAN.length;
  const currentPlan = isCalibrating ? SLOT_PLAN[calibratingIdx] : null;

  return (
    <div className="capture-panel">
      <div className="capture-panel-head">
        <h3 className="capture-panel-title">롤 화면 자동 감지 (실험)</h3>
        {!session ? (
          <button type="button" className="primary" onClick={start} disabled={hashStatus !== null && hashStatus.done < hashStatus.total}>
            캡처 시작
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            {!isCalibrating && (
              <button type="button" onClick={resetCalibration}>슬롯 재설정</button>
            )}
            <button type="button" onClick={stop}>중지</button>
          </div>
        )}
      </div>

      {hashStatus && hashStatus.done < hashStatus.total && (
        <div className="capture-progress">챔프 사진 준비 중... {hashStatus.done}/{hashStatus.total}</div>
      )}

      {error && <div className="capture-error">{error}</div>}

      {session && (
        <>
          {isCalibrating && (
            <div className="capture-instruction">
              <strong>{currentPlan?.label}</strong> 영역의 챔프 아이콘 중심을 미리보기에서 한 번 클릭하세요.
              ({calibratingIdx + 1} / {SLOT_PLAN.length})
            </div>
          )}
          {!isCalibrating && (
            <div className="capture-instruction text-tertiary">
              자동 감지 중 (2초마다). 슬롯 위치가 안 맞으면 "슬롯 재설정".
            </div>
          )}
          <canvas
            ref={previewRef}
            className="capture-preview"
            onClick={onPreviewClick}
            style={{ cursor: isCalibrating ? 'crosshair' : 'default' }}
          />

          {!isCalibrating && (
            <div className="capture-detections">
              {slots.map((s) => {
                const d = detections[slotKey(s)];
                return (
                  <div key={slotKey(s)} className="capture-detection-row">
                    <span className="capture-detection-label">{s.label}</span>
                    <span className="capture-detection-result">
                      {d ? `${d.championKey}  (d=${d.distance})` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function slotKey(s: SlotRect): string { return `${s.kind}-${s.idx}`; }

function loadSlots(): SlotRect[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SlotRect[];
  } catch { return []; }
}
function saveSlots(rows: SlotRect[]): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* ignore quota */ }
}
