import React, { useState, useEffect } from 'react';

function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [backendUrl] = useState('https://your-railway-app.up.railway.app'); // Update
  const [script, setScript] = useState('');
  const [voiceFile, setVoiceFile] = useState(null);
  const [characterImage, setCharacterImage] = useState(null);
  const [scenes, setScenes] = useState([{ id: 1, description: "News Anchor", start: 0, duration: 12 }]);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    localStorage.setItem('xaiKey', apiKey);
  }, [apiKey]);

  const addScene = () => {
    setScenes([...scenes, { id: Date.now(), description: "New still", start: scenes.length * 10, duration: 8 }]);
  };

  const generateVideo = async () => {
    setStatus('Generating with Grok Imagine 1.5...');
    const formData = new FormData();
    formData.append('prompt', script);
    formData.append('api_key', apiKey);
    if (voiceFile) formData.append('voice_file', voiceFile);
    if (characterImage) formData.append('character_image', characterImage);

    try {
      const res = await fetch(`${backendUrl}/generate`, { method: 'POST', body: formData });
      const data = await res.json();
      setGeneratedVideoUrl(data.video_url || '');
      setStatus(`Generated! Job: ${data.job_id}`);
    } catch (e) {
      setStatus('Error: ' + e.message);
    }
  };

  const trimVideo = () => {
    setStatus('Trimmed (demo - full FFmpeg in backend)');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: 'auto', fontFamily: 'system-ui' }}>
      <h1>📰 Grok Video Studio</h1>

      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}} />

      {/* Character Reference */}
      <h3>Character Reference (Consistent Anchor)</h3>
      <input type="file" accept="image/*" onChange={e => setCharacterImage(e.target.files[0])} />

      {/* Voice */}
      <h3>Voice Sample</h3>
      <input type="file" accept="audio/*" onChange={e => setVoiceFile(e.target.files[0])} />

      {/* Script */}
      <h3>Script</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="6" style={{width:'100%'}} placeholder="News narration..." />

      {/* Timeline */}
      <h3>Timeline - Stills</h3>
      {scenes.map((s, i) => (
        <div key={s.id} style={{border:'1px solid #444', padding:'12px', margin:'10px 0', borderRadius:'8px'}}>
          <input value={s.description} onChange={e => { const ns=[...scenes]; ns[i].description=e.target.value; setScenes(ns); }} placeholder="Description" />
          Start <input type="number" value={s.start} onChange={e => { const ns=[...scenes]; ns[i].start=+e.target.value; setScenes(ns); }} />s 
          Duration <input type="number" value={s.duration} onChange={e => { const ns=[...scenes]; ns[i].duration=+e.target.value; setScenes(ns); }} />s
        </div>
      ))}
      <button onClick={addScene}>+ Add Still</button>

      <br/><br/>
      <button onClick={generateVideo} style={{padding:'18px 50px', fontSize:'1.3em', background:'#00ff9f'}}>Generate Video</button>

      {generatedVideoUrl && (
        <div style={{marginTop:'30px'}}>
          <h3>Generated Video</h3>
          <video controls src={generatedVideoUrl} style={{width:'100%'}} />
          
          <h4>Quick Editor</h4>
          <button onClick={trimVideo}>Trim First 5s</button>
          <button>Add Text Overlay</button>
          <button>Export MP4</button>
        </div>
      )}

      <p>{status}</p>
    </div>
  );
}

export default App;
