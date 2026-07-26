import React, { useState, useEffect, useRef } from 'react';

// Pinky Avatar mode's prompt for kwaivgi/kling-avatar-v2. That model's prompt
// governs ACTION/emotion/camera (the uploaded image carries appearance), so
// this is a simplified delivery-oriented description, not the full look.
const PINKY_AVATAR_PROMPT = "A pink paper-slip cartoon news anchor delivering " +
  "the news straight to camera with confident, professional energy and subtle, " +
  "natural head movements.";

// Pinky Avatar: a fixed anchor image drives every character scene, plus an
// optional spoken outro. Images are user-supplied portraits (Avatar needs a
// face); the outro line has a sensible default.
const DEFAULT_OUTRO_TEXT = "Check out layoffhedge.com for more information.";

// Fixed default anchor/outro images for Pinky Avatar — permanent GitHub-hosted
// URLs (never presigned/expiring).
const DEFAULT_AVATAR_ANCHOR = "https://raw.githubusercontent.com/conceptcollisionapp/pinkys-assets/7b1c5c6f7661e1dd50a7629174c7b870566ca545/11771.jpg";
const DEFAULT_AVATAR_OUTRO = "https://raw.githubusercontent.com/conceptcollisionapp/pinkys-assets/7b1c5c6f7661e1dd50a7629174c7b870566ca545/12044.jpg";

// Old Pinky Newscaster defaults (the earlier S3 copies). If they're lingering
// in localStorage they silently override the new defaults, so treat them as
// stale and fall back to the new default.
const STALE_ANCHOR_URLS = [
  "https://grok-video-studio-uploads-2026.s3.us-east-2.amazonaws.com/uploads/upload_bcece39ab61e40d6bb6488659dabfe08.jpg",
  "https://grok-video-studio-uploads-2026.s3.us-east-2.amazonaws.com/uploads/upload_f22e4f880b5d434fb546e7d7dff561c9.jpg",
];
// Return the stored value unless it's empty or a stale old URL, in which case
// fall back to the given new default.
const resolveAvatarImg = (stored, def) => (!stored || STALE_ANCHOR_URLS.includes(stored)) ? def : stored;

const BLANK_SCENE = () => ({
  id: Date.now(), description: 'New scene', dialogue: '', isCharacterScene: true,
  start: 0, duration: 8, end: 8, image: null, imagePreview: null, imageUrl: ''
});

// Real xAI TTS speech tags (verified against xAI docs). Wrap tags surround the
// selected text; point tags insert at the cursor. (No <emphasis>/[sigh]/[breath]
// in xAI — emphasis is <loud>, sigh/breath map to [exhale]/[inhale].)
const SPEECH_TAGS = [
  { label: 'pause', title: '[pause]', text: '[pause]' },
  { label: 'long pause', title: '[long-pause]', text: '[long-pause]' },
  { label: 'slow', title: '<slow>…</slow>', open: '<slow>', close: '</slow>' },
  { label: 'fast', title: '<fast>…</fast>', open: '<fast>', close: '</fast>' },
  { label: 'emphasis', title: 'emphasis = <loud>…</loud>', open: '<loud>', close: '</loud>' },
  { label: 'soft', title: '<soft>…</soft>', open: '<soft>', close: '</soft>' },
  { label: 'whisper', title: '<whisper>…</whisper>', open: '<whisper>', close: '</whisper>' },
  { label: 'laugh', title: '[laugh]', text: '[laugh]' },
  { label: 'sigh', title: 'sigh = [exhale]', text: '[exhale]' },
  { label: 'breath', title: 'breath = [inhale]', text: '[inhale]' },
];

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === null ? true : saved === 'true';
  });

  // Modes: 'avatar' = Pinky Avatar (default), 'open' = Open Studio.
  // (The old 'pinky' Newscaster mode was removed; map any saved value to avatar.)
  const [mode, setMode] = useState(() => localStorage.getItem('studioMode') === 'open' ? 'open' : 'avatar');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [replicateApiKey, setReplicateApiKey] = useState(() => localStorage.getItem('replicateKey') || '');
  const backendUrl = 'https://grok-video-studio-production.up.railway.app';
  const [script, setScript] = useState(() => localStorage.getItem('script') || '');
  const [characterDescription, setCharacterDescription] = useState(() => localStorage.getItem('characterDescription') || '');
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('voiceId') || 'ara');
  const [avatarVoice, setAvatarVoice] = useState(() => localStorage.getItem('avatarVoice') || 'rex');
  const [resolution, setResolution] = useState(() => localStorage.getItem('resolution') || '720p');
  const [scenes, setScenes] = useState(() => JSON.parse(localStorage.getItem('scenes') || '[{"id":1,"description":"News Anchor","dialogue":"","isCharacterScene":true,"start":0,"duration":12,"end":12,"image":null,"imageUrl":""}]'));
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');
  const [dragIndex, setDragIndex] = useState(null);
  const [stageTimings, setStageTimings] = useState([]);
  const [totalSeconds, setTotalSeconds] = useState(null);
  const [videoHistory, setVideoHistory] = useState(() => JSON.parse(localStorage.getItem('videoHistory') || '[]'));
  const [showHistory, setShowHistory] = useState(false);
  const [playingUrl, setPlayingUrl] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const jobInputsRef = useRef(null);   // snapshot of the running job's inputs
  const dialogueRefs = useRef({});     // per-scene dialogue <textarea> nodes
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [imageWarning, setImageWarning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lipsyncModel, setLipsyncModel] = useState(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // Pinky Avatar's fixed anchor image + spoken outro (user-supplied portraits —
  // kling-avatar-v2 needs a face).
  const [avatarAnchorImage, setAvatarAnchorImage] = useState(() => resolveAvatarImg(localStorage.getItem('avatarAnchorImage'), DEFAULT_AVATAR_ANCHOR));
  const [anchorBusy, setAnchorBusy] = useState(false);
  const [outroEnabled, setOutroEnabled] = useState(() => (localStorage.getItem('outroEnabled') ?? 'true') === 'true');
  const [avatarOutroImage, setAvatarOutroImage] = useState(() => resolveAvatarImg(localStorage.getItem('avatarOutroImage'), DEFAULT_AVATAR_OUTRO));
  const [outroDialogue, setOutroDialogue] = useState(() => localStorage.getItem('outroDialogue') ?? DEFAULT_OUTRO_TEXT);
  const [outroBusy, setOutroBusy] = useState(false);
  const jobRef = useRef(null);

  const isAvatarMode = mode === 'avatar';
  const activeAnchor = avatarAnchorImage;
  const setActiveAnchor = setAvatarAnchorImage;
  const activeOutroImage = avatarOutroImage;
  const setActiveOutroImage = setAvatarOutroImage;
  // Voice is a picker in both modes (Avatar defaults to rex, not locked).
  const activeVoice = isAvatarMode ? avatarVoice : selectedVoice;
  const setActiveVoice = isAvatarMode ? setAvatarVoice : setSelectedVoice;

  // Real xAI TTS voice IDs (source: xAI TTS docs / GET /v1/tts/voices)
  const grokVoices = [
    { id: 'ara', name: 'Ara — warm & conversational' },
    { id: 'eve', name: 'Eve — energetic & upbeat (default)' },
    { id: 'leo', name: 'Leo — authoritative & strong' },
    { id: 'rex', name: 'Rex — clear & professional' },
    { id: 'sal', name: 'Sal — smooth & balanced' }
  ];

  const resolutions = ['480p', '720p', '1080p'];

  useEffect(() => {
    localStorage.setItem('studioMode', mode);
    localStorage.setItem('xaiKey', apiKey);
    localStorage.setItem('replicateKey', replicateApiKey);
    localStorage.setItem('darkMode', darkMode);
    localStorage.setItem('script', script);
    localStorage.setItem('characterDescription', characterDescription);
    localStorage.setItem('voiceId', selectedVoice);
    localStorage.setItem('avatarVoice', avatarVoice);
    localStorage.setItem('resolution', resolution);
    localStorage.setItem('scenes', JSON.stringify(scenes));
    localStorage.setItem('videoHistory', JSON.stringify(videoHistory));
    localStorage.setItem('avatarAnchorImage', avatarAnchorImage);
    localStorage.setItem('avatarOutroImage', avatarOutroImage);
    localStorage.setItem('outroDialogue', outroDialogue);
    localStorage.setItem('outroEnabled', outroEnabled);
  }, [mode, apiKey, replicateApiKey, darkMode, script, characterDescription, selectedVoice, avatarVoice, resolution, scenes, videoHistory, avatarAnchorImage, avatarOutroImage, outroDialogue, outroEnabled]);

  // One-time cleanup of keys from removed features (they stored blob: URLs,
  // which are invalid after a reload anyway).
  useEffect(() => {
    localStorage.removeItem('voicePreview');
    localStorage.removeItem('characterPreviews');
    // Orphaned Pinky Newscaster keys (mode removed) — drop them, and drop any
    // avatar anchor/outro still holding an old Newscaster default.
    localStorage.removeItem('anchorImage');
    localStorage.removeItem('outroImage');
    ['avatarAnchorImage', 'avatarOutroImage'].forEach(k => {
      if (STALE_ANCHOR_URLS.includes(localStorage.getItem(k))) localStorage.removeItem(k);
    });
  }, []);

  useEffect(() => {
    document.documentElement.style.backgroundColor = darkMode ? '#0f0f0f' : '#f8f9fa';
    document.documentElement.style.color = darkMode ? '#fff' : '#000';
  }, [darkMode]);

  // Which lip-sync model the backend is actually running (set by a Railway env
  // var). Surfaced in the UI so a test run can't silently hit the wrong model.
  const refreshLipsyncModel = async () => {
    try {
      const res = await fetch(`${backendUrl}/health`);
      const h = await res.json();
      setLipsyncModel(h.lipsync_model || 'unknown');
    } catch (e) {
      setLipsyncModel(null);
    }
  };
  useEffect(() => { refreshLipsyncModel(); }, []);

  // While a job is running the browser does the polling, so leaving/closing the
  // tab (or a mobile browser suspending it) can interrupt it and lose the
  // result. Warn on attempts to leave the page mid-generation.
  useEffect(() => {
    if (!generating) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [generating]);

  const toggleMode = () => setDarkMode(!darkMode);

  // Upload a project-level image (anchor/outro) to S3 and store the URL.
  const uploadProjectImage = async (file, setUrl, setBusy) => {
    if (!file) return;
    setBusy(true);
    try {
      setUrl(await uploadFile(file));
    } catch (e) {
      setStatus('Image upload failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Reset the current mode's builder inputs to a blank starting state. Does NOT
  // touch video History, API keys, resolution, or the selected mode.
  const clearAll = () => {
    setScenes([BLANK_SCENE()]);
    setScript('');
    setGeneratedVideoUrl('');
    setStageTimings([]);
    setTotalSeconds(null);
    if (mode === 'open') setCharacterDescription('');
    if (mode === 'avatar') {
      setAvatarAnchorImage(DEFAULT_AVATAR_ANCHOR);
      setAvatarOutroImage(DEFAULT_AVATAR_OUTRO);
      setOutroDialogue(DEFAULT_OUTRO_TEXT);
      setOutroEnabled(true);
    }
    setClearConfirmOpen(false);
    setStatus('Cleared.');
  };

  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${backendUrl}/upload`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      throw new Error(data.message || `Upload failed (${res.status})`);
    }
    return data.url;
  };

  const updateSceneImage = async (index, file) => {
    if (!file) return;
    const sceneId = scenes[index] && scenes[index].id;
    const preview = URL.createObjectURL(file);

    // Show the local blob preview instantly, mark the scene as uploading.
    setScenes(prev => prev.map(s =>
      s.id === sceneId ? { ...s, imagePreview: preview, uploading: true, uploadError: '' } : s
    ));

    try {
      // Store the REAL public URL (this is what gets sent to /generate).
      const publicUrl = await uploadFile(file);
      setScenes(prev => prev.map(s =>
        s.id === sceneId ? { ...s, image: publicUrl, uploading: false } : s
      ));
    } catch (e) {
      setScenes(prev => prev.map(s =>
        s.id === sceneId ? { ...s, uploading: false, uploadError: e.message } : s
      ));
      setStatus('Scene image upload failed: ' + e.message);
    }
  };

  // xAI clips are 1-15s; clamp here so the UI never shows a length the
  // backend would silently shorten. Empty/non-numeric falls back to 8;
  // real numbers clamp into range (so "0" becomes 1, not 8).
  const clampDuration = (d) => {
    const n = +d;
    if (d === '' || d === null || d === undefined || !Number.isFinite(n)) return 8;
    return Math.max(1, Math.min(15, n));
  };

  // Re-lay start/end sequentially from each scene's duration, in array order.
  const recomputeTiming = (list) => {
    let cursor = 0;
    return list.map(s => {
      const duration = clampDuration(s.duration);
      const start = cursor;
      const end = start + duration;
      cursor = end;
      return { ...s, start, end, duration };
    });
  };

  // Reorder scenes (drag-and-drop handle, or the ▲/▼ buttons for mobile),
  // then renumber the timeline so start/end run in the new order.
  const moveScene = (from, to) => {
    if (to < 0 || to >= scenes.length || from === to) return;
    const ns = [...scenes];
    const [item] = ns.splice(from, 1);
    ns.splice(to, 0, item);
    setScenes(recomputeTiming(ns));
  };

  const handleSceneDrop = (target) => {
    if (dragIndex === null) return;
    moveScene(dragIndex, target);
    setDragIndex(null);
  };

  // Delete a scene and re-lay the timeline so it stays contiguous.
  const deleteScene = (index) => {
    setScenes(prev => recomputeTiming(prev.filter((_, idx) => idx !== index)));
  };

  // Append a new scene; recomputeTiming sets its start/end after the last one.
  const addScene = () => {
    setScenes(prev => recomputeTiming([
      ...prev,
      { id: Date.now(), description: "New scene", dialogue: '', isCharacterScene: false,
        start: 0, duration: 8, end: 8, image: null, imagePreview: null, imageUrl: '' },
    ]));
  };

  // Remove just the image from a scene (keeps dialogue/timing).
  const clearSceneImage = (index) => {
    setScenes(prev => prev.map((s, idx) =>
      idx === index
        ? { ...s, image: null, imagePreview: null, uploadError: '', uploading: false }
        : s
    ));
  };

  // Insert an xAI speech tag into scene `index`'s dialogue. Wrap tags surround
  // the current selection (empty pair at cursor if nothing selected); point
  // tags insert at the cursor. Selection/cursor is restored after re-render.
  const applyTag = (index, tag) => {
    const el = dialogueRefs.current[index];
    if (!el) return;
    const start = el.selectionStart, end = el.selectionEnd;
    const val = el.value;
    let insert, caretStart, caretEnd;
    if (tag.open) {
      const sel = val.slice(start, end);
      insert = tag.open + sel + tag.close;
      caretStart = start + tag.open.length;
      caretEnd = caretStart + sel.length;
    } else {
      insert = tag.text;
      caretStart = caretEnd = start + insert.length;
    }
    const next = val.slice(0, start) + insert + val.slice(end);
    setScenes(prev => prev.map((s, i) => i === index ? { ...s, dialogue: next } : s));
    requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(caretStart, caretEnd); } catch (e) {} });
  };

  // Rough spoken-duration estimate from dialogue text (~150 wpm average
  // speech pace). Purely informational while writing — the real scene length
  // comes from the measured TTS audio at generation time.
  const estimateSpeechSeconds = (text) => {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
    return words === 0 ? 0 : Math.max(1, Math.round((words / 150) * 60));
  };

  const fmtElapsed = (sec) => {
    if (sec == null) return '';
    const s = Math.round(sec);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  // Poll a job's status until it's done/error. Guarded by jobRef so a newer
  // job supersedes an older poll loop instead of both writing status.
  const pollStatus = async (jobId) => {
    if (jobRef.current !== jobId) return;
    try {
      const res = await fetch(`${backendUrl}/status/${jobId}`);
      const s = await res.json();
      if (jobRef.current !== jobId) return;   // superseded while fetching
      const t = fmtElapsed(s.elapsed_seconds);
      if (s.status === 'done') {
        setGeneratedVideoUrl(s.video_url);
        setStageTimings(s.stage_timings || []);
        setTotalSeconds(s.elapsed_seconds);
        // Record in local history (this browser only). Capped so localStorage
        // can't grow unbounded.
        setVideoHistory(prev => [{
          id: `${Date.now()}-${jobId}`,
          status: 'done',
          url: s.video_url,
          date: Date.now(),
          mode: (jobInputsRef.current && jobInputsRef.current.modeLabel) || (mode === 'avatar' ? 'Pinky Avatar' : 'Open Studio')
        }, ...prev].slice(0, 50));
        setGenerating(false);
        setStatus(`✅ Video ready! (${t})`);
      } else if (s.status === 'error') {
        setGenerating(false);
        // Record the failure so the user can retry from the History tab.
        setVideoHistory(prev => [{
          id: `${Date.now()}-${jobId}`,
          status: 'failed',
          job_id: jobId,
          date: Date.now(),
          mode: (jobInputsRef.current && jobInputsRef.current.modeLabel) || (mode === 'avatar' ? 'Pinky Avatar' : 'Open Studio'),
          failedStage: s.failed_stage || s.stage || 'Unknown',
          error: s.message || 'Generation failed',
          config: jobInputsRef.current   // enables full-regen fallback
        }, ...prev].slice(0, 50));
        setStatus('⚠️ ' + (s.message || 'Generation failed') + (t ? ` (after ${t})` : ''));
      } else if (s.status === 'stopped') {
        setGenerating(false);
        setStatus('⏹ ' + (s.message || 'Stopped') + (t ? ` (${t})` : ''));
      } else {
        setStatus(`⏳ ${s.stage || 'Processing…'}${t ? ` — ${t}` : ''}`);
        setTimeout(() => pollStatus(jobId), 4000);
      }
    } catch (e) {
      if (jobRef.current !== jobId) return;
      setStatus('⏳ Checking status… (retrying)');
      setTimeout(() => pollStatus(jobId), 5000);
    }
  };

  // Flag images that are low-resolution (short side < 512px) or an unusual
  // aspect ratio, for the pre-generate warning. Reading dimensions via
  // Image() works cross-origin (no canvas involved); unloadable images are
  // skipped rather than false-flagged.
  const anyRiskyImages = async (urls) => {
    const flags = await Promise.all(urls.map(u => new Promise(resolve => {
      const img = new Image();
      let settled = false;
      const done = (flag) => { if (!settled) { settled = true; resolve(flag); } };
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        const ratio = w / h;
        done(Math.min(w, h) < 512 || ratio > 2.4 || ratio < 1 / 2.4);
      };
      img.onerror = () => done(false);
      setTimeout(() => done(false), 5000);
      img.src = u;
    })));
    return flags.some(Boolean);
  };

  // Validate everything, then open the confirmation dialog. Shared by BOTH
  // modes (Open Studio and Pinky Avatar) — the actual request only fires
  // from the dialog's "Yes, Generate".
  const requestGenerate = async () => {
    if (!apiKey) {
      setStatus("Please enter your xAI API Key");
      return;
    }
    const isLocked = mode === 'avatar';
    const isPublicUrl = (u) => !!u && !u.startsWith('blob:');

    // Character scenes (incl. a spoken outro) need a Replicate key.
    const hasCharacterScene = scenes.some(s => s.isCharacterScene) || (isLocked && outroEnabled);
    if (hasCharacterScene && !replicateApiKey) {
      setStatus("Replicate API key required for character scenes.");
      return;
    }

    // Never submit while an upload is in flight or with a blob: URL — xAI can
    // only fetch the real public URLs returned by /upload.
    if (scenes.some(s => s.uploading) || anchorBusy || outroBusy) {
      setStatus('Please wait — an image is still uploading.');
      return;
    }
    if (isLocked) {
      // Pinky modes: character scenes use the Anchor Image; b-roll uses its own.
      if (scenes.some(s => s.isCharacterScene) && !isPublicUrl(activeAnchor)) {
        setStatus(isAvatarMode
          ? 'Upload a front-facing Pinky portrait as the Anchor Image — Avatar needs a face.'
          : 'Add an Anchor Image — it drives every character scene in this mode.');
        return;
      }
      if (outroEnabled && !isPublicUrl(activeOutroImage)) {
        setStatus(isAvatarMode
          ? 'The outro needs a Pinky portrait image (Avatar needs a face), or turn the outro off.'
          : 'The outro needs an image, or turn the outro off.');
        return;
      }
      const badB = scenes.findIndex(s => !s.isCharacterScene && !isPublicUrl(s.imageUrl || s.image));
      if (badB !== -1) {
        setStatus(`Scene ${badB + 1} (still image) needs an uploaded image or a public image URL.`);
        return;
      }
    } else {
      const badIdx = scenes.findIndex(s => !isPublicUrl(s.imageUrl || s.image));
      if (badIdx !== -1) {
        setStatus(`Scene ${badIdx + 1} needs an uploaded image or a public image URL.`);
        return;
      }
    }

    // Narration is scene dialogue only — no fallback to Notes or canned text.
    // The outro line counts too in Pinky modes.
    const fullScript = [
      ...scenes.map(s => (s.dialogue || '').trim()),
      (isLocked && outroEnabled) ? (outroDialogue || '').trim() : '',
    ].filter(Boolean).join(' ');
    if (!fullScript) {
      setStatus('Add dialogue to at least one scene — narration is generated from scene dialogue.');
      return;
    }
    // TTS runs per scene now, so the limit applies per scene's dialogue.
    const longIdx = scenes.findIndex(s => (s.dialogue || '').length > 15000);
    if (longIdx !== -1) {
      setStatus(`Scene ${longIdx + 1} dialogue too long (max 15,000 chars per scene).`);
      return;
    }

    // Images that will actually be used, for the low-res/aspect warning.
    const usedImages = isLocked
      ? [
          ...(scenes.some(s => s.isCharacterScene) ? [activeAnchor] : []),
          ...scenes.filter(s => !s.isCharacterScene).map(s => s.imageUrl || s.image),
          ...(outroEnabled ? [activeOutroImage] : []),
        ].filter(Boolean)
      : scenes.map(s => s.imageUrl || s.image).filter(Boolean);

    setStatus('');
    await refreshLipsyncModel();   // reflect the current Railway setting, not a stale mount value
    setImageWarning(await anyRiskyImages(usedImages));
    setConfirmOpen(true);
  };

  // The confirmed submission — only ever called from the dialog.
  const generateVideo = async () => {
    setStatus('Starting…');
    setGeneratedVideoUrl('');
    setStageTimings([]);
    setTotalSeconds(null);

    const isAvatar = mode === 'avatar';
    const isLocked = isAvatar;

    // Per-scene payload. In Pinky modes, character scenes use the fixed Anchor
    // Image; b-roll keeps its own; a spoken outro is appended if enabled.
    const scenePayload = scenes.map(s => ({
      image_url: (isLocked && s.isCharacterScene) ? activeAnchor : (s.imageUrl || s.image || ''),
      dialogue: s.dialogue || '',
      // clamp here too — a mid-edit raw value may not have blurred yet
      duration: clampDuration(s.duration),
      isCharacterScene: !!s.isCharacterScene,
      // b-roll motion (ignored for character scenes); default subtle pan/zoom
      motion: s.motion || 'panzoom'
    }));
    if (isLocked && outroEnabled && activeOutroImage) {
      scenePayload.push({
        image_url: activeOutroImage,
        dialogue: outroDialogue || '',
        duration: clampDuration(8),
        isCharacterScene: true
      });
    }

    const fullScript = scenePayload.map(s => (s.dialogue || '').trim()).filter(Boolean).join(' ');

    // Snapshot inputs so a failed job's history entry can rebuild the studio
    // for a from-scratch fallback (blob previews stripped — they don't survive).
    jobInputsRef.current = {
      scenes: scenes.map(({ imagePreview, ...s }) => s),
      modeId: mode,
      modeLabel: isAvatar ? 'Pinky Avatar' : 'Open Studio',
      characterDescription,
      voiceId: activeVoice,
      resolution,
      anchorImage: activeAnchor, outroImage: activeOutroImage, outroDialogue, outroEnabled
    };

    const formData = new FormData();
    formData.append('script', fullScript);
    formData.append('api_key', apiKey);
    formData.append('replicate_api_key', replicateApiKey);
    formData.append('scenes', JSON.stringify(scenePayload));
    // Pinky Avatar locks the voice + character and uses the avatar pipeline;
    // Open Studio uses the user's config and the lip-sync pipeline.
    formData.append('voice_id', activeVoice);
    formData.append('resolution', resolution);
    formData.append('character_description', isAvatar ? PINKY_AVATAR_PROMPT : characterDescription.trim());
    formData.append('character_pipeline', isAvatar ? 'avatar' : 'lipsync');

    try {
      // Kicks off the pipeline and returns a job_id immediately (the work runs
      // for minutes in the background — too long for one synchronous request).
      const res = await fetch(`${backendUrl}/generate`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      console.log('Generate response:', data);

      if (!res.ok || !data.job_id) {
        setStatus('⚠️ Could not start: ' + (data.message || `HTTP ${res.status}`));
        return;
      }
      jobRef.current = data.job_id;
      setGenerating(true);
      setStatus('⏳ Queued…');
      pollStatus(data.job_id);
    } catch (e) {
      setGenerating(false);
      setStatus('Connection error: ' + e.message);
      console.error(e);
    }
  };

  // Ask the backend to stop the running job. Polling keeps going until the
  // backend confirms 'stopped' (in-flight API calls have to drain first).
  const stopGeneration = async () => {
    const jid = jobRef.current;
    if (!jid) return;
    try {
      await fetch(`${backendUrl}/cancel/${jid}`, { method: 'POST' });
      setStatus('⏹ Stopping — finishing in-flight work…');
    } catch (e) {
      setStatus('Could not reach server to stop: ' + e.message);
    }
  };

  const exportVideo = () => {
    if (generatedVideoUrl) {
      const a = document.createElement('a');
      a.href = generatedVideoUrl;
      a.download = 'grok-news-video.mp4';
      a.click();
    }
  };

  // Download an S3 video. Cross-origin `download` attributes are ignored, so
  // fetch to a blob first; if S3 CORS blocks the fetch, fall back to opening
  // the video in a new tab (user can save from there).
  const downloadVideo = async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      a.download = 'grok-video.mp4';
      a.click();
      setTimeout(() => URL.revokeObjectURL(obj), 10000);
    } catch (e) {
      window.open(url, '_blank', 'noopener');
    }
  };

  // Restore a failed job's setup into the studio for a from-scratch regen
  // (used when the backend can't resume). User then clicks Generate.
  const restoreConfig = (cfg) => {
    if (!cfg) return;
    if (cfg.scenes) setScenes(cfg.scenes);
    if (cfg.modeId) setMode(cfg.modeId);
    if (cfg.characterDescription != null) setCharacterDescription(cfg.characterDescription);
    if (cfg.voiceId) { if (cfg.modeId === 'avatar') setAvatarVoice(cfg.voiceId); else setSelectedVoice(cfg.voiceId); }
    if (cfg.resolution) setResolution(cfg.resolution);
    // Anchor/outro only apply to Avatar mode.
    if (cfg.modeId === 'avatar') {
      if (cfg.anchorImage != null) setAvatarAnchorImage(cfg.anchorImage);
      if (cfg.outroImage != null) setAvatarOutroImage(cfg.outroImage);
      if (cfg.outroDialogue != null) setOutroDialogue(cfg.outroDialogue);
      if (cfg.outroEnabled != null) setOutroEnabled(cfg.outroEnabled);
    }
  };

  // Retry a failed job: ask the backend to resume from where it died (reusing
  // already-paid work). If it can't (24h window passed / server restarted),
  // fall back to restoring the setup for a full from-scratch regeneration.
  const retryJob = async (entry) => {
    if (!apiKey) { setStatus('Enter your xAI API Key before retrying.'); return; }
    setStatus('↻ Checking what can be resumed…');
    try {
      const fd = new FormData();
      fd.append('api_key', apiKey);
      fd.append('replicate_api_key', replicateApiKey);
      const res = await fetch(`${backendUrl}/generate/${entry.job_id}/retry`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.job_id) {
        // Resuming — remove the failed entry; a re-fail will record a fresh one.
        setVideoHistory(prev => prev.filter(h => h.id !== entry.id));
        jobInputsRef.current = entry.config || jobInputsRef.current;
        jobRef.current = data.job_id;
        setShowHistory(false);
        setGenerating(true);
        setStatus('↻ Retrying — reusing completed work…');
        pollStatus(data.job_id);
        return;
      }
      // 410 recoverable:false (or any non-resume response) → full regen path.
      restoreConfig(entry.config);
      setShowHistory(false);
      setStatus((data && data.message) ||
        "Previous work couldn't be recovered — this will regenerate everything from scratch and use new credits.");
    } catch (e) {
      restoreConfig(entry.config);
      setShowHistory(false);
      setStatus("Couldn't reach the server to resume — click Generate to regenerate from scratch (uses new credits).");
    }
  };

  const toggleSelected = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Only ever removes what the user explicitly checked — no delete-all.
  const deleteSelected = () => {
    setVideoHistory(prev => prev.filter(h => !selectedIds.includes(h.id)));
    setSelectedIds([]);
  };

  return (
    <div style={{ padding: '15px', maxWidth: '100%', margin: 'auto', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <h1 style={{ margin: 0 }}>📰 Grok Video Studio</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => setClearConfirmOpen(true)} title="Reset this mode's inputs (keeps History)" style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #ff6b6b', color: '#ff6b6b', background: 'transparent' }}>
            🧹 Clear All
          </button>
          <button onClick={toggleMode} style={{ padding: '8px 16px', borderRadius: '8px' }}>
            {darkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { id: 'avatar', label: '🎭 Pinky Avatar' },
          { id: 'open', label: '🎬 Open Studio (experimental)', experimental: true },
        ].map(t => {
          const active = mode === t.id && !showHistory;
          return (
            <button
              key={t.id}
              onClick={() => { setMode(t.id); setShowHistory(false); }}
              style={{
                padding: '10px 24px', borderRadius: '8px', cursor: 'pointer',
                border: active ? '2px solid #00ff9f' : (t.experimental ? '1px dashed #c77dff' : '1px solid #666'),
                background: active ? '#00ff9f' : 'transparent',
                color: active ? '#000' : (t.experimental ? '#c77dff' : 'inherit'),
                fontWeight: active ? 'bold' : 'normal',
              }}
            >
              {t.label}
            </button>
          );
        })}
        <button
          onClick={() => setShowHistory(v => !v)}
          style={{
            padding: '10px 24px', borderRadius: '8px', cursor: 'pointer',
            border: showHistory ? '2px solid #00ff9f' : '1px solid #666',
            background: showHistory ? '#00ff9f' : 'transparent',
            color: showHistory ? '#000' : 'inherit',
            fontWeight: showHistory ? 'bold' : 'normal',
          }}
        >
          🕘 History{videoHistory.length ? ` (${videoHistory.length})` : ''}
        </button>
      </div>

      <div style={{ fontSize: '0.85em', opacity: 0.75, marginBottom: '15px' }}>
        {mode === 'avatar' ? (
          <>🎭 Avatar model: <strong>kwaivgi/kling-avatar-v2</strong> <span style={{ opacity: 0.7 }}>(single call — no separate lip-sync)</span></>
        ) : (
          <>
            🎙 Lip-sync model: <strong>{lipsyncModel || '…'}</strong>
            <button onClick={refreshLipsyncModel} title="Re-check the active model" style={{ marginLeft: '8px', padding: '1px 8px', borderRadius: '6px', cursor: 'pointer' }}>↻</button>
          </>
        )}
      </div>

      {showHistory ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ margin: 0 }}>Generated Videos</h3>
            {selectedIds.length > 0 && (
              <button onClick={deleteSelected} style={{ padding: '8px 16px', borderRadius: '8px', color: '#ff6b6b' }}>
                🗑 Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>
          <p style={{ fontSize: '0.8em', opacity: 0.7, margin: '6px 0 12px' }}>
            This is a trial site. Not responsible for API credits used via your keys.
          </p>
          {videoHistory.length === 0 && (
            <p style={{ opacity: 0.7 }}>Nothing yet — completed and failed generations will appear here. (History is saved in this browser only.)</p>
          )}
          {videoHistory.map(h => {
            const failed = h.status === 'failed';
            return (
            <div key={h.id} style={{ border: selectedIds.includes(h.id) ? '2px solid #00ff9f' : (failed ? '1px solid #7a3b3b' : '1px solid #444'), padding: '12px', margin: '10px 0', borderRadius: '8px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(h.id)}
                  onChange={() => toggleSelected(h.id)}
                  title="Select for deletion"
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                {failed ? (
                  <>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div>{new Date(h.date).toLocaleString()} · {h.mode}</div>
                      <div style={{ color: '#ff6b6b', fontSize: '0.85em', marginTop: '2px' }}>
                        ⚠️ Failed at: {h.failedStage}
                      </div>
                      <div style={{ opacity: 0.8, fontSize: '0.85em' }}>{h.error}</div>
                    </div>
                    <button onClick={() => retryJob(h)}>↻ Retry</button>
                  </>
                ) : (
                  <>
                    {/* preload="metadata" renders the first frame as a free thumbnail */}
                    <video src={h.url} preload="metadata" muted style={{ width: '120px', borderRadius: '6px', background: '#222' }} />
                    <div style={{ flex: 1, minWidth: '140px' }}>
                      <div>{new Date(h.date).toLocaleString()}</div>
                      <div style={{ opacity: 0.7, fontSize: '0.85em' }}>{h.mode}</div>
                    </div>
                    <button onClick={() => setPlayingUrl(playingUrl === h.id ? null : h.id)}>
                      {playingUrl === h.id ? 'Hide' : '▶ Watch'}
                    </button>
                    <button onClick={() => downloadVideo(h.url)}>⬇ Download</button>
                  </>
                )}
              </div>
              {!failed && playingUrl === h.id && (
                <video controls autoPlay src={h.url} style={{ width: '100%', marginTop: '10px' }} />
              )}
            </div>
            );
          })}
        </div>
      ) : (
        <>
      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px', boxSizing:'border-box'}} />
      <input type="password" placeholder="Replicate API Key (saved)" value={replicateApiKey} onChange={e => setReplicateApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px', boxSizing:'border-box'}} />

      {mode === 'open' && (
        <p style={{ color: '#c77dff', fontSize: '0.9em', margin: '0 0 15px', padding: '8px 12px', border: '1px dashed #c77dff', borderRadius: '8px' }}>
          ⚠️ Experimental mode — the flexible any-character / any-image pipeline.
          Less tested than the Pinky modes; results can vary.
        </p>
      )}

      {/* Voice picker — shown in both modes (Avatar defaults to Rex, changeable). */}
      <h3>Voice (TTS narration)</h3>
      <select value={activeVoice} onChange={e => setActiveVoice(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}}>
        {grokVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>

      {mode === 'open' ? (
        <>
          <h3>Character Description</h3>
          <textarea
            value={characterDescription}
            onChange={e => setCharacterDescription(e.target.value)}
            rows="3"
            style={{ width: '100%', padding: '12px', marginBottom: '15px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }}
            placeholder="Describe your on-camera character's appearance & personality (used in every character scene to keep them consistent), e.g. 'Pinky, a cheerful pink puppet news anchor with big eyes, sitting at a news desk.'"
          />
        </>
      ) : (
        <div style={{ margin: '10px 0 15px' }}>
          <p style={{ opacity: 0.8, margin: 0 }}>
            🔒 Character: Pinky (locked)
          </p>
          {mode === 'avatar' && (
            <p style={{ opacity: 0.75, fontSize: '0.9em', margin: '6px 0 0' }}>
              Character scenes are generated in one step by Kling Avatar (image +
              audio → talking video). Still-image scenes are unchanged.
            </p>
          )}

          {/* Fixed anchor image (every character scene) + spoken outro. */}
          <h3 style={{ marginBottom: '4px' }}>Anchor Image{isAvatarMode ? ' (Pinky portrait)' : ''}</h3>
          <p style={{ opacity: 0.7, fontSize: '0.85em', margin: '0 0 8px' }}>
            Used automatically for every character/talking scene in this mode.
            {isAvatarMode && <span style={{ color: '#ffb347' }}> Avatar needs a clear, front-facing face — upload a close Pinky portrait, not a wide scene.</span>}
          </p>
          {activeAnchor && <img src={activeAnchor} alt="anchor" style={{ maxWidth: '150px', display: 'block', borderRadius: '6px', marginBottom: '6px' }} />}
          <input value={activeAnchor} onChange={e => setActiveAnchor(e.target.value)} placeholder={isAvatarMode ? 'Front-facing Pinky portrait URL' : 'Public image URL'} style={{ width: '100%', padding: '8px', margin: '0 0 6px', boxSizing: 'border-box' }} />
          <input type="file" accept="image/*" onChange={e => uploadProjectImage(e.target.files[0], setActiveAnchor, setAnchorBusy)} />
          {anchorBusy && <span style={{ marginLeft: '10px' }}>⏳ Uploading…</span>}

          <h3 style={{ marginBottom: '4px', marginTop: '18px' }}>Outro Scene</h3>
          <label style={{ display: 'block', marginBottom: '8px' }}>
            <input type="checkbox" checked={outroEnabled} onChange={e => setOutroEnabled(e.target.checked)} />{' '}
            Include a spoken outro at the end (Pinky says the line below)
          </label>
          {outroEnabled && (
            <>
              {isAvatarMode && <p style={{ color: '#ffb347', fontSize: '0.85em', margin: '0 0 6px' }}>Avatar speaks the outro, so this image also needs a Pinky face (not the text card).</p>}
              {activeOutroImage && <img src={activeOutroImage} alt="outro" style={{ maxWidth: '150px', display: 'block', borderRadius: '6px', marginBottom: '6px' }} />}
              <input value={activeOutroImage} onChange={e => setActiveOutroImage(e.target.value)} placeholder={isAvatarMode ? 'Pinky portrait for the outro' : 'Outro image URL'} style={{ width: '100%', padding: '8px', margin: '0 0 6px', boxSizing: 'border-box' }} />
              <input type="file" accept="image/*" onChange={e => uploadProjectImage(e.target.files[0], setActiveOutroImage, setOutroBusy)} />
              {outroBusy && <span style={{ marginLeft: '10px' }}>⏳ Uploading…</span>}
              <textarea value={outroDialogue} onChange={e => setOutroDialogue(e.target.value)} rows="2" placeholder="Outro spoken line" style={{ width: '100%', padding: '10px', margin: '8px 0 0', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }} />
            </>
          )}
        </div>
      )}

      <h3>Resolution</h3>
      <select value={resolution} onChange={e => setResolution(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}}>
        {resolutions.map(r => <option key={r} value={r}>{r}</option>)}
      </select>

      <h3>Full Script / Notes</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="14" style={{width:'100%', padding:'12px', marginBottom:'15px', minHeight:'260px', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit', lineHeight:'1.5'}} placeholder="Paste your full script here, then break it into each scene's dialogue below. (Narration is generated from the per-scene dialogue.)" />

      <h3>Timeline — Scenes (drag ⠿ to reorder)</h3>
      {scenes.map((s, i) => {
        // In Pinky modes, character scenes use the fixed Anchor Image, so their
        // per-scene image upload is hidden. B-roll keeps its own image.
        const hideImg = mode === 'avatar' && s.isCharacterScene;
        return (
        <div
          key={s.id}
          onDragOver={e => e.preventDefault()}
          onDrop={() => handleSceneDrop(i)}
          style={{
            border: dragIndex === i ? '2px dashed #00ff9f' : '1px solid #444',
            padding: '12px', margin: '10px 0', borderRadius: '8px',
            opacity: dragIndex === i ? 0.6 : 1
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => setDragIndex(null)}
              title="Drag to reorder scene"
              style={{ cursor: 'grab', fontSize: '1.4em', userSelect: 'none' }}
            >⠿</span>
            <strong>Scene {i + 1}</strong>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => moveScene(i, i - 1)} disabled={i === 0} title="Move up">▲</button>
            <button type="button" onClick={() => moveScene(i, i + 1)} disabled={i === scenes.length - 1} title="Move down">▼</button>
          </div>
          <input value={s.description} onChange={e => { const ns = [...scenes]; ns[i].description = e.target.value; setScenes(ns); }} placeholder="Description" style={{width:'70%'}} />

          <label style={{ display: 'block', margin: '8px 0' }}>
            <input
              type="checkbox"
              checked={!!s.isCharacterScene}
              onChange={e => { const ns = [...scenes]; ns[i].isCharacterScene = e.target.checked; setScenes(ns); }}
            />{' '}
            {s.isCharacterScene ? 'Animate image (character speaking)' : 'Still image'}
          </label>

          {!s.isCharacterScene && (
            <label style={{ display: 'block', margin: '0 0 8px', fontSize: '0.9em' }}>
              Motion:{' '}
              <select value={s.motion || 'panzoom'} onChange={e => { const ns = [...scenes]; ns[i].motion = e.target.value; setScenes(ns); }}>
                <option value="panzoom">Pan / Zoom (subtle)</option>
                <option value="static">Static (no motion)</option>
              </select>
            </label>
          )}

          {/* Expressive delivery toolbar — inserts real xAI TTS speech tags. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
            {SPEECH_TAGS.map(tag => (
              <button
                key={tag.label}
                type="button"
                title={`Insert ${tag.title}`}
                onMouseDown={e => e.preventDefault()}   /* keep textarea selection */
                onClick={() => applyTag(i, tag)}
                style={{ fontSize: '0.75em', padding: '2px 7px', borderRadius: '6px', cursor: 'pointer' }}
              >
                {tag.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '0.75em', opacity: 0.6, margin: '3px 0 0' }}>
            Wrap selected text or insert tags to control pacing &amp; emotion — real xAI TTS controls that shape how the narration sounds.
          </div>

          <textarea
            ref={el => { if (el) dialogueRefs.current[i] = el; }}
            value={s.dialogue || ''}
            onChange={e => { const ns = [...scenes]; ns[i].dialogue = e.target.value; setScenes(ns); }}
            rows="5"
            style={{ width: '100%', padding: '10px', margin: '6px 0', minHeight: '110px', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }}
            placeholder="Spoken line for this scene (part of the continuous narration)"
          />
          {(s.dialogue || '').trim() && (() => {
            const est = estimateSpeechSeconds(s.dialogue);
            const over = s.isCharacterScene && est > 15;
            return (
              <div style={{ fontSize: '0.85em', opacity: over ? 1 : 0.7, color: over ? '#ff6b6b' : 'inherit', marginBottom: '4px' }}>
                ≈ {est}s spoken{over ? ' — over the 15s character-scene limit, consider splitting' : ''}
              </div>
            );
          })()}

          {hideImg ? (
            <p style={{ opacity: 0.7, fontSize: '0.85em', margin: '6px 0' }}>🔒 Uses the Anchor Image (set once above).</p>
          ) : (
            <>
              <input
                value={s.imageUrl || ''}
                onChange={e => { const ns = [...scenes]; ns[i].imageUrl = e.target.value; setScenes(ns); }}
                placeholder="Or paste a public image URL (overrides upload)"
                style={{ width: '100%', padding: '8px', margin: '6px 0' }}
              />
              <input type="file" accept="image/*" onChange={e => updateSceneImage(i, e.target.files[0])} />
              {s.uploading && <span style={{ marginLeft: '10px' }}>⏳ Uploading…</span>}
              {!s.uploading && s.image && !s.uploadError && <span style={{ marginLeft: '10px' }}>✅ Uploaded</span>}
              {s.uploadError && <span style={{ marginLeft: '10px', color: '#ff6b6b' }}>⚠️ {s.uploadError}</span>}
              {(s.imagePreview || s.image) && (
                <div style={{ margin: '5px 0' }}>
                  <img src={s.imagePreview || s.image} alt="still" style={{ maxWidth: '150px', display: 'block' }} />
                  <button type="button" onClick={() => clearSceneImage(i)} style={{ marginTop: '5px' }}>🗑 Remove image</button>
                </div>
              )}
            </>
          )}

          {/* Start/End are derived from scene order + durations (recomputeTiming);
              only Duration is a real input — it's all the backend uses. */}
          <span style={{ opacity: 0.75 }}>Start {s.start}s → End {s.end || (s.start + s.duration)}s</span>
          {'  '}Duration <input type="number" min="1" max="15" value={s.duration} onChange={e => {
            // Store the raw value while typing — clearing or intermediate values
            // like "2" (heading for "12") must not snap to 8/15 mid-edit.
            const ns = [...scenes];
            ns[i].duration = e.target.value;
            setScenes(ns);
          }} onBlur={() => {
            // Clamp + re-lay all starts/ends only once editing is finished.
            setScenes(prev => recomputeTiming(prev));
          }} style={{width:'60px'}} />s <small>(used only when the scene has no dialogue — spoken scenes auto-size to their narration)</small>

          <button onClick={() => deleteScene(i)} style={{marginTop: '8px'}}>Delete Scene</button>
        </div>
        );
      })}
      <button onClick={addScene}>+ Add Scene</button>

      <br /><br />
      <button onClick={requestGenerate} disabled={generating} style={{ padding: '18px 50px', fontSize: '1.3em', background: '#00ff9f', border: 'none', borderRadius: '12px', opacity: generating ? 0.5 : 1 }}>Generate Video</button>
      {generating && (
        <button onClick={stopGeneration} style={{ marginLeft: '15px', padding: '18px 30px', fontSize: '1.1em', borderRadius: '12px', border: '1px solid #ff6b6b', color: '#ff6b6b', background: 'transparent' }}>
          ⏹ Stop
        </button>
      )}
      {generating && (
        <p style={{ color: '#ffb347', marginTop: '12px', fontWeight: 'bold' }}>
          ⚠️ Keep this screen on and stay in the app until it finishes. On mobile, leaving or locking the screen can interrupt generation and lose the result.
        </p>
      )}

      {generatedVideoUrl && (
        <div style={{ marginTop: '30px' }}>
          <video controls src={generatedVideoUrl} style={{ width: '100%' }} />
          <button onClick={exportVideo} style={{ marginTop: '10px', padding: '12px 30px' }}>Export MP4</button>
          <p style={{ fontSize: '0.8em', opacity: 0.7, margin: '6px 0 0' }}>
            This is a trial site. Not responsible for API credits used via your keys.
          </p>

          {stageTimings.length > 0 && (
            <details style={{ marginTop: '15px' }}>
              <summary style={{ cursor: 'pointer' }}>
                ⏱ Timing breakdown{totalSeconds != null ? ` — total ${fmtElapsed(totalSeconds)}` : ''}
              </summary>
              <table style={{ marginTop: '10px', borderCollapse: 'collapse', width: '100%', maxWidth: '480px' }}>
                <tbody>
                  {(() => {
                    const slowest = Math.max(...stageTimings.map(x => x.seconds || 0));
                    return stageTimings.map((x, idx) => {
                      const isSlowest = (x.seconds || 0) === slowest;
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #333' }}>
                          <td style={{ padding: '6px 10px' }}>{x.stage}</td>
                          <td style={{
                            padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap',
                            fontWeight: isSlowest ? 'bold' : 'normal',
                            color: isSlowest ? '#00ff9f' : 'inherit'
                          }}>
                            {fmtElapsed(x.seconds)}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

        </>
      )}

      {clearConfirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: darkMode ? '#1c1c1c' : '#fff', border: '1px solid #555', borderRadius: '12px', padding: '24px', maxWidth: '420px', width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Clear all inputs?</h3>
            <p>This resets this mode's scenes and inputs to a blank starting state. Unsaved work is discarded. Your video History is not affected.</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button onClick={() => setClearConfirmOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>Cancel</button>
              <button onClick={clearAll} style={{ padding: '10px 20px', borderRadius: '8px', background: '#ff6b6b', border: 'none', color: '#fff', fontWeight: 'bold' }}>Yes, Clear All</button>
            </div>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: darkMode ? '#1c1c1c' : '#fff', border: '1px solid #555', borderRadius: '12px', padding: '24px', maxWidth: '480px', width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Before you generate</h3>
            <p>
              ⚠️ This will use <strong>your own xAI and Replicate API credits</strong>.
              There are <strong>no refunds</strong> for credits spent on a generation,
              regardless of output quality.
            </p>
            <p style={{ opacity: 0.85 }}>
              This is a trial/beta site and is not responsible for API credits used.
            </p>
            {imageWarning && (
              <p style={{ color: '#ffb347' }}>
                ⚠️ One or more images may be low resolution or an unusual format — results may not come out correctly.
              </p>
            )}
            <p style={{ color: '#ffb347' }}>
              ⏳ This runs for several minutes. <strong>Keep this tab open and your screen awake</strong> until it finishes — on mobile especially, leaving the app or locking the screen can interrupt it and you may lose the result.
            </p>
            <p style={{ background: darkMode ? '#111' : '#eee', borderRadius: '8px', padding: '8px 12px' }}>
              {mode === 'avatar'
                ? <>🎭 Avatar model: <strong>kwaivgi/kling-avatar-v2</strong></>
                : <>🎙 Active lip-sync model: <strong>{lipsyncModel || 'unavailable'}</strong></>}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button onClick={() => setConfirmOpen(false)} style={{ padding: '10px 20px', borderRadius: '8px' }}>Cancel</button>
              <button onClick={() => { setConfirmOpen(false); generateVideo(); }} style={{ padding: '10px 20px', borderRadius: '8px', background: '#00ff9f', border: 'none', fontWeight: 'bold' }}>Yes, Generate</button>
            </div>
          </div>
        </div>
      )}

      <p>{status}</p>
    </div>
  );
}

export default App;
