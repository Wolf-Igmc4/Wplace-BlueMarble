// ==UserScript==
// @name            Blue Marble X
// @name:en         Blue Marble X
// @namespace       https://github.com/Wolf-Igmc4/
// @version         0.92.23
// @description     A userscript to enhance the user experience on Wplace.live. This includes, but is not limited to: uploading images to display locally on a canvas, adding a button to move the Wplace color palette menu, and other QoL features.
// @description:en  A userscript to enhance the user experience on Wplace.live. This includes, but is not limited to: uploading images to display locally on a canvas, adding a button to move the Wplace color palette menu, and other QoL features.
// @author          SwingTheVine
// @license         MPL-2.0
// @supportURL      https://github.com/Wolf-Igmc4/Wplace-BlueMarble/issues
// @homepageURL     https://github.com/Wolf-Igmc4/Wplace-BlueMarble
// @icon            https://raw.githubusercontent.com/Wolf-Igmc4/Wplace-BlueMarble/main/dist/assets/Favicon.png
// @updateURL       https://raw.githubusercontent.com/Wolf-Igmc4/Wplace-BlueMarble/main/dist/BlueMarble.user.js
// @downloadURL     https://raw.githubusercontent.com/Wolf-Igmc4/Wplace-BlueMarble/main/dist/BlueMarble.user.js
// @match           https://wplace.live/*
// @grant           GM_getResourceText
// @grant           GM_addStyle
// @grant           GM.setValue
// @grant           GM_getValue
// @grant           GM_deleteValue
// @grant           GM_xmlhttpRequest
// @grant           GM.download
// @connect         telemetry.thebluecorner.net
// @connect         raw.githubusercontent.com
// @connect         backend.wplace.live
// @resource        CSS-BM-File https://raw.githubusercontent.com/Wolf-Igmc4/Wplace-BlueMarble/main/dist/BlueMarble.user.css?v=0.92.23
// @antifeature     tracking Anonymous opt-in telemetry data
// @noframes
// ==/UserScript==

// Wplace  --> https://wplace.live
// License --> https://www.mozilla.org/en-US/MPL/2.0/
// Donate  --> https://ko-fi.com/swingthevine

/*!
  This script is not affiliated with Wplace.live in any way, use at your own risk.
  This script is not affiliated with any userscript manager.
  The author of this userscript is not responsible for any damages, issues, loss of data, or punishment that may occur as a result of using this script.
  This script is provided "as is" under the MPL-2.0 license.
  The "Blue Marble" icon is licensed under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication.
  The "Blue Marble" image is owned by NASA.
*/

