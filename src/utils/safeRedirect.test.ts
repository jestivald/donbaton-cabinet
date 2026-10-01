import { describe, expect, it } from 'vitest';
import { getSafeRedirectPath } from './safeRedirect';

describe('getSafeRedirectPath', () => {
  it('returns / for empty values', () => {
    expect(getSafeRedirectPath(null)).toBe('/');
    expect(getSafeRedirectPath(undefined)).toBe('/');
    expect(getSafeRedirectPath('')).toBe('/');
  });

  it('keeps plain absolute in-app paths', () => {
    expect(getSafeRedirectPath('/')).toBe('/');
    expect(getSafeRedirectPath('/dashboard')).toBe('/dashboard');
    expect(getSafeRedirectPath('/sub/page?tab=devices&x=1')).toBe('/sub/page?tab=devices&x=1');
  });

  it('keeps query and hash of an in-app path as they are', () => {
    expect(getSafeRedirectPath('/profile')).toBe('/profile');
    expect(getSafeRedirectPath('/subscription?x=1#y')).toBe('/subscription?x=1#y');
    expect(getSafeRedirectPath('/subscriptions/12/renew?period=30&promo=AB-1#top')).toBe(
      '/subscriptions/12/renew?period=30&promo=AB-1#top',
    );
    expect(getSafeRedirectPath('/balance?amount=500')).toBe('/balance?amount=500');
  });

  it('rejects protocol-relative and absolute URLs', () => {
    expect(getSafeRedirectPath('//evil.com')).toBe('/');
    expect(getSafeRedirectPath('//evil')).toBe('/');
    expect(getSafeRedirectPath('https://evil.com/path')).toBe('/');
    expect(getSafeRedirectPath('https://evil')).toBe('/');
    expect(getSafeRedirectPath('http://evil.com')).toBe('/');
  });

  it('rejects non-path schemes', () => {
    expect(getSafeRedirectPath('javascript:alert(1)')).toBe('/');
    expect(getSafeRedirectPath('data:text/html,x')).toBe('/');
  });

  it('rejects URL-encoded host smuggling', () => {
    expect(getSafeRedirectPath('%2F%2Fevil.com')).toBe('/');
    expect(getSafeRedirectPath('/%2F%2Fevil')).toBe('/');
    expect(getSafeRedirectPath('/redirect%3A%2F%2Fevil.com')).toBe('/');
  });

  it('rejects malformed percent-encoding instead of throwing', () => {
    expect(getSafeRedirectPath('/%E0%A4%A')).toBe('/');
  });

  // The browser's URL parser drops TAB/LF/CR and reads `\` as `/`, so these
  // become //evil… — another origin. react-router's push() then falls back to
  // window.location.assign() when pushState throws, i.e. leaves the site.
  it('rejects control characters and backslashes that the URL parser turns into //host', () => {
    expect(new URL('/\t/evil.example/x', 'https://cabinet.example').origin).toBe(
      'https://evil.example',
    );
    expect(getSafeRedirectPath('/\t/evil.example')).toBe('/');
    expect(getSafeRedirectPath('/\t/evil.example/phish')).toBe('/');
    expect(getSafeRedirectPath('/\n/evil')).toBe('/');
    expect(getSafeRedirectPath('/\r/evil')).toBe('/');
    expect(getSafeRedirectPath('/\\evil')).toBe('/');
    expect(getSafeRedirectPath('/\\\t\\evil')).toBe('/');
    expect(getSafeRedirectPath('/profile\\..\\evil')).toBe('/');
  });

  it('rejects the same characters anywhere in the path and other C0 controls and DEL', () => {
    expect(getSafeRedirectPath('/ok/\t/evil')).toBe('/');
    expect(getSafeRedirectPath('/ok?next=\n//evil')).toBe('/');
    expect(getSafeRedirectPath('/\u0000/evil')).toBe('/');
    expect(getSafeRedirectPath('/\u000b/evil')).toBe('/');
    expect(getSafeRedirectPath('/\u007f/evil')).toBe('/');
  });

  it('rejects percent-encoded control characters and backslashes', () => {
    expect(getSafeRedirectPath('/%09/evil')).toBe('/');
    expect(getSafeRedirectPath('/%0A/evil')).toBe('/');
    expect(getSafeRedirectPath('/%0D/evil')).toBe('/');
    expect(getSafeRedirectPath('/%7F/evil')).toBe('/');
    expect(getSafeRedirectPath('/%5Cevil')).toBe('/');
    expect(getSafeRedirectPath('/%5C%09%5Cevil')).toBe('/');
  });
});
