import React, { useState, useEffect } from 'react';

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === null ? true : saved === 'true';
  });

  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [replicateApiKey, setReplicateApiKey] = useState(() => localStorage.getItem('replicateKey') || '');
  const [backendUrl] = useState('https://grok-video-studio-production.up.railway.app');
  const [script, setScript] = useState(() => localStorage.getItem('script') || '');
  const [voicePreview, setVoicePreview] = useState(() => localStorage.getItem('voicePreview') || null);
  const [characterPreviews, setCharacterPreviews] = useState(() => JSON.parse(localStorage.getItem('characterPreviews') || '[]'));
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('voiceId') || 'ara');
  const [resolution, setResolution] = useState(() => localStorage.getItem('resolution') || '720p');
  const [scenes, setScenes] = useState(() => JSON.parse(localStorage.getItem('scenes') || '[{"id":1,"description":"News Anchor","dialogue":"","isCharacterScene":true,"start":0,"duration":12,"end":12,"image":null,"imageUrl":""}]'));
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');

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
    localStorage.setItem('xaiKey', apiKey);
    localStorage.setItem('replicateKey', replicateApiKey);
    localStorage.setItem('darkMode', darkMode);
    localStorage.setItem('characterPreviews', JSON.stringify(characterPreviews));
    localStorage.setItem('script', script);
    localStorage.setItem('voiceId', selectedVoice);
    localStorage.setItem('resolution', resolution);
    localStorage.setItem('scenes', JSON.stringify(scenes));
  }, [apiKey, replicateApiKey, darkMode, characterPreviews, script, selectedVoice, resolution, scenes]);

  useEffect(() => {
    document.documentElement.style.backgroundColor = darkMode ? '#0f0f0f' : '#f8f9fa';
    document.documentElement.style.color = darkMode ? '#fff' : '#000';
  }, [darkMode]);

  const toggleMode = () => setDarkMode(!darkMode);

  const handleVoice = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVoicePreview(url);
      localStorage.setItem('voicePreview', url);
    }
  };

  const handleCharacter = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCharacterPreviews([...characterPreviews, url]);
    }
  };

  const clearVoice = () => {
    setVoicePreview(null);
    localStorage.removeItem('voicePreview');
  };

  const removeCharacter = (index) => {
    const newPreviews = characterPreviews.filter((_, i) => i !== index);
    setCharacterPreviews(newPreviews);
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

    setStatus('Sending to backend...');

    // One continuous narration track = every scene's dialogue joined in order.
    const fullScript = scenes
      .map(s => (s.dialogue || '').trim())
      .filter(Boolean)
      .join(' ');

    // Per-scene payload the backend needs for the pipeline.
    const scenePayload = scenes.map(s => ({
      image_url: s.imageUrl || s.image || '',
      dialogue: s.dialogue || '',
      duration: s.duration || 8,
      isCharacterScene: !!s.isCharacterScene
    }));

    const formData = new FormData();
    formData.append('script', fullScript || script || 'A news anchor delivering a report with graphs');
    formData.append('api_key', apiKey);
    formData.append('replicate_api_key', replicateApiKey);
    formData.append('scenes', JSON.stringify(scenePayload));
    formData.append('voice_id', selectedVoice);
    formData.append('resolution', resolution);
    formData.append('character_reference_urls', JSON.stringify(characterPreviews));

    try {
      const res = await fetch(`${backendUrl}/generate`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      console.log('Backend response:', data);

      if (data.video_url) {
        setGeneratedVideoUrl(data.video_url);
        setStatus('Video ready!');
      } else {
        setStatus('No video URL: ' + (data.message || 'Check xAI credits'));
      }
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

      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px', boxSizing:'border-box'}} />
      <input type="password" placeholder="Replicate API Key (saved)" value={replicateApiKey} onChange={e => setReplicateApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px', boxSizing:'border-box'}} />

      <h3>Grok Voices (TTS narration)</h3>
      <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}}>
        {grokVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>

      <h3>Custom Voice Sample</h3>
      <input type="file" accept="audio/*" onChange={handleVoice} />
      {voicePreview && <p>Voice saved <button onClick={clearVoice}>Clear</button></p>}

      <h3>Character References (Multiple)</h3>
      <input type="file" accept="image/*" onChange={handleCharacter} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '10px 0' }}>
        {characterPreviews.map((p, i) => (
          <div key={i}>
            <img src={p} alt="char" style={{ maxWidth: '120px', borderRadius: '8px' }} />
            <button onClick={() => removeCharacter(i)}>Remove</button>
          </div>
        ))}
      </div>

      <h3>Resolution</h3>
      <select value={resolution} onChange={e => setResolution(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}}>
        {resolutions.map(r => <option key={r} value={r}>{r}</option>)}
      </select>

      <h3>Full Script / Notes</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="14" style={{width:'100%', padding:'12px', marginBottom:'15px', minHeight:'260px', boxSizing:'border-box', resize:'vertical', fontFamily:'inherit', lineHeight:'1.5'}} placeholder="Paste your full script here, then break it into each scene's dialogue below. (Narration is generated from the per-scene dialogue.)" />

      <h3>Timeline — Scenes (dialogue, image & timing)</h3>
      {scenes.map((s, i) => (
        <div key={s.id} style={{ border: '1px solid #444', padding: '12px', margin: '10px 0', borderRadius: '8px' }}>
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
          {(s.imagePreview || s.image) && <img src={s.imagePreview || s.image} alt="still" style={{ maxWidth: '150px', margin: '5px 0', display: 'block' }} />}

          Start <input type="number" value={s.start} onChange={e => {
            const ns = [...scenes];
            ns[i].start = +e.target.value;
            ns[i].end = ns[i].start + (ns[i].duration || 8);
            setScenes(ns);
          }} style={{width:'60px'}} />s

          End <input type="number" value={s.end || (s.start + s.duration)} onChange={e => {
            const ns = [...scenes];
            ns[i].end = +e.target.value;
            ns[i].duration = ns[i].end - ns[i].start;
            setScenes(ns);
          }} style={{width:'60px'}} />s

          Duration <input type="number" value={s.duration} onChange={e => {
            const ns = [...scenes];
            ns[i].duration = +e.target.value;
            ns[i].end = ns[i].start + ns[i].duration;
            setScenes(ns);
          }} style={{width:'60px'}} />s

          <button onClick={() => setScenes(scenes.filter((_, idx) => idx !== i))} style={{marginTop: '8px'}}>Delete Scene</button>
        </div>
      ))}
      <button onClick={() => {
        const lastEnd = scenes.length > 0 ? scenes[scenes.length - 1].end || (scenes[scenes.length - 1].start + scenes[scenes.length - 1].duration) : 0;
        setScenes([...scenes, { id: Date.now(), description: "New scene", dialogue: '', isCharacterScene: false, start: lastEnd, duration: 8, end: lastEnd + 8, image: null, imageUrl: '' }]);
      }}>+ Add Scene</button>

      <br /><br />
      <button onClick={generateVideo} style={{ padding: '18px 50px', fontSize: '1.3em', background: '#00ff9f', border: 'none', borderRadius: '12px' }}>Generate Video</button>

      {generatedVideoUrl && (
        <div style={{ marginTop: '30px' }}>
          <video controls src={generatedVideoUrl} style={{ width: '100%' }} />
          <button onClick={exportVideo} style={{ marginTop: '10px', padding: '12px 30px' }}>Export MP4</button>
        </div>
      )}

      <p>{status}</p>
    </div>
  );
}

export default App;
