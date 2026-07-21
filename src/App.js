import React, { useState } from 'react';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [script, setScript] = useState('');
  const [scenes, setScenes] = useState([
    { id: 1, image: null, start: 0, duration: 10, description: "Anchor talking" }
  ]);
  const [characterImage, setCharacterImage] = useState(null);

  const addScene = () => {
    setScenes([...scenes, { id: Date.now(), image: null, start: 15, duration: 8, description: "New scene" }]);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: 'auto', fontFamily: 'system-ui' }}>
      <h1>📰 Grok Video Studio - News Edition</h1>

      <div style={{ marginBottom: '20px' }}>
        <input 
          type="password" 
          placeholder="xAI API Key" 
          value={apiKey} 
          onChange={(e) => setApiKey(e.target.value)}
          style={{ width: '100%', padding: '12px', marginBottom: '10px' }}
        />
      </div>

      {/* Character Reference */}
      <div style={{ marginBottom: '20px' }}>
        <h3>Consistent Character (Anchor)</h3>
        <input type="file" accept="image/*" onChange={(e) => setCharacterImage(e.target.files[0])} />
      </div>

      {/* Script */}
      <div style={{ marginBottom: '20px' }}>
        <h3>Full Script / Narration</h3>
        <textarea 
          value={script} 
          onChange={(e) => setScript(e.target.value)}
          placeholder="Write your full news script here..."
          rows="6" 
          style={{ width: '100%', padding: '12px' }}
        />
      </div>

      {/* Timeline / Scenes */}
      <div style={{ marginBottom: '30px' }}>
        <h3>Timeline - Add Stills & Durations</h3>
        {scenes.map((scene, index) => (
          <div key={scene.id} style={{ border: '1px solid #ccc', padding: '15px', marginBottom: '10px', borderRadius: '8px' }}>
            <input 
              type="text" 
              placeholder="Scene description" 
              value={scene.description} 
              onChange={(e) => {
                const newScenes = [...scenes];
                newScenes[index].description = e.target.value;
                setScenes(newScenes);
              }}
            />
            <input type="file" accept="image/*" onChange={(e) => {
              const newScenes = [...scenes];
              newScenes[index].image = e.target.files[0];
              setScenes(newScenes);
            }} />
            <div>
              Start: <input type="number" value={scene.start} onChange={(e) => {
                const newScenes = [...scenes];
                newScenes[index].start = parseInt(e.target.value);
                setScenes(newScenes);
              }} /> s
            </div>
            <div>
              Duration: <input type="number" value={scene.duration} onChange={(e) => {
                const newScenes = [...scenes];
                newScenes[index].duration = parseInt(e.target.value);
                setScenes(newScenes);
              }} /> s
            </div>
          </div>
        ))}
        <button onClick={addScene}>+ Add Still / Scene</button>
      </div>

      <button style={{ padding: '18px 50px', fontSize: '1.3em', background: '#00ff9f', color: '#000', border: 'none', borderRadius: '12px', cursor: 'pointer' }}>
        Generate Full Video with Grok Imagine 1.5
      </button>

      <p style={{ marginTop: '30px', fontSize: '0.9em' }}>
        After generation, you'll be able to edit like CapCut (trim, text, transitions). Voice cloning coming in backend update.
      </p>
    </div>
  );
}

export default App;
