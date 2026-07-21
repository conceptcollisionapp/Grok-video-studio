import React, { useState, useEffect } from 'react';

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === null ? true : saved === 'true';
  });

  const [apiKey, setApiKey] = useState(() => localStorage.getItem('xaiKey') || '');
  const [backendUrl] = useState('https://grok-video-studio-production.up.railway.app');
  const [script, setScript] = useState('');
  const [voicePreview, setVoicePreview] = useState(() => localStorage.getItem('voicePreview') || null);
  const [characterPreviews, setCharacterPreviews] = useState(() => JSON.parse(localStorage.getItem('characterPreviews') || '[]'));
  const [selectedVoice, setSelectedVoice] = useState('default');
  const [resolution, setResolution] = useState('720p');
  const [scenes, setScenes] = useState([{ id: 1, description: "News Anchor", start: 0, duration: 12, end: 12, image: null }]);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');
  const [status, setStatus] = useState('');

  const grokVoices = [
    { id: 'default', name: 'Default Grok' },
    { id: 'male-news', name: 'Professional Male Anchor' },
    { id: 'female-clear', name: 'Clear Female Narrator' },
    { id: 'energetic', name: 'Energetic' }
  ];

  const resolutions = ['480p', '720p', '1080p'];

  useEffect(() => {
    localStorage.setItem('xaiKey', apiKey);
    localStorage.setItem('darkMode', darkMode);
    localStorage.setItem('characterPreviews', JSON.stringify(characterPreviews));
  }, [apiKey, darkMode, characterPreviews]);

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

  const updateSceneImage = (index, file) => {
    if (file) {
      const url = URL.createObjectURL(file);
      const ns = [...scenes];
      ns[index].image = url;
      setScenes(ns);
    }
  };

  const generateVideo = async () => {
    setStatus('Generating with Grok Imagine 1.5...');
    setTimeout(() => {
      setGeneratedVideoUrl('https://example.com/demo-news-video.mp4');
      setStatus('Video ready (demo)');
    }, 2500);
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

      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}} />

      <h3>Grok Voices</h3>
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

      <h3>Script</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="6" style={{width:'100%', padding:'12px', marginBottom:'15px'}} placeholder="Full news script..." />

      <h3>Timeline - Stills (with images & End Time)</h3>
      {scenes.map((s, i) => (
        <div key={s.id} style={{ border: '1px solid #444', padding: '12px', margin: '10px 0', borderRadius: '8px' }}>
          <input value={s.description} onChange={e => { const ns = [...scenes]; ns[i].description = e.target.value; setScenes(ns); }} placeholder="Description" style={{width:'70%'}} />
          <input type="file" accept="image/*" onChange={e => updateSceneImage(i, e.target.files[0])} />
          {s.image && <img src={s.image} alt="still" style={{ maxWidth: '150px', margin: '5px 0', display: 'block' }} />}
          
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
        </div>
      ))}
      <button onClick={() => setScenes([...scenes, { id: Date.now(), description: "New still", start: scenes.length * 10, duration: 8, end: scenes.length * 10 + 8, image: null }])}>+ Add Still</button>

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

export default App;      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}} />

      <h3>Grok Voices</h3>
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

      <h3>Script</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="6" style={{width:'100%', padding:'12px', marginBottom:'15px'}} placeholder="Full news script..." />

      <h3>Timeline - Stills (with images & End Time)</h3>
      {scenes.map((s, i) => (
        <div key={s.id} style={{ border: '1px solid #444', padding: '12px', margin: '10px 0', borderRadius: '8px' }}>
          <input value={s.description} onChange={e => { const ns = [...scenes]; ns[i].description = e.target.value; setScenes(ns); }} placeholder="Description" style={{width:'70%'}} />
          <input type="file" accept="image/*" onChange={e => updateSceneImage(i, e.target.files[0])} />
          {s.image && <img src={s.image} alt="still" style={{ maxWidth: '150px', margin: '5px 0', display: 'block' }} />}
          
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
        </div>
      ))}
      <button onClick={() => setScenes([...scenes, { id: Date.now(), description: "New still", start: scenes.length * 10, duration: 8, end: scenes.length * 10 + 8, image: null }])}>+ Add Still</button>

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

export default App;      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}} />

      <h3>Grok Voices</h3>
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

      <h3>Script</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="6" style={{width:'100%', padding:'12px', marginBottom:'15px'}} placeholder="Full news script..." />

      <h3>Timeline - Stills (with images & End Time)</h3>
      {scenes.map((s, i) => (
        <div key={s.id} style={{ border: '1px solid #444', padding: '12px', margin: '10px 0', borderRadius: '8px' }}>
          <input value={s.description} onChange={e => { const ns = [...scenes]; ns[i].description = e.target.value; setScenes(ns); }} placeholder="Description" style={{width:'70%'}} />
          <input type="file" accept="image/*" onChange={e => updateSceneImage(i, e.target.files[0])} />
          {s.image && <img src={s.image} alt="still" style={{ maxWidth: '150px', margin: '5px 0', display: 'block' }} />}
          
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
        </div>
      ))}
      <button onClick={() => setScenes([...scenes, { id: Date.now(), description: "New still", start: scenes.length * 10, duration: 8, end: scenes.length * 10 + 8, image: null }])}>+ Add Still</button>

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

export default App;      <input type="password" placeholder="xAI API Key (saved)" value={apiKey} onChange={e => setApiKey(e.target.value)} style={{width:'100%', padding:'12px', marginBottom:'15px'}} />

      <h3>Grok Voices</h3>
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

      <h3>Script</h3>
      <textarea value={script} onChange={e => setScript(e.target.value)} rows="6" style={{width:'100%', padding:'12px', marginBottom:'15px'}} placeholder="Full news script..." />

      <h3>Timeline - Stills (with images)</h3>
      {scenes.map((s, i) => (
        <div key={s.id} style={{ border: '1px solid #444', padding: '12px', margin: '10px 0', borderRadius: '8px' }}>
          <input value={s.description} onChange={e => { const ns = [...scenes]; ns[i].description = e.target.value; setScenes(ns); }} placeholder="Description" style={{width:'70%'}} />
          <input type="file" accept="image/*" onChange={e => updateSceneImage(i, e.target.files[0])} />
          {s.image && <img src={s.image} alt="still" style={{ maxWidth: '150px', margin: '5px 0' }} />}
          Start <input type="number" value={s.start} onChange={e => { const ns = [...scenes]; ns[i].start = +e.target.value; setScenes(ns); }} style={{width:'60px'}} />s 
          Duration <input type="number" value={s.duration} onChange={e => { const ns = [...scenes]; ns[i].duration = +e.target.value; setScenes(ns); }} style={{width:'60px'}} />s
        </div>
      ))}
      <button onClick={() => setScenes([...scenes, { id: Date.now(), description: "New still", start: scenes.length * 10, duration: 8, image: null }])}>+ Add Still</button>

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
