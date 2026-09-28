const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const desktop = path.resolve(__dirname, 'desktop');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // The desktop app (Tauri, with its own node_modules and Rust build) isn't bundled.
  resolver: { blockList: [new RegExp(`^${escape(desktop)}[\\\\/].*`)] },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
