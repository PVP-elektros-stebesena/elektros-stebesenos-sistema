import type { Page } from '../types/energy';

const STORAGE_KEY = 'app-last-page';
export const DEFAULT_PAGE: Page = 'voltage';
const VALID_PAGES: ReadonlySet<Page> = new Set([
  'currentData',
  'voltage',
  'power',
  'reports',
  'billing',
  'profile',
  'settings',
]);

function isValidPage(value: string): value is Page {
  return VALID_PAGES.has(value as Page);
}

function getPageStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStoredPage(): Page {
  const storage = getPageStorage();
  if (!storage) {
    return DEFAULT_PAGE;
  }

  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (stored && isValidPage(stored)) {
      return stored;
    }
    if (stored) {
      storage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors and fall back to default.
  }

  return DEFAULT_PAGE;
}

export function persistPage(page: Page): void {
  const storage = getPageStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(STORAGE_KEY, page);
  } catch {
    // Ignore storage access errors.
  }
}

export function clearStoredPage(): void {
  const storage = getPageStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage access errors.
  }
}
