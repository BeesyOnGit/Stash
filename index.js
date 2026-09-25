/**
 * @format
 */

import './src/polyfills';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { startBubbleBridge } from './src/bubble/BubbleBridge';
import { startCarBridge } from './src/car/CarBridge';
import { syncLayoutDirection } from './src/i18n';
import { getSettings } from './src/services/settings';

// Reads the Language setting; Arabic lays the app out right to left.
getSettings();
syncLayoutDirection();

AppRegistry.registerComponent(appName, () => App);
// Android Auto; runs even when the car starts the app without a screen.
startCarBridge();
// Android floating bubble (Settings → Listening).
startBubbleBridge();
