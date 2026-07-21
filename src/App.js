import React, { useState, useEffect } from 'react';

function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [backendUrl] = useState('https://your-railway-app.up.railway.app');
  const [script, setScript] = useState('');
  const [voiceFile, setVoiceFile] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState('default'); // Grok voices
  const [characterImage, setCharacterImage] = useState(null);
  const [scenes, setScenes] = useState([{ id: 1, description: "News Anchor", start: 0, duration: 12 }]);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => localStorage.setItem('xaiKey', apiKey), [apiKey]);

  const grokVoices = [
    { id: 'default', name: 'Default (Grok)' },
    { id: 'male1', name: 'Professional Male News' },
    { id: 'female1', name: 'Clear Female Narrator' },
    { id: 'energetic', name: 'Energetic Anchor' }
  ];

  const generateVideo = async () => {
    setStatus('Generating...');
    const formData = new FormData();
    formData.append('prompt', script);
    formData.append('api_key', apiKey);
    formData.append('voice_id', selectedVoice);
    if (voiceFile) formData.append('voice_file', voiceFile);
    if (characterImage) formData.append('character_image', characterImage);

    try {
      const res = await fetch(`${backendUrl}/generate`, { method: 'POST', body: formData });
      const data = await res.json();
      setGeneratedVideoUrl(data.video_url || '');
      setStatus(`Done! ${data.job_id ? 'Job: ' + data.job_id : ''}`);
    } catch (e) {
      setStatus('Error: ' + e.message);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: 'auto' }}>
      <h1>📰 Grok Video Studio</h1>

      <input type="password" placeholder="xAI API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px'}} />

      {/* Grok Voices */}
      <h3>Grok Built-in Voices</h3>
      <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} style={{width:'100%', padding:'12px'}}>
        {grokVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>

      <h3>OR Upload Custom Voice Sample</h3>
      <input type="file" accept="audio/*" onChange={e => setVoiceFile(e.target.files[0])} />

      {/* Character */}
      <h3>Character Reference Image</h3>
      <input type="file" accept="image/*" onChange={e => setCharacterImage(e.target.files[0])} />

      <h3>Script</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="8" style={{width:'100%'}} />

      {/* Timeline */}
      <h3>Timeline - Stills</h3>
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

      {generatedVideoUrl && <video controls src={generatedVideoUrl} style={{width:'100%', marginTop:'20px'}} />}

      <p>{status}</p>
    </div>
  );
}

export default App;
