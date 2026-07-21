import React, { useState, useEffect } from 'react';

function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') !== 'false');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [backendUrl] = useState('https://your-railway-app.up.railway.app');
  const [script, setScript] = useState('');
  const [voicePreview, setVoicePreview] = useState(() => localStorage.getItem('voicePreview') || null);
  const [characterPreview, setCharacterPreview] = useState(() => localStorage.getItem('characterPreview') || null);
  const [selectedVoice, setSelectedVoice] = useState('default');
  const [resolution, setResolution] = useState('720p');
  const [scenes, setScenes] = useState([{ id: 1, description: "News Anchor", start: 0, duration: 12 }]);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');

  const toggleMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('darkMode', newMode);
  };

  // Apply dark mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.style.background = '#0f0f0f';
      document.documentElement.style.color = '#fff';
    } else {
      document.documentElement.style.background = '#f8f9fa';
      document.documentElement.style.color = '#000';
    }
  }, [darkMode]);

  const grokVoices = [ /* same as before */ ];
  const resolutions = ['480p', '720p', '1080p'];

  const handleVoice = (e) => { /* same as before */ };
  const handleCharacter = (e) => { /* same as before */ };
  const clearVoice = () => { /* same */ };
  const clearCharacter = () => { /* same */ };

  const generateVideo = async () => { /* same as before */ };

  const exportVideo = () => { /* same */ };

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: 'auto', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>📰 Grok Video Studio</h1>
        <button onClick={toggleMode} style={{ padding: '8px 16px', borderRadius: '8px' }}>
          {darkMode ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>

      {/* Rest of the UI (input fields, timeline, etc.) same as previous version */}

      {generatedVideoUrl && (
        <div>
          <video controls src={generatedVideoUrl} style={{width:'100%'}} />
          <button onClick={exportVideo} style={{marginTop:'10px', padding:'12px 30px'}}>Export MP4</button>
        </div>
      )}

      <p>{status}</p>
    </div>
  );
}

export default App;      <button onClick={() => setScenes([...scenes, { id: Date.now(), description: "", start: scenes.length * 10, duration: 8 }])}>+ Add Still</button>

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
