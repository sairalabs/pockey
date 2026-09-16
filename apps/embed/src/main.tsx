import { EMBED_APP_ID_PARAM } from '@pocketkey/types';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startEmbed } from './embed';
import './styles.css';

const container = document.getElementById('root');

function Notice() {
  return (
    <div
      className="pk-theme flex min-h-dvh items-center justify-center bg-surface p-6"
      data-theme="light"
    >
      <p className="text-center text-[15px] text-fg-2">
        This page is meant to be embedded by the Pocketkey SDK.
      </p>
    </div>
  );
}

if (container) {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get(EMBED_APP_ID_PARAM) ?? '';
  const embedded = window.parent !== window;
  const root = createRoot(container);

  if (embedded) {
    startEmbed(root, appId);
  } else if (params.get('preview') === '1') {
    void import('./preview/Preview').then(({ Preview }) => {
      root.render(
        <StrictMode>
          <Preview appId={appId} />
        </StrictMode>,
      );
    });
  } else {
    root.render(
      <StrictMode>
        <Notice />
      </StrictMode>,
    );
  }
}
