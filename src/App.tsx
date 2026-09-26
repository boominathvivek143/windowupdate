import React from 'react';
import { SimpleSender } from './sender/SimpleSender';
import { CompanionApp } from './companion/CompanionApp';

export default function App() {
  // Inside the Electron desktop app (preload exposes window.companion): show the companion window
  if (typeof window !== 'undefined' && window.companion) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex flex-col overflow-hidden">
        <CompanionApp />
      </div>
    );
  }

  // In a browser: the sender page that types into the desktop app
  return <SimpleSender />;
}
