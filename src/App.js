import React, { useState, useEffect } from 'react';

function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [backendUrl] = useState('https://your-railway-backend.up.railway.app'); // Update this
  const [script, setScript] = useState('');
  const [voiceFile, setVoiceFile] = useState(null);
  const [scenes, setScenes] = useState([
    { id: 1, description: "News Anchor at desk", start: 0, duration: 12 }
  ]);
  const [status, setStatus] = useState('');

  // Auto-save API key
  useEffect(() => {
    localStorage.setItem('xaiKey', apiKey);
  }, [apiKey]);

  const addScene = () => {
    setScenes([...scenes, { id: Date.now(), description: "New scene", start: scenes.length * 10, duration: 8 }]);
  };

  const generateVideo = async () => {
    if (!apiKey) {
      setStatus("Enter your xAI API Key first");
      return;
    }
    setStatus('Generating with Grok Imagine 1.5...');

    const formData = new FormData();
    formData.append('prompt', script);
    formData.append('api_key', apiKey);
    if (voiceFile) formData.append('voice_file', voiceFile);

    try {
      const res = await fetch(`${backendUrl}/generate`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      setStatus(`Job ID: ${data.job_id || 'started'} - Check backend logs or console`);
    } catch (e) {
      setStatus('Error: Make sure backend is running. ' + e.message);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: 'auto', fontFamily: 'system-ui' }}>
      <h1>📰 Grok Video Studio</h1>

      <input 
        type="password" 
        placeholder="xAI API Key (saved automatically)" 
        value={apiKey} 
        onChange={(e) => setApiKey(e.target.value)}
        style={{ width: '100%', padding: '12px', marginBottom: '15px' }}
      />

      <h3>Voice Sample (Cloning)</h3>
      <input type="file" accept="audio/*" onChange={e => setVoiceFile(e.target.files[0])} />

      <h3>News Script</h3>
      <textarea 
        value={script} 
        onChange={e => setScript(e.target.value)}
        placeholder="Full narration script here..."
        rows="8" 
        style={{ width: '100%', padding: '12px' }}
      />

      <h3>Timeline - Add Stills</h3>
      {scenes.map((scene, i) => (
        <div key={scene.id} style={{ border: '1px solid #444', padding: '15px', margin: '10px 0', borderRadius: '8px' }}>
          <input 
            value={scene.description} 
            onChange={e => {
              const ns = [...scenes];
              ns[i].description = e.target.value;
              setScenes(ns);
            }} 
            placeholder="Scene description" 
            style={{ width: '70%' }} 
          />
          <div>Start: <input type="number" value={scene.start} onChange={e => {
            const ns = [...scenes]; ns[i].start = +e.target.value; setScenes(ns);
          }} />s Duration: <input type="number" value={scene.duration} onChange={e => {
            const ns = [...scenes]; ns[i].duration = +e.target.value; setScenes(ns);
          }} />s</div>
        </div>
      ))}
      <button onClick={addScene}>+ Add Still/Scene</button>

      <br /><br />
      <button onClick={generateVideo} style={{ padding: '20px 60px', fontSize: '1.4em', background: '#00ff9f', border: 'none', borderRadius: '12px', cursor: 'pointer' }}>
        Generate Video
      </button>

      <p style={{ marginTop: '20px', fontWeight: 'bold' }}>{status}</p>
    </div>
  );
}

export default App;
