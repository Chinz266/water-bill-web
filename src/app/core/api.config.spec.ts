import { resolveApiBaseUrl } from './api.config';

describe('API URL configuration', () => {
  it('keeps local and LAN development working', () => {
    expect(resolveApiBaseUrl('http://192.168.1.10:4200/home')).toBe('http://192.168.1.10:3000');
    expect(resolveApiBaseUrl('http://[::1]:4200')).toBe('http://[::1]:3000');
  });
  it('uses same-origin HTTPS by default and supports an override', () => {
    expect(resolveApiBaseUrl('https://water.example/home')).toBe('https://water.example/api');
    expect(resolveApiBaseUrl('https://water.example', 'https://api.example/')).toBe('https://api.example');
    expect(resolveApiBaseUrl('https://water.example', '/backend/')).toBe('https://water.example/backend');
  });
  it('rejects mixed content, credentials and unsafe protocols', () => {
    for (const value of ['http://api.example', 'javascript:alert(1)', 'https://user:pass@api.example', 'https://api.example?secret=x']) {
      expect(() => resolveApiBaseUrl('https://water.example', value)).toThrow();
    }
  });
});
