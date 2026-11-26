import { useEffect } from 'react';
import type { WebToExt } from '../../protocol';
import { linkTarget } from '../links';

// A link of an answer goes to the host: the policy of the webview forbids
// the navigation and the click did nothing.
export function useLinkClicks(vscode: { postMessage(message: WebToExt): void }): void {
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      const anchor = (event.target as Element | null)?.closest?.('.markdown a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      event.preventDefault();
      const target = linkTarget(anchor.getAttribute('href') ?? '');
      if (target?.kind === 'web') {
        vscode.postMessage({ type: 'open_link', url: target.url });
      } else if (target?.kind === 'file') {
        vscode.postMessage({ type: 'open_file', path: target.path, line: target.line });
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [vscode]);
}
