/**
 * DebugLogger: デバッグログ管理クラス
 * カテゴリごとにログのON/OFFを制御できる
 * 
 * 使い方:
 *   import { debugLog, setDebugCategory } from './lib/DebugLogger.js';
 *   
 *   // ログ出力（カテゴリを指定）
 *   debugLog('scene10', 'メッセージ');
 *   debugLog('osc', 'OSCメッセージ', data);
 *   
 *   // カテゴリのON/OFF
 *   setDebugCategory('scene10', true);  // ON
 *   setDebugCategory('osc', false);     // OFF
 *   
 *   // 全カテゴリON/OFF
 *   setAllDebugCategories(false);       // 全部OFF
 */

// デバッグカテゴリの定義と初期状態
const debugCategories = {
    // === 常にOFF（必要な時だけONにする） ===
    osc: false,              // OSCメッセージ受信
    oscDetail: false,        // OSC詳細（トラック番号など）
    camera: false,           // カメラ切り替え
    particle: false,         // パーティクルシステム
    shader: false,           // シェーダー読み込み
    texture: false,          // テクスチャ更新
    hud: false,              // HUD描画
    effect: false,           // エフェクト（色収差、グリッチなど）
    track: false,            // トラック処理
    
    // === 調査用（必要に応じてON） ===
    colorInversion: true,    // 色反転デバッグ（現在調査中）
    laserScan: false,        // レーザースキャン
    
    // === シーン固有（WebGPU専用構成） ===
    scene01: false,
    
    // === システム ===
    init: false,             // 初期化ログ
    sceneManager: false,     // シーンマネージャー
    
    // === 重要（常にON推奨） ===
    error: true,             // エラー
    warn: true,              // 警告
};

/**
 * デバッグログを出力
 * @param {string} category - カテゴリ名
 * @param  {...any} args - ログメッセージ
 */
export function debugLog(category, ...args) {
    if (debugCategories[category]) {
        console.log(`[${category}]`, ...args);
    }
}

/**
 * デバッグ警告を出力
 * @param {string} category - カテゴリ名
 * @param  {...any} args - 警告メッセージ
 */
export function debugWarn(category, ...args) {
    if (debugCategories[category] || debugCategories.warn) {
        console.warn(`[${category}]`, ...args);
    }
}

/**
 * デバッグエラーを出力
 * @param {string} category - カテゴリ名
 * @param  {...any} args - エラーメッセージ
 */
export function debugError(category, ...args) {
    if (debugCategories[category] || debugCategories.error) {
        console.error(`[${category}]`, ...args);
    }
}

/**
 * カテゴリのON/OFFを設定
 * @param {string} category - カテゴリ名
 * @param {boolean} enabled - ON/OFF
 */
export function setDebugCategory(category, enabled) {
    if (category in debugCategories) {
        debugCategories[category] = enabled;
        console.log(`[DebugLogger] ${category} = ${enabled ? 'ON' : 'OFF'}`);
    } else {
        console.warn(`[DebugLogger] Unknown category: ${category}`);
    }
}

/**
 * 全カテゴリのON/OFFを設定
 * @param {boolean} enabled - ON/OFF
 */
export function setAllDebugCategories(enabled) {
    for (const category in debugCategories) {
        debugCategories[category] = enabled;
    }
    console.log(`[DebugLogger] All categories = ${enabled ? 'ON' : 'OFF'}`);
}

/**
 * 現在のカテゴリ設定を取得
 * @returns {object} カテゴリ設定
 */
export function getDebugCategories() {
    return { ...debugCategories };
}

/**
 * カテゴリが有効かどうか
 * @param {string} category - カテゴリ名
 * @returns {boolean} 有効かどうか
 */
export function isDebugEnabled(category) {
    return debugCategories[category] || false;
}

// グローバルに公開（ブラウザコンソールから操作可能）
if (typeof window !== 'undefined') {
    window.debugLog = debugLog;
    window.setDebugCategory = setDebugCategory;
    window.setAllDebugCategories = setAllDebugCategories;
    window.getDebugCategories = getDebugCategories;
}

export default {
    debugLog,
    debugWarn,
    debugError,
    setDebugCategory,
    setAllDebugCategories,
    getDebugCategories,
    isDebugEnabled
};
