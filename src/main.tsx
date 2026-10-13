import './hosted.css';
import {initializeBrowser} from './platform/browser';
import React from 'react';import {createRoot} from 'react-dom/client';import App from './App';import './styles.css';import './dark-ui.css';import './action-ui.css';import './properties.css';import {initializeAndroid} from './platform/android';import './tablet.css';import './animation-tools.css';import './compact-ui.css';import './animation-folders.css';import './timeline-editor.css';import './elevation.css';import './motion.css';import './interpolation-settings.css';
initializeAndroid().then(initializeBrowser).then(()=>createRoot(document.getElementById('root')!).render(<App/>)).catch(error=>{document.getElementById('root')!.textContent='Pose could not initialize local storage: '+error.message;});

import './animation-links.css';
