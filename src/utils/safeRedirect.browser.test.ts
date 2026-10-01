// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getSafeRedirectPath } from './safeRedirect';

// In the browser the same-origin check runs against window.location.origin
// (safeRedirect.test.ts covers the fallback used in a plain node environment).
describe('getSafeRedirectPath in a browser window', () => {
  it('checks against the real origin', () => {
    expect(window.location.origin).toMatch(/^https?:\/\//);
    expect(getSafeRedirectPath('/profile')).toBe('/profile');
    expect(getSafeRedirectPath('/subscription?x=1#y')).toBe('/subscription?x=1#y');
  });

  it('still rejects paths the URL parser would move to another origin', () => {
    expect(getSafeRedirectPath('/\t/evil.example/phish')).toBe('/');
    expect(getSafeRedirectPath('/\\evil')).toBe('/');
    expect(getSafeRedirectPath('/%09/evil')).toBe('/');
    expect(getSafeRedirectPath('//evil')).toBe('/');
    expect(getSafeRedirectPath('https://evil')).toBe('/');
  });
});
