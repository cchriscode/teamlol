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
import { ensureNameOcrLoaded, ocrName, nameMatches } from '@/lib/screen-capture/name-ocr';
import { detectSlots, type DetectProgress } from '@/lib/screen-capture/slot-detect';
import { warmupOpenCv } from '@/lib/screen-capture/shape-detect';
import type { SlotState } from '@/lib/pick-types';

// v5: position detection switched from sliding pHash to OpenCV shape
// detection (HoughCircles + contour). Slot rect sizes are now derived
// from detected portrait radius, not constants — old v4 rects had a
// different shape so we invalidate them.
const STORAGE_KEY = 'tlol_capture_slots_v5';
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
  /** Lookup function for Korean champion name — used to verify pHash
   *  matches against the OCR'd portrait label. */
  getNameKr: (key: string) => string;
  setPick: (side: 'my' | 'enemy', idx: number, champion: string | undefined) => void;
  setBan:  (side: 'my' | 'enemy', idx: number, champion: string | undefined) => void;
  setTeamSlot: (side: 'my' | 'enemy', idx: number, patch: Partial<SlotState>) => void;
}

export function CapturePanel({ championKeys, ddragonVersion, getNameKr, setPick, setBan, setTeamSlot }: Props) {
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
  // Same for name OCR (cross-validation).
  const nameOcrInFlight = useRef<Set<string>>(new Set());
  // Verified (slot → champion) pairs that passed name OCR cross-check.
  // Avoids re-OCR'ing the same slot when the champion is stable.
  const verifiedByChamp = useRef<Map<string, string>>(new Map());
  // Mismatches per slot for the detection panel ⚠ indicator.
  const [nameMismatch, setNameMismatch] = useState<Record<string, string>>({});
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

        // Cross-validate via name OCR (picks only — bans don't render a
        // name label). Only re-OCR when (slot, champ) changes — verified
        // pairs are cached. Mismatches surface as ⚠ in the panel but
        // don't auto-revert (OCR can fail on stylized fonts).
        const isPick = c.slot.kind === 'myPick' || c.slot.kind === 'enemyPick';
        if (isPick && !nameOcrInFlight.current.has(key) && verifiedByChamp.current.get(key) !== c.match.championKey) {
          // Crop the name strip: right of the portrait, upper third (the
          // name line sits above the lane line in the LoL UI).
          const nameRect = {
            x: c.slot.x + c.slot.w + 4,
            y: c.slot.y + Math.round(c.slot.h * 0.10),
            w: Math.max(80, c.slot.w * 3),
            h: Math.max(20, Math.round(c.slot.h * 0.45)),
          };
          const nameCrop = session.cropFrame(nameRect);
          if (nameCrop) {
            nameOcrInFlight.current.add(key);
            const expectedKey = c.match.championKey;
            ocrName(nameCrop).then((text) => {
              nameOcrInFlight.current.delete(key);
              const expected = getNameKr(expectedKey);
              if (!text) return;                      // OCR uncertain — leave alone
              if (nameMatches(text, expected)) {
                verifiedByChamp.current.set(key, expectedKey);
                setNameMismatch((prev) => {
                  if (!prev[key]) return prev;
                  const { [key]: _, ...rest } = prev;
                  return rest;
                });
              } else {
                setNameMismatch((prev) => ({ ...prev, [key]: `phash=${expected} / ocr=${text}` }));
              }
            });
          }
        }
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
  }, [session, slots, setPick, setBan, setTeamSlot, getNameKr]);

  const start = useCallback(async () => {
    try {
      setError(null);
      // Warm up Tesseract (~10MB kor.traineddata; lane + name workers
      // share the model file via browser cache) and OpenCV (~7MB wasm)
      // in parallel with the capture-permission dialog so they're ready
      // by the time the user grants access.
      void ensureOcrLoaded();
      void ensureNameOcrLoaded();
      void warmupOpenCv();
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

  const [autoCalState, setAutoCalState] = useState<{ running: boolean; progress: DetectProgress | null; error: string | null }>(
    { running: false, progress: null, error: null }
  );

  const runAutoCalibrate = useCallback(async () => {
    if (!session) return;
    setAutoCalState({ running: true, progress: null, error: null });
    try {
      // Render the current video frame to a working canvas — shape
      // detection needs a still HTMLCanvasElement (cv.imread), not the
      // live video stream.
      const work = document.createElement('canvas');
      if (!session.drawFrame(work)) {
        setAutoCalState({ running: false, progress: null, error: '캡처 프레임 준비 실패' });
        return;
      }
      const result = await detectSlots(work, (p) => setAutoCalState((s) => ({ ...s, progress: p })));
      if (result.slots.length === 0) {
        setAutoCalState({ running: false, progress: null, error: '슬롯이 감지되지 않았습니다. 챔프 셀렉 화면을 캡처했는지 확인하세요.' });
        return;
      }
      // Sort to canonical display order for the detection panel.
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

      {autoCalState.running && (
        <div className="capture-progress">
          {autoCalState.progress
            ? `자동 위치 검색 — ${autoCalState.progress.phase}${autoCalState.progress.region ? ` (${autoCalState.progress.region})` : ''}`
            : 'OpenCV 로딩 중 (첫 사용 시 7MB 다운로드)...'}
        </div>
      )}
      {autoCalState.error && <div className="capture-error">{autoCalState.error}</div>}

      {error && <div className="capture-error">{error}</div>}

      {session && (
        <>
          {!hasSlots && !autoCalState.running && (
            <div className="capture-instruction">
              위치 검출 대기 중. 챔프 셀렉 화면이 보이면 자동 실행됩니다 (OpenCV 도형 검출).
              <div className="text-tertiary" style={{ marginTop: 6, fontSize: 11 }}>
                빈 픽 슬롯도 원형 UI로 감지하므로 픽이 없어도 검출 가능합니다.
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
                const key = slotKey(s);
                const d = detections[key];
                const mm = nameMismatch[key];
                const verified = verifiedByChamp.current.get(key);
                const isPickSlot = s.kind === 'myPick' || s.kind === 'enemyPick';
                return (
                  <div key={key} className="capture-detection-row">
                    <span className="capture-detection-label">{s.label}</span>
                    <span className="capture-detection-result">
                      {d ? `${d.championKey}  (d=${d.distance})` : '—'}
                      {isPickSlot && d && verified === d.championKey && <span title="이름 OCR 일치"> ✓</span>}
                      {isPickSlot && mm && <span title={mm} style={{ color: 'var(--color-warning)' }}> ⚠</span>}
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
