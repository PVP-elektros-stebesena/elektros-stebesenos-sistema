import type { Page } from '../types/energy';

const STORAGE_KEY = 'app-last-page';
const DEFAULT_PAGE: Page = 'voltage';
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

export function readStoredPage(): Page {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isValidPage(stored)) {
      return stored;
    }
    if (stored) {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors and fall back to default.
  }

  return DEFAULT_PAGE;
}

export function persistPage(page: Page): void {
  try {
    localStorage.setItem(STORAGE_KEY, page);
  } catch {
    // Ignore storage access errors.
  }
}
