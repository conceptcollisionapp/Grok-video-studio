import React, { useState } from 'react';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [backendUrl] = useState('https://your-railway-app.up.railway.app'); // Update with real URL
  const [script, setScript] = useState('');
  const [voiceFile, setVoiceFile] = useState(null);
  const [scenes, setScenes] = useState([
    { id: 1, description: "News Anchor", start: 0, duration: 12 }
  ]);
  const [status, setStatus] = useState('');

  const addScene = () => {
    setScenes([...scenes, { id: Date.now(), description: "", start: scenes.length * 10, duration: 8 }]);
  };

  const generateVideo = async () => {
    if (!apiKey) {
      setStatus("Please enter xAI API Key");
      return;
    }
    setStatus('Generating... (this may take 30-60s)');

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
      setStatus(`Success! Video Job ID: \( {data.job_id} \){data.video_url ? ' - Check console for URL' : ''}`);
    } catch (e) {
      setStatus('Error: ' + e.message);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: 'auto', fontFamily: 'system-ui' }}>
      <h1>📰 Grok Video Studio - Full News Mode</h1>

      <input type="password" placeholder="xAI API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px'}} />

      <h3>Voice Sample (for cloning)</h3>
      <input type="file" accept="audio/*" onChange={e => setVoiceFile(e.target.files[0])} />

      <h3>Script</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="8" style={{width:'100%'}} placeholder="Write full narration..." />

      <h3>Timeline (Stills / Scenes)</h3>
      {scenes.map((scene, i) => (
        <div key={scene.id} style={{border:'1px solid #444', padding:'15px', margin:'10px 0', borderRadius:'8px'}}>
          <input value={scene.description} onChange={e => {
            const ns = [...scenes]; ns[i].description = e.target.value; setScenes(ns);
          }} placeholder="Scene description" style={{width:'70%'}} />
          Start: <input type="number" value={scene.start} onChange={e => {
            const ns = [...scenes]; ns[i].start = +e.target.value; setScenes(ns);
          }} />s 
          Duration: <input type="number" value={scene.duration} onChange={e => {
            const ns = [...scenes]; ns[i].duration = +e.target.value; setScenes(ns);
          }} />s
        </div>
      ))}
      <button onClick={addScene}>+ Add Still/Scene</button>

      <br/><br/>
      <button onClick={generateVideo} style={{padding:'20px 60px', fontSize:'1.4em', background:'#00ff9f', border:'none', borderRadius:'12px'}}>
        🚀 Generate Video with Grok Imagine 1.5
      </button>

      <p style={{marginTop:'20px', fontWeight:'bold'}}>{status}</p>
    </div>
  );
}

export default App;
