import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearStoredPage, DEFAULT_PAGE, persistPage, readStoredPage } from './pageStorage';

const STORAGE_KEY = 'app-last-page';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length() {
    return this.items.size;
  }

  clear() {
    this.items.clear();
  }

  getItem(key: string) {
    return this.items.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.items.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.items.delete(key);
  }

  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

function withSessionStorage(storage: Storage) {
  vi.stubGlobal('window', { sessionStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pageStorage', () => {
  it('returns the default page when storage is unavailable', () => {
    vi.stubGlobal('window', undefined);

    expect(readStoredPage()).toBe(DEFAULT_PAGE);
    expect(() => persistPage('reports')).not.toThrow();
    expect(() => clearStoredPage()).not.toThrow();
  });

  it('reads and writes valid pages in session storage', () => {
    const storage = new MemoryStorage();
    withSessionStorage(storage);

    persistPage('billing');

    expect(readStoredPage()).toBe('billing');
    expect(storage.getItem(STORAGE_KEY)).toBe('billing');
  });

  it('removes invalid stored page values and falls back to the default page', () => {
    const storage = new MemoryStorage();
    withSessionStorage(storage);
    storage.setItem(STORAGE_KEY, 'not-a-page');

    expect(readStoredPage()).toBe(DEFAULT_PAGE);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clears the stored page', () => {
    const storage = new MemoryStorage();
    withSessionStorage(storage);
    persistPage('profile');

    clearStoredPage();

    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('falls back to the default page when storage access throws', () => {
    const blockedWindow = Object.defineProperty({}, 'sessionStorage', {
      get() {
        throw new Error('Storage is blocked.');
      },
    });
    vi.stubGlobal('window', blockedWindow);

    expect(readStoredPage()).toBe(DEFAULT_PAGE);
    expect(() => persistPage('power')).not.toThrow();
    expect(() => clearStoredPage()).not.toThrow();
  });

  it('ignores read and write failures after storage is available', () => {
    const storage = {
      getItem() {
        throw new Error('Read failed.');
      },
      removeItem() {
        throw new Error('Remove failed.');
      },
      setItem() {
        throw new Error('Write failed.');
      },
    } as unknown as Storage;
    withSessionStorage(storage);

    expect(readStoredPage()).toBe(DEFAULT_PAGE);
    expect(() => persistPage('settings')).not.toThrow();
    expect(() => clearStoredPage()).not.toThrow();
  });
});
