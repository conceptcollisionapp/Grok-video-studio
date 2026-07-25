import React, { useState, useEffect, useRef } from 'react';

// Fixed character used by the "Pinky Newscaster" mode (voice + description
// locked); "Open Studio" mode leaves both fully user-configurable.
const PINKY_CHARACTER_DESCRIPTION = "Flat 2D cartoon anthropomorphic pink " +
  "termination-slip character: torn ragged top edge, perforation holes, " +
  "dog-eared corner, red 'TERMINATED' stamp across lower half. Simple " +
  "black dot eyes, thick angled black eyebrows, small flat mouth, rosy " +
  "cheeks. Navy suit jacket, white collared shirt, red necktie, small " +
  "black cartoon hands. Seated at a glossy blue-and-glass news desk in a " +
  "photorealistic modern TV newsroom with floor-to-ceiling city-view " +
  "windows and studio lighting. Flat 2D character against a " +
  "photorealistic backdrop.";

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === null ? true : saved === 'true';
  });

  // 'pinky' = Pinky Newscaster (locked voice/character), 'open' = Open Studio.
  const [mode, setMode] = useState(() => localStorage.getItem('studioMode') || 'pinky');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [replicateApiKey, setReplicateApiKey] = useState(() => localStorage.getItem('replicateKey') || '');
  const backendUrl = 'https://grok-video-studio-production.up.railway.app';
  const [script, setScript] = useState(() => localStorage.getItem('script') || '');
  const [characterDescription, setCharacterDescription] = useState(() => localStorage.getItem('characterDescription') || '');
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('voiceId') || 'ara');
  const [resolution, setResolution] = useState(() => localStorage.getItem('resolution') || '720p');
  const [scenes, setScenes] = useState(() => JSON.parse(localStorage.getItem('scenes') || '[{"id":1,"description":"News Anchor","dialogue":"","isCharacterScene":true,"start":0,"duration":12,"end":12,"image":null,"imageUrl":""}]'));
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');
  const [dragIndex, setDragIndex] = useState(null);
  const [stageTimings, setStageTimings] = useState([]);
  const [totalSeconds, setTotalSeconds] = useState(null);
  const jobRef = useRef(null);

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
    localStorage.setItem('resolution', resolution);
    localStorage.setItem('scenes', JSON.stringify(scenes));
  }, [mode, apiKey, replicateApiKey, darkMode, script, characterDescription, selectedVoice, resolution, scenes]);

  // One-time cleanup of keys from removed features (they stored blob: URLs,
  // which are invalid after a reload anyway).
  useEffect(() => {
    localStorage.removeItem('voicePreview');
    localStorage.removeItem('characterPreviews');
  }, []);

  useEffect(() => {
    document.documentElement.style.backgroundColor = darkMode ? '#0f0f0f' : '#f8f9fa';
    document.documentElement.style.color = darkMode ? '#fff' : '#000';
  }, [darkMode]);

  const toggleMode = () => setDarkMode(!darkMode);

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
        setStatus(`✅ Video ready! (${t})`);
      } else if (s.status === 'error') {
        setStatus('⚠️ ' + (s.message || 'Generation failed') + (t ? ` (after ${t})` : ''));
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

  const generateVideo = async () => {
    if (!apiKey) {
      setStatus("Please enter your xAI API Key");
      return;
    }

    // Lip-sync scenes require a Replicate key — block before submitting.
    const hasCharacterScene = scenes.some(s => s.isCharacterScene);
    if (hasCharacterScene && !replicateApiKey) {
      setStatus("Replicate API key required for character lip-sync scenes.");
      return;
    }

    // Never submit while an upload is in flight or with a blob: URL — xAI can
    // only fetch the real public URLs returned by /upload.
    if (scenes.some(s => s.uploading)) {
      setStatus('Please wait — a scene image is still uploading.');
      return;
    }
    const badIdx = scenes.findIndex(s => {
      const url = s.imageUrl || s.image || '';
      return !url || url.startsWith('blob:');
    });
    if (badIdx !== -1) {
      setStatus(`Scene ${badIdx + 1} needs an uploaded image or a public image URL.`);
      return;
    }

    // One continuous narration track = every scene's dialogue joined in order.
    // No fallback to Notes or a canned string — narration is scene dialogue only.
    const fullScript = scenes
      .map(s => (s.dialogue || '').trim())
      .filter(Boolean)
      .join(' ');
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

    setStatus('Starting…');
    setGeneratedVideoUrl('');
    setStageTimings([]);
    setTotalSeconds(null);

    // Per-scene payload the backend needs for the pipeline.
    const scenePayload = scenes.map(s => ({
      image_url: s.imageUrl || s.image || '',
      dialogue: s.dialogue || '',
      // clamp here too — a mid-edit raw value may not have blurred yet
      duration: clampDuration(s.duration),
      isCharacterScene: !!s.isCharacterScene
    }));

    const formData = new FormData();
    formData.append('script', fullScript);
    formData.append('api_key', apiKey);
    formData.append('replicate_api_key', replicateApiKey);
    formData.append('scenes', JSON.stringify(scenePayload));
    // Pinky Newscaster mode locks the voice + character; Open Studio uses
    // whatever the user configured.
    const isPinky = mode === 'pinky';
    formData.append('voice_id', isPinky ? 'rex' : selectedVoice);
    formData.append('resolution', resolution);
    formData.append('character_description', isPinky ? PINKY_CHARACTER_DESCRIPTION : characterDescription.trim());

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
      setStatus('⏳ Queued…');
      pollStatus(data.job_id);
    } catch (e) {
      setStatus('Connection error: ' + e.message);
      console.error(e);
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

  return (
    <div style={{ padding: '15px', maxWidth: '100%', margin: 'auto', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>📰 Grok Video Studio</h1>
        <button onClick={toggleMode} style={{ padding: '8px 16px', borderRadius: '8px' }}>
          {darkMode ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        {[
          { id: 'open', label: '🎬 Open Studio' },
          { id: 'pinky', label: '📌 Pinky Newscaster' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setMode(t.id)}
            style={{
              padding: '10px 24px', borderRadius: '8px', cursor: 'pointer',
              border: mode === t.id ? '2px solid #00ff9f' : '1px solid #666',
              background: mode === t.id ? '#00ff9f' : 'transparent',
              color: mode === t.id ? '#000' : 'inherit',
              fontWeight: mode === t.id ? 'bold' : 'normal',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px', boxSizing:'border-box'}} />
      <input type="password" placeholder="Replicate API Key (saved)" value={replicateApiKey} onChange={e => setReplicateApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px', boxSizing:'border-box'}} />

      {mode === 'open' ? (
        <>
          <h3>Grok Voices (TTS narration)</h3>
          <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}}>
            {grokVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

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
        <p style={{ opacity: 0.8, margin: '10px 0 15px' }}>
          🔒 Voice: Rex (locked) · Character: Pinky (locked)
        </p>
      )}

      <h3>Resolution</h3>
      <select value={resolution} onChange={e => setResolution(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}}>
        {resolutions.map(r => <option key={r} value={r}>{r}</option>)}
      </select>

      <h3>Full Script / Notes</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="14" style={{width:'100%', padding:'12px', marginBottom:'15px', minHeight:'260px', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit', lineHeight:'1.5'}} placeholder="Paste your full script here, then break it into each scene's dialogue below. (Narration is generated from the per-scene dialogue.)" />

      <h3>Timeline — Scenes (drag ⠿ to reorder)</h3>
      {scenes.map((s, i) => (
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
            {s.isCharacterScene ? 'Character speaking (lip-sync)' : 'B-roll / graphic (pan & zoom only)'}
          </label>

          <textarea
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
      ))}
      <button onClick={addScene}>+ Add Scene</button>

      <br /><br />
      <button onClick={generateVideo} style={{ padding: '18px 50px', fontSize: '1.3em', background: '#00ff9f', border: 'none', borderRadius: '12px' }}>Generate Video</button>

      {generatedVideoUrl && (
        <div style={{ marginTop: '30px' }}>
          <video controls src={generatedVideoUrl} style={{ width: '100%' }} />
          <button onClick={exportVideo} style={{ marginTop: '10px', padding: '12px 30px' }}>Export MP4</button>

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

      <p>{status}</p>
    </div>
  );
}

export default App;
