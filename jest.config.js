module.exports = {
  preset: '@react-native/jest-preset',
  // The desktop app (Tauri) has its own setup.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/desktop/'],
  modulePathIgnorePatterns: ['<rootDir>/desktop/'],
};
