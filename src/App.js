import React, { useState } from 'react';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [backendUrl] = useState('https://your-railway-backend.up.railway.app'); // ← Change this
  const [script, setScript] = useState('');
  const [scenes, setScenes] = useState([
    { id: 1, description: "Anchor at desk", start: 0, duration: 12 }
  ]);
  const [status, setStatus] = useState('');

  const addScene = () => {
    setScenes([...scenes, { id: Date.now(), description: "New still", start: 15, duration: 8 }]);
  };

  const generateVideo = async () => {
    setStatus('Sending to backend...');
    try {
      const res = await fetch(`${backendUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: script, api_key: apiKey, scenes })
      });
      const data = await res.json();
      setStatus(`Job started! ID: ${data.job_id}`);
    } catch (e) {
      setStatus('Error connecting to backend. Check URL.');
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: 'auto' }}>
      <h1>📰 Grok Video Studio</h1>

      <input 
        type="password" 
        placeholder="xAI API Key" 
        value={apiKey} 
        onChange={(e) => setApiKey(e.target.value)}
        style={{ width: '100%', padding: '12px', margin: '10px 0' }}
      />

      <textarea 
        value={script} 
        onChange={(e) => setScript(e.target.value)}
        placeholder="Full news script..."
        rows="8" 
        style={{ width: '100%', padding: '12px' }}
      />

      <h3>Timeline - Stills</h3>
      {scenes.map((s, i) => (
        <div key={s.id} style={{ border: '1px solid #ddd', padding: '10px', margin: '10px 0' }}>
          <input value={s.description} onChange={(e) => {
            const ns = [...scenes];
            ns[i].description = e.target.value;
            setScenes(ns);
          }} />
          <div>Start: <input type="number" value={s.start} onChange={(e) => {
            const ns = [...scenes]; ns[i].start = +e.target.value; setScenes(ns);
          }} />s Duration: <input type="number" value={s.duration} onChange={(e) => {
            const ns = [...scenes]; ns[i].duration = +e.target.value; setScenes(ns);
          }} />s</div>
        </div>
      ))}
      <button onClick={addScene}>+ Add Still</button>

      <br /><br />
      <button onClick={generateVideo} style={{ padding: '18px 60px', fontSize: '1.3em', background: '#00ff9f' }}>
        Generate Video
      </button>

      <p>{status}</p>
    </div>
  );
}

export default App;
