import React, { useState } from 'react';

function App() {
  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: 'auto', fontFamily: 'system-ui' }}>
      <h1>📰 Grok Video Studio</h1>
      <p>Clean frontend for Grok Imagine Video 1.5</p>
      
      <input type="password" placeholder="xAI API Key" style={{width: '100%', padding: '12px', margin: '10px 0'}} />
      
      <textarea placeholder="Write your news script or prompt..." rows="8" style={{width: '100%', padding: '12px'}} />
      
      <button style={{padding: '15px 40px', fontSize: '1.2em', background: '#00ff9f', color: 'black', border: 'none', borderRadius: '8px', marginTop: '10px'}}>
        Generate News Video
      </button>

      <p style={{marginTop: '40px'}}>Full timeline, voice cloning, character consistency, and editor coming in next update.</p>
    </div>
  );
}

export default App;
