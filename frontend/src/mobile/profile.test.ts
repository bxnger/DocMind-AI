import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, MAX_ORGANIZATION, modeFor, parseProfile } from './profile';

describe('the phone profile', () => {
  it('reads only what it knows, and nothing else', () => {
    expect(parseProfile({ completed: true, userType: 'engineer', organization: '  Завод  ', email: 'x@y.kz' })).toEqual({ completed: true, userType: 'engineer', organization: 'Завод' });
    expect(parseProfile({ completed: 'yes', userType: 'admin' })).toEqual(EMPTY_PROFILE);
    expect(parseProfile(null)).toEqual(EMPTY_PROFILE);
    expect(parseProfile({ organization: 'a'.repeat(200) }).organization).toHaveLength(MAX_ORGANIZATION);
  });
  it('starts work modes in procurement, personal use in the general chat', () => {
    expect(modeFor('personal')).toBe('general');
    expect(modeFor('engineer')).toBe('procurement');
    expect(modeFor(null)).toBe('procurement');
  });
});
