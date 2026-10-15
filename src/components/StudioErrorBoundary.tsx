import { Component, type ReactNode } from 'react';
import { downloadSafetyCopy } from '../platform/safetyCopy';
import { FailureNotice } from './FailureNotice';
import './reliability.css';

export class StudioErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="startup-fallback">
        <section className="graphics-fallback">
          <h1>Pose couldn’t display the editor</h1>
          <p role="alert">
            Your project data is still available. Download a recovery copy before retrying.
          </p>
          <div className="reliability-actions">
            <button onClick={() => void downloadSafetyCopy()}>Download recovery</button>
            <button onClick={() => this.setState({ failed: false })}>Retry editor</button>
          </div>
        </section>
        <FailureNotice />
      </main>
    );
  }
}
