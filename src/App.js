import React, { useState, useEffect } from 'react';

function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [characterPreview, setCharacterPreview] = useState(() => localStorage.getItem('characterPreview') || null);
  const [voicePreview, setVoicePreview] = useState(() => localStorage.getItem('voicePreview') || null);
  const [backendUrl] = useState('https://your-railway-app.up.railway.app');
  const [script, setScript] = useState('');
  const [selectedVoice, setSelectedVoice] = useState('default');
  const [scenes, setScenes] = useState([{ id: 1, description: "News Anchor", start: 0, duration: 12 }]);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');

  const grokVoices = [
    { id: 'default', name: 'Default Grok' },
    { id: 'male-news', name: 'Professional Male Anchor' },
    { id: 'female-clear', name: 'Clear Female Narrator' },
    { id: 'energetic', name: 'Energetic' }
  ];

  useEffect(() => {
    localStorage.setItem('xaiKey', apiKey);
  }, [apiKey]);

  const handleCharacter = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCharacterPreview(url);
      localStorage.setItem('characterPreview', url);
    }
  };

  const handleVoice = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVoicePreview(url);
      localStorage.setItem('voicePreview', url);
    }
  };

  const clearCharacter = () => {
    setCharacterPreview(null);
    localStorage.removeItem('characterPreview');
  };

  const clearVoice = () => {
    setVoicePreview(null);
    localStorage.removeItem('voicePreview');
  };

  const generateVideo = async () => {
    setStatus('Generating...');
    // ... (same as before, add formData for files)
    // For demo:
    setTimeout(() => {
      setGeneratedVideoUrl('https://example.com/demo-video.mp4'); // Replace with real
      setStatus('Video ready (demo)');
    }, 1500);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: 'auto' }}>
      <h1>📰 Grok Video Studio</h1>

      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px'}} />

      <h3>Grok Voices</h3>
      <select value={selectedVoice} onChange={e => setSelectedVoice(e.target.value)} style={{width:'100%', padding:'12px'}}>
        {grokVoices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>

      <h3>Custom Voice Sample (saved)</h3>
      <input type="file" accept="audio/*" onChange={handleVoice} />
      {voicePreview && <p>Voice saved ✓ <button onClick={clearVoice}>Clear</button></p>}

      <h3>Character Reference (saved - multiple supported later)</h3>
      <input type="file" accept="image/*" onChange={handleCharacter} />
      {characterPreview && (
        <div>
          <img src={characterPreview} alt="Character" style={{ maxWidth: '200px', margin: '10px 0' }} />
          <button onClick={clearCharacter}>Change / Delete</button>
        </div>
      )}

      {/* Script + Timeline same as before */}

      <button onClick={generateVideo} style={{padding:'20px 60px', fontSize:'1.4em', background:'#00ff9f'}}>Generate Video</button>

      {generatedVideoUrl && <video controls src={generatedVideoUrl} style={{width:'100%', marginTop:'20px'}} />}

      <p>{status}</p>
    </div>
  );
}

export default App;
