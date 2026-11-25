import { useEffect, useState } from 'react';
import type { UiMcpServer, UiSkill } from '../extrasProtocol';
import type { WebToExt } from '../protocol';

// The skills and the MCP servers of the panel: the tabs of the settings show
// them, the slash of the field suggests the skills. The host sends them on
// request and after a start of the servers.
export function useExtras(vscode: { postMessage: (message: WebToExt) => void }): {
  skills: UiSkill[];
  servers: UiMcpServer[];
  refresh: () => void;
} {
  const [skills, setSkills] = useState<UiSkill[]>([]);
  const [servers, setServers] = useState<UiMcpServer[]>([]);
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: string; items?: UiSkill[]; servers?: UiMcpServer[] };
      if (message.type === 'skills' && Array.isArray(message.items)) {
        setSkills(message.items);
      } else if (message.type === 'mcp' && Array.isArray(message.servers)) {
        setServers(message.servers);
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'request_extras' });
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return { skills, servers, refresh: () => vscode.postMessage({ type: 'request_extras' }) };
}
