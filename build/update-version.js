/** Updates the version number in the metadata.
 * This updates the version number in the metadata to the version specified in package.json.
 * @since 0.0.6
*/

import fs from 'fs';
import { consoleStyle } from './utils.js';

console.log(`${consoleStyle.BLUE}Starting update-version...${consoleStyle.RESET}`);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = pkg.version;

let meta = fs.readFileSync('src/BlueMarble.meta.js', 'utf-8');
meta = meta.replace(/@version\s+[\d.]+/, `@version         ${version}`);
meta = meta.replace(
  /@resource\s+CSS-BM-File\s+https:\/\/raw\.githubusercontent\.com\/Wolf-Igmc4\/Wplace-BlueMarble\/main\/dist\/BlueMarble\.user\.css(?:\?v=[^\s]+)?/,
  `@resource        CSS-BM-File https://raw.githubusercontent.com/Wolf-Igmc4/Wplace-BlueMarble/main/dist/BlueMarble.user.css?v=${version}`
);

fs.writeFileSync('src/BlueMarble.meta.js', meta);
console.log(`${consoleStyle.GREEN}Updated${consoleStyle.RESET} userscript version and CSS resource to ${consoleStyle.MAGENTA}${version}${consoleStyle.RESET}`);
