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
import { ensureOcrLoaded, ocrLane } from '@/lib/screen-capture/lane-ocr';
import { autoCalibrate, type AutoCalProgress } from '@/lib/screen-capture/auto-calibrate';
import type { SlotState } from '@/lib/pick-types';

// v4: removed manual click-to-calibrate; auto-calibrate is the only path
// now. Old v2/v3 stored slots have incompatible kinds/sizes, so the key
// bump forces a fresh detection.
const STORAGE_KEY = 'tlol_capture_slots_v4';
// Hamming distance threshold below which a per-tick match counts. Bans
// look noisier (X overlay / darker tint) so they get a looser threshold.
const CONFIDENCE_DISTANCE = 14;
const BAN_CONFIDENCE_DISTANCE = 22;

type SlotKind = 'myPick' | 'enemyPick' | 'myBan' | 'enemyBan' | 'myLane';
interface SlotRect {
  kind: SlotKind;
  idx: number;
  x: number; y: number; w: number; h: number;
  label: string;
}

// Canonical display order for the detections panel + label lookups when
// merging the auto-cal result into our SlotRect shape.
const SLOT_PLAN: Array<{ kind: SlotKind; idx: number; label: string }> = [
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'myPick' as const,    idx: i, label: `우리 픽 ${i + 1}` })),
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'myLane' as const,    idx: i, label: `우리 ${i + 1}번 라인` })),
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'enemyPick' as const, idx: i, label: `적 픽 ${i + 1}` })),
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'myBan' as const,     idx: i, label: `우리 밴 ${i + 1}` })),
  ...Array.from({ length: 5 }, (_, i) => ({ kind: 'enemyBan' as const,  idx: i, label: `적 밴 ${i + 1}` })),
];

interface Props {
  championKeys: string[];
  ddragonVersion: string;
  setPick: (side: 'my' | 'enemy', idx: number, champion: string | undefined) => void;
  setBan:  (side: 'my' | 'enemy', idx: number, champion: string | undefined) => void;
  setTeamSlot: (side: 'my' | 'enemy', idx: number, patch: Partial<SlotState>) => void;
}

export function CapturePanel({ championKeys, ddragonVersion, setPick, setBan, setTeamSlot }: Props) {
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [slots, setSlots] = useState<SlotRect[]>(() => loadSlots());
  const [hashStatus, setHashStatus] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<Record<string, MatchResult | null>>({});
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Champion icon pHashes are preloaded on mount (one-time IndexedDB cost).
  // Lane icons are deferred to `start()` because Community Dragon doesn't
  // serve them with CORS headers — fetching them on every page mount
  // produces noisy console errors even when the user never opens capture.
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

  // Tracks lane OCR jobs in flight per slot so the 2s tick doesn't pile
  // up tesseract calls on slots whose previous OCR hasn't returned yet.
  const ocrInFlight = useRef<Set<string>>(new Set());
  // Best distance seen so far per slot — prevents a transient bad match
  // (e.g., during a champion-swap animation) from clobbering a correct
  // earlier detection. A new match must be strictly better (or close to
  // the prior best) to overwrite.
  const slotBest = useRef<Map<string, number>>(new Map());

  // Detection loop — runs as soon as any slots exist (auto-cal may yield
  // a partial layout if some regions had no champ candidates yet).
  useEffect(() => {
    if (!session || slots.length === 0) return;
    const id = setInterval(() => {
      const next: Record<string, MatchResult | null> = {};
      // Pass 1: pHash every non-lane slot, collect candidates.
      const candidates: Array<{ slot: SlotRect; match: MatchResult }> = [];
      for (const slot of slots) {
        const cropped = session.cropFrame({ x: slot.x, y: slot.y, w: slot.w, h: slot.h });
        if (!cropped) { next[slotKey(slot)] = null; continue; }
        if (slot.kind === 'myLane') {
          // OCR async — fire-and-forget. Skip if previous OCR for this slot
          // is still running so we don't pile up tesseract calls.
          const key = slotKey(slot);
          if (!ocrInFlight.current.has(key)) {
            ocrInFlight.current.add(key);
            ocrLane(cropped).then((res) => {
              ocrInFlight.current.delete(key);
              if (res.lane) setTeamSlot('my', slot.idx, { lane: res.lane });
              setDetections((prev) => ({
                ...prev,
                [key]: { championKey: res.lane ?? (res.rawText || '—'), distance: res.lane ? 0 : -1 },
              }));
            });
          }
          continue;
        }
        const matches = matchChampion(cropped, 1);
        const top = matches[0];
        next[slotKey(slot)] = top ?? null;
        const isBan = slot.kind === 'myBan' || slot.kind === 'enemyBan';
        const threshold = isBan ? BAN_CONFIDENCE_DISTANCE : CONFIDENCE_DISTANCE;
        if (top && top.distance <= threshold) candidates.push({ slot, match: top });
      }

      // Pass 2: dedupe — LoL forbids the same champion appearing in two
      // slots across the whole game (10 picks + 10 bans). If pHash matched
      // the same champ to multiple slots, keep only the one with the lowest
      // distance; others are rejected (likely a transient or wrong match).
      const bestByChamp = new Map<string, typeof candidates[number]>();
      for (const c of candidates) {
        const prev = bestByChamp.get(c.match.championKey);
        if (!prev || c.match.distance < prev.match.distance) {
          bestByChamp.set(c.match.championKey, c);
        }
      }
      const accepted = new Set(bestByChamp.values());

      // Pass 3: apply, with "don't downgrade" guard. A slot that already
      // recorded a better distance keeps its previous champion — protects
      // against animation-frame mid-transition crops.
      for (const c of candidates) {
        if (!accepted.has(c)) continue;
        const key = slotKey(c.slot);
        const priorBest = slotBest.current.get(key);
        // Tolerance: allow re-detection within +2 distance of prior best
        // so small noise doesn't latch a slot permanently.
        if (priorBest !== undefined && c.match.distance > priorBest + 2) continue;
        slotBest.current.set(key, Math.min(priorBest ?? Infinity, c.match.distance));
        if (c.slot.kind === 'myPick')     setPick('my',    c.slot.idx, c.match.championKey);
        if (c.slot.kind === 'enemyPick')  setPick('enemy', c.slot.idx, c.match.championKey);
        if (c.slot.kind === 'myBan')      setBan('my',     c.slot.idx, c.match.championKey);
        if (c.slot.kind === 'enemyBan')   setBan('enemy',  c.slot.idx, c.match.championKey);
      }

      // Lane entries are merged in via the async OCR callback above — only
      // overwrite non-lane slots here so we don't clobber in-flight OCR state.
      setDetections((prev) => {
        const merged = { ...prev };
        for (const [k, v] of Object.entries(next)) merged[k] = v;
        return merged;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [session, slots, setPick, setBan, setTeamSlot]);

  const start = useCallback(async () => {
    try {
      setError(null);
      // Warm up Tesseract (downloads kor.traineddata on first run, ~10MB)
      // in the background. Lane OCR will queue until ready; pHash detection
      // for picks/bans starts immediately regardless.
      void ensureOcrLoaded();
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

  const [autoCalState, setAutoCalState] = useState<{ running: boolean; progress: AutoCalProgress | null; error: string | null }>(
    { running: false, progress: null, error: null }
  );

  const runAutoCalibrate = useCallback(async () => {
    if (!session) return;
    setAutoCalState({ running: true, progress: null, error: null });
    try {
      const result = await autoCalibrate(session, (p) => setAutoCalState((s) => ({ ...s, progress: p })));
      if (result.slots.length === 0) {
        setAutoCalState({ running: false, progress: null, error: '챔프가 감지되지 않았습니다. 픽/벤이 진행된 뒤에 다시 시도하세요.' });
        return;
      }
      // Sort to match SLOT_PLAN order so detection-effect slot iteration
      // stays aligned with the previous (manual) calibration flow.
      const ordered: SlotRect[] = [];
      for (const plan of SLOT_PLAN) {
        const match = result.slots.find((s) => s.kind === plan.kind && s.idx === plan.idx);
        if (match) ordered.push({ ...match, label: plan.label });
      }
      setSlots(ordered);
      saveSlots(ordered);
      slotBest.current.clear();      // re-detection wipes the don't-downgrade memory
      setAutoCalState({ running: false, progress: null, error: null });
    } catch (e) {
      setAutoCalState({ running: false, progress: null, error: (e as Error)?.message ?? '자동 위치 찾기 실패' });
    }
  }, [session]);

  const clearCalibration = useCallback(() => {
    setSlots([]);
    saveSlots([]);
    setDetections({});
    slotBest.current.clear();
  }, []);

  // Auto-trigger calibration shortly after capture starts so the user
  // doesn't have to click anything when slots are empty. If it fails
  // (no champ visible yet), the error banner shows the retry button.
  const autoCalAttempted = useRef(false);
  useEffect(() => {
    if (!session) { autoCalAttempted.current = false; return; }
    if (slots.length > 0) return;
    if (autoCalAttempted.current) return;
    autoCalAttempted.current = true;
    // Small delay so the first video frame is definitely available.
    const t = setTimeout(() => { void runAutoCalibrate(); }, 1500);
    return () => clearTimeout(t);
  }, [session, slots.length, runAutoCalibrate]);

  const hasSlots = slots.length > 0;

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
            <button type="button" onClick={runAutoCalibrate} disabled={autoCalState.running}>
              {autoCalState.running
                ? '검출 중...'
                : hasSlots ? '위치 재검출' : '위치 검출'}
            </button>
            {hasSlots && <button type="button" onClick={clearCalibration}>초기화</button>}
            <button type="button" onClick={stop}>중지</button>
          </div>
        )}
      </div>

      {hashStatus && hashStatus.done < hashStatus.total && (
        <div className="capture-progress">챔프 사진 준비 중... {hashStatus.done}/{hashStatus.total}</div>
      )}

      {autoCalState.running && autoCalState.progress && (
        <div className="capture-progress">
          자동 위치 검색 — {autoCalState.progress.phase === 'scan'
            ? `${autoCalState.progress.region} 영역 ${autoCalState.progress.done}/${autoCalState.progress.total}`
            : autoCalState.progress.phase}
        </div>
      )}
      {autoCalState.error && <div className="capture-error">{autoCalState.error}</div>}

      {error && <div className="capture-error">{error}</div>}

      {session && (
        <>
          {!hasSlots && !autoCalState.running && (
            <div className="capture-instruction">
              위치 검출 대기 중. 픽 또는 벤이 하나라도 진행된 뒤 <strong>위치 검출</strong>이 자동 실행됩니다.
              <div className="text-tertiary" style={{ marginTop: 6, fontSize: 11 }}>
                감지가 안 되면 위 버튼으로 수동 재시도하세요.
              </div>
            </div>
          )}
          {hasSlots && (
            <div className="capture-instruction text-tertiary">
              자동 감지 중 (2초마다). 슬롯 위치가 안 맞으면 <strong>위치 재검출</strong>.
            </div>
          )}
          <canvas
            ref={previewRef}
            className="capture-preview"
          />

          {hasSlots && (
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
