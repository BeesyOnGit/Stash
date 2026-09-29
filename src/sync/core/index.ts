/**
 * Phone ↔ computer sync, the part both apps share: stamps, merge rules,
 * protocol and the SQL on the library database. No platform imports.
 *
 * SHARED FOLDER: the canonical copy is src/sync/core (phone app); the
 * computer app has a byte-identical copy in desktop/src/core/sync/core.
 * Edit here, then copy it over (__tests__/sync.test.ts fails if they differ).
 */
export * from './hlc';
export * from './merge';
export * from './model';
export * from './protocol';
export * from './store';
