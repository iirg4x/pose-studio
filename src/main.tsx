import { initializeBrowser } from './platform/browser';
import { createRoot } from 'react-dom/client';
import { StudioErrorBoundary } from './components/StudioErrorBoundary';
import './styles.css';
import './dark-ui.css';
import './action-ui.css';
import './properties.css';
import { initializeAndroid } from './platform/android';
import { LoadingStatus } from './components/LoadingStatus';
import './tablet.css';
import './animation-tools.css';
import './compact-ui.css';
import './animation-folders.css';
import './timeline-editor.css';
import './elevation.css';
import './motion.css';
import './interpolation-settings.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Pose could not find its application root.');
const root = createRoot(rootElement);
root.render(<LoadingStatus title="Starting Pose Studio" stage="Restoring workspace" />);

Promise.all([initializeAndroid().then(initializeBrowser), import('./App')])
  .then(([, { default: App }]) =>
    root.render(
      <StudioErrorBoundary>
        <App />
      </StudioErrorBoundary>,
    ),
  )
  .catch((error) => {
    root.render(
      <p role="alert">
        Pose could not start: {error instanceof Error ? error.message : String(error)}
      </p>,
    );
  });

import './animation-links.css';
// Last, so the shared design system applies over the older per-panel sheets.
import './design-system.css';
import './components/timeline-look.css';
import './touch-timeline.css';
import './phone.css';
import './standalone-panels.css';
import './touch-popovers.css';
