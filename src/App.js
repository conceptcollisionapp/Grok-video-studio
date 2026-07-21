import React, { useState, useEffect } from 'react';

function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [backendUrl] = useState('https://your-railway-app.up.railway.app');
  const [script, setScript] = useState('');
  const [voiceFile, setVoiceFile] = useState(null);
  const [voicePreview, setVoicePreview] = useState(() => localStorage.getItem('voicePreview') || null);
  const [characterPreview, setCharacterPreview] = useState(() => localStorage.getItem('characterPreview') || null);
  const [selectedVoice, setSelectedVoice] = useState('default');
  const [resolution, setResolution] = useState('720p');
  const [scenes, setScenes] = useState([{ id: 1, description: "News Anchor", start: 0, duration: 12 }]);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');

  const grokVoices = [
    { id: 'default', name: 'Default Grok' },
    { id: 'male-news', name: 'Professional Male' },
    { id: 'female-clear', name: 'Clear Female' },
    { id: 'energetic', name: 'Energetic Anchor' }
  ];

  const resolutions = ['480p', '720p', '1080p'];

  useEffect(() => {
    localStorage.setItem('xaiKey', apiKey);
  }, [apiKey]);

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
      setCharacterPreview(url);
      localStorage.setItem('characterPreview', url);
    }
  };

  const clearVoice = () => { setVoicePreview(null); localStorage.removeItem('voicePreview'); };
  const clearCharacter = () => { setCharacterPreview(null); localStorage.removeItem('characterPreview'); };

  const generateVideo = async () => {
    setStatus('Generating with Grok Imagine 1.5...');
    // FormData with all params including resolution
    setTimeout(() => { // Demo
      setGeneratedVideoUrl('https://example-video.mp4');
      setStatus('Video ready!');
    }, 2000);
  };

  const exportVideo = () => {
    if (generatedVideoUrl) {
      const a = document.createElement('a');
      a.href = generatedVideoUrl;
      a.download = 'grok-news-video.mp4';
      a.click();
      setStatus('Export started!');
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: 'auto' }}>
      <h1>📰 Grok Video Studio</h1>

      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px'}} />

      <h3>Grok Voices</h3>
      <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} style={{width:'100%', padding:'12px'}}>
        {grokVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>

      <h3>Custom Voice</h3>
      <input type="file" accept="audio/*" onChange={handleVoice} />
      {voicePreview && <p>Voice saved <button onClick={clearVoice}>Clear</button></p>}

      <h3>Character Reference</h3>
      <input type="file" accept="image/*" onChange={handleCharacter} />
      {characterPreview && <div><img src={characterPreview} alt="char" style={{maxWidth:'200px'}} /> <button onClick={clearCharacter}>Clear</button></div>}

      <h3>Resolution</h3>
      <select value={resolution} onChange={e => setResolution(e.target.value)} style={{width:'100%', padding:'12px'}}>
        {resolutions.map(r => <option key={r} value={r}>{r}</option>)}
      </select>

      <h3>Script</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="8" style={{width:'100%'}} />

      <h3>Timeline</h3>
      {scenes.map((s, i) => (
        <div key={s.id} style={{border:'1px solid #444', padding:'12px', margin:'10px 0'}}>
          <input value={s.description} onChange={e => { const ns=[...scenes]; ns[i].description = e.target.value; setScenes(ns); }} />
          Start <input type="number" value={s.start} onChange={e => { const ns=[...scenes]; ns[i].start = +e.target.value; setScenes(ns); }} />s 
          Duration <input type="number" value={s.duration} onChange={e => { const ns=[...scenes]; ns[i].duration = +e.target.value; setScenes(ns); }} />s
        </div>
      ))}
      <button onClick={() => setScenes([...scenes, { id: Date.now(), description: "", start: scenes.length * 10, duration: 8 }])}>+ Add Still</button>

      <br/><br/>
      <button onClick={generateVideo} style={{padding:'20px 60px', fontSize:'1.4em', background:'#00ff9f'}}>Generate Video</button>

      {generatedVideoUrl && (
        <div style={{marginTop:'30px'}}>
          <video controls src={generatedVideoUrl} style={{width:'100%'}} />
          <button onClick={exportVideo} style={{marginTop:'10px', padding:'12px 30px'}}>Export MP4</button>
        </div>
      )}

      <p>{status}</p>
    </div>
  );
}

export default App;
