import * as vscode from 'vscode';

const SECRET_KEY = 'minimax.apiKey';
const ENV_KEY = 'MINIMAX_API_KEY';

export async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const stored = await secrets.get(SECRET_KEY);
  if (stored && stored.trim().length > 0) {
    return stored.trim();
  }
  const fromEnv = process.env[ENV_KEY];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return undefined;
}

export async function setApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(SECRET_KEY, key.trim());
}

export async function clearApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_KEY);
}
