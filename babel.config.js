module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // youtubei.js uses `export * as X from '…'`, which the RN preset doesn't transform.
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};
