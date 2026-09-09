import { safeSession } from '../../utils/safeStorage';

interface LteTopupIntent {
  requestId: string;
  userId: number;
  subscriptionId: number;
  gb: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scopeKey = (userId: number, subscriptionId: number) =>
  `donbaton:lte-topup:${userId}:${subscriptionId}`;

/** Persist before charging or leaving for balance top-up; a lost response must be replayable. */
export function rememberLteTopupIntent(
  userId: number,
  subscriptionId: number,
  gb: number,
): LteTopupIntent | null {
  const scope = scopeKey(userId, subscriptionId);
  const key = `${scope}:${gb}`;
  const saved = safeSession.getJson<Partial<LteTopupIntent> | null>(key, null);
  const requestId =
    saved?.requestId && UUID.test(saved.requestId) ? saved.requestId : crypto.randomUUID();
  const intent = { requestId, userId, subscriptionId, gb };
  if (!safeSession.setJson(key, intent) || !safeSession.setJson(`${scope}:selected`, gb))
    return null;
  return intent;
}

export function restoreLteTopupPackage(userId: number, subscriptionId: number): number | null {
  const scope = scopeKey(userId, subscriptionId);
  const gb = safeSession.getJson<unknown>(`${scope}:selected`, null);
  if (typeof gb !== 'number' || !Number.isSafeInteger(gb) || gb <= 0) return null;
  const saved = safeSession.getJson<Partial<LteTopupIntent> | null>(`${scope}:${gb}`, null);
  return saved?.requestId && UUID.test(saved.requestId) ? gb : null;
}

/** Only a confirmed successful response clears an intent; closing the sheet never does. */
export function completeLteTopupIntent(intent: LteTopupIntent): void {
  const scope = scopeKey(intent.userId, intent.subscriptionId);
  safeSession.removeItem(`${scope}:${intent.gb}`);
  if (safeSession.getJson<unknown>(`${scope}:selected`, null) === intent.gb) {
    safeSession.removeItem(`${scope}:selected`);
  }
}
