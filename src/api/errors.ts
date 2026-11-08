export class MiniMaxApiError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, status: number, code: number | undefined, retryable: boolean) {
    super(message);
    this.name = 'MiniMaxApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

interface MiniMaxErrorBody {
  error?: { type?: string; message?: string };
  base_resp?: { status_code?: number; status_msg?: string };
  message?: string;
}

const CODE_MESSAGES: Record<number, string> = {
  2049: 'Invalid MiniMax API key. Check the key in MiniMax: Add API Key.',
  2057: 'This key is not an M Plan key. Use your Token Plan subscription key.',
  2061: 'The selected model is not available for your plan. Pick another model.',
  2062: 'M Plan rate limit reached. Wait for the quota window or upgrade the plan.',
  2066: 'MiniMax servers are under heavy load. Retry shortly.'
};

export async function mapHttpError(response: Response): Promise<MiniMaxApiError> {
  let body: MiniMaxErrorBody = {};
  try {
    body = (await response.json()) as MiniMaxErrorBody;
  } catch {
    body = {};
  }
  const rawMessage =
    body.error?.message ?? body.base_resp?.status_msg ?? body.message ?? response.statusText;
  const rawCode = body.base_resp?.status_code ?? body.error?.type;
  const code = typeof rawCode === 'number' ? rawCode : undefined;

  if (code !== undefined && CODE_MESSAGES[code] !== undefined) {
    return new MiniMaxApiError(CODE_MESSAGES[code]!, response.status, code, code === 2066);
  }
  if (response.status === 401 || response.status === 403) {
    return new MiniMaxApiError(
      'Invalid MiniMax API key. Check the key in MiniMax: Add API Key.',
      response.status,
      code,
      false
    );
  }
  if (response.status === 429) {
    return new MiniMaxApiError('Rate limit reached. Retry shortly.', response.status, code, true);
  }
  if (response.status >= 500) {
    return new MiniMaxApiError(
      'MiniMax server error: ' + (rawMessage || response.status),
      response.status,
      code,
      true
    );
  }
  return new MiniMaxApiError(
    'MiniMax request failed: ' + (rawMessage || response.status),
    response.status,
    code,
    false
  );
}
