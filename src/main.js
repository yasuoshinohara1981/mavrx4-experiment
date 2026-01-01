/**
 * Three.js MAVRX4 Experiment
 * WebGPU専用システム（Scene01 = MLS-MPM）+ HUD/OSC統合
 */

import * as THREE from "three/webgpu";
import { OSCManager } from './systems/OSCManager.js';
import { SceneManager } from './systems/SceneManager.js';

// ============================================
// 初期化
// ============================================

let renderer, camera, scene;
let sceneManager;
let oscManager;
let frameCount = 0;
let lastTime = performance.now();
// NOTE:
// ctrlPressed は keyup が取りこぼされると「押しっぱ」扱いになって
// 以降のキー入力が全部 Ctrl モードとして処理されてしまうことがある（特にMac/Meta）。
// ここでは e.ctrlKey/e.metaKey を信頼して扱う。
let ctrlPressed = false;
// Ctrl+数字でシーン切替した直後に、数字keyupが「トグル」として誤爆するのを防ぐ
let suppressDigitToggleUntilMs = 0;

// ============================================
// レンダラーの初期化
// ============================================

const createRenderer = () => {
    if (!navigator.gpu) {
        error("Your device does not support WebGPU.");
        return null;
    }

    const renderer = new THREE.WebGPURenderer({
        //forceWebGL: true,
        //antialias: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return renderer;
};

const error = (msg) => {
    console.error(msg);
    const errorDiv = document.createElement('div');
    errorDiv.style.position = 'absolute';
    errorDiv.style.left = '50%';
    errorDiv.style.top = '50%';
    errorDiv.style.transform = 'translate(-50%, -50%)';
    errorDiv.style.color = '#FFFFFF';
    errorDiv.style.fontSize = '24px';
    errorDiv.style.zIndex = '10000';
    errorDiv.textContent = "Error: " + msg;
    document.body.appendChild(errorDiv);
};

// ============================================
// カメラの初期化
// ============================================

function initCamera() {
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.01,
        5
    );
    // Scene01(MLS-MPM)のスケールに合わせた初期位置（far=5の範囲内）
    camera.position.set(0, 0.5, -1.0);
    camera.lookAt(0, 0.5, 0.0);
}

// ============================================
// OSC管理の初期化
// ============================================

function initOSC() {
    oscManager = new OSCManager({
        wsUrl: 'ws://localhost:8080',
        onMessage: (message) => {
            if (sceneManager) {
                sceneManager.handleOSC(message);
            }
        },
        onStatusChange: (status) => {
            document.getElementById('oscStatus').textContent = status;
            if (sceneManager) {
                const currentScene = sceneManager.getCurrentScene();
                if (currentScene) {
                    currentScene.setOSCStatus(status);
                }
            }
        }
    });
}

// ============================================
// シーンマネージャーの初期化
// ============================================

function initSceneManager() {
    sceneManager = new SceneManager(renderer, camera, null);
    
    sceneManager.onSceneChange = (sceneName) => {
        document.getElementById('sceneName').textContent = sceneName;
    };
    
    // プリロード進捗表示（オプション）
    sceneManager.onPreloadProgress = (current, total, sceneName) => {
        console.log(`プリロード進捗: ${current}/${total} - ${sceneName}`);
        // 必要に応じてUIに表示
        // const progressEl = document.getElementById('preload-progress');
        // if (progressEl) {
        //     progressEl.textContent = `プリロード中: ${current}/${total} - ${sceneName}`;
        // }
    };
}


// ============================================
// アニメーションループ
// ============================================

const updateLoadingProgressBar = async (frac, delay = 0) => {
    return new Promise(resolve => {
        // プログレスバーがあれば更新（index.htmlのHTML要素）
        const progress = document.getElementById("progress");
        if (progress) {
            progress.style.width = `${frac * 200}px`;
        }
        if (delay === 0) {
            resolve();
        } else {
            setTimeout(resolve, delay);
        }
    });
};

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const deltaTime = (now - lastTime) / 1000.0;
    lastTime = now;
    frameCount++;

    // FPS計算
    if (frameCount % 60 === 0) {
        const fps = Math.round(1.0 / deltaTime);
        document.getElementById('fps').textContent = fps;
    }

    // シーンの更新
    if (sceneManager) {
        sceneManager.update(deltaTime);
        sceneManager.render();
    }
}

// ============================================
// リサイズ処理
// ============================================

function onWindowResize() {
    if (camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }
    if (renderer) {
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
    if (sceneManager) {
        sceneManager.onResize();
    }
}

// ============================================
// キーボード入力処理
// ============================================

async function handleKeyDown(e) {
    // Ctrlキーの状態を確認
    if (e.key === 'Control' || e.key === 'Meta') {
        ctrlPressed = true;
        return;
    }
    
    const isCtrlPressed = e.ctrlKey || e.metaKey;
    // keyup取りこぼし対策：実際の修飾キー状態で同期
    ctrlPressed = isCtrlPressed;
    
    if (!sceneManager) return;
    
    const currentScene = sceneManager.getCurrentScene();
    if (!currentScene) return;
    
    // Ctrl + 数字キーでシーン切り替え
    if (isCtrlPressed) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) {
            e.preventDefault();
            // keyupの離し順（Ctrl先に離す等）でトグルが走らないようにする
            suppressDigitToggleUntilMs = performance.now() + 300;
            // WebGPU専用構成
            // switchSceneをawaitで待つ（プリロード完了まで待機）
            try {
                if (num === 1) {
                    await sceneManager.switchScene(0); // Scene01（デフォルト）
                } else if (num === 2) {
                    await sceneManager.switchScene(1); // Scene02
                } else if (num === 3) {
                    await sceneManager.switchScene(2); // Scene03
                } else if (num === 4) {
                    await sceneManager.switchScene(3); // Scene04
                } else {
                    // シーン4以降は今後追加
                    console.log(`シーン${num}はまだ実装されていません`);
                }
            } catch (err) {
                console.error('シーン切り替えエラー:', err);
            }
            return;
        } else if (e.key === '0') {
            e.preventDefault();
            // '0'は未使用（将来の拡張用）
            return;
        }
        // Ctrl押下中は他の処理をスキップ
        return;
    }
    
    // h/HキーでHUDのオンオフ
    if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        sceneManager.globalShowHUD = !sceneManager.globalShowHUD;
        if (currentScene) {
            currentScene.showHUD = sceneManager.globalShowHUD;
            if (currentScene.hud) {
                currentScene.hud.showHUD = sceneManager.globalShowHUD;
                if (!sceneManager.globalShowHUD && currentScene.hud.clear) {
                    currentScene.hud.clear();
                }
            }
        }
        return;
    }

    // 数字キーはkeyupでトグルする（keydown/keyup両方でトグルすると2回反転してしまう）
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= 9) {
        e.preventDefault();
        return;
    }

    // c/C: カメラデバッグ表示ON/OFF / カメラ切り替え
    if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        if (currentScene.handleKeyPress) {
            currentScene.handleKeyPress(e.key);
        }
        return;
    }

    // g/G: HUDグリッド（床+縦グリッド+ルーラー）ON/OFF
    if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        if (currentScene.handleKeyPress) {
            currentScene.handleKeyPress(e.key);
        }
        return;
    }

    // p/P: パーティクル表示ON/OFF（床のズレ確認用）
    if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (currentScene.handleKeyPress) {
            currentScene.handleKeyPress(e.key);
        }
        return;
    }

    // f/F: fill（塗り）表示ON/OFF（Scene側で扱う）
    if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (currentScene.handleKeyPress) {
            currentScene.handleKeyPress(e.key);
        }
        return;
    }
    
    // s/Sキーでスクリーンショット（正方形）
    if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (currentScene.takeScreenshot) {
            currentScene.takeScreenshot(false);  // false = 正方形
        }
        return;
    }
    
    // y/Yキーでスクリーンショット（16:9）
    if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        if (currentScene.takeScreenshot) {
            currentScene.takeScreenshot(true);  // true = 16:9
        }
        return;
    }

    // その他のキーは currentScene に転送（Scene側で自由に拡張できるようにする）
    // NOTE: ここが無いと u/m などが一切届かない
    if (currentScene.handleKeyPress) {
        currentScene.handleKeyPress(e.key);
    }
}

function handleKeyUp(e) {
    // Ctrlキーの状態をリセット
    if (e.key === 'Control' || e.key === 'Meta') {
        ctrlPressed = false;
        return;
    }
    
    if (!e.ctrlKey && !e.metaKey) {
        ctrlPressed = false;
    }
    
    if (!sceneManager) return;
    
    const currentScene = sceneManager.getCurrentScene();
    if (!currentScene) return;

    // r/R: リセット
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (currentScene.reset) {
            currentScene.reset();
        }
        return;
    }
    
    // 数字キー1〜9はキーアップでトグル（スイッチ式）
    // NOTE: Ctrl+数字は「シーン切替」なので、ここでトグルしない（誤ってOFFになる問題の対策）
    // - 離し順（Ctrl→数字）でも誤爆しないように、シーン切替直後は一定時間スキップする
    if (e.ctrlKey || e.metaKey || ctrlPressed) return;
    if (performance.now() < suppressDigitToggleUntilMs) return;
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= 9) {
        e.preventDefault();
        if (currentScene && currentScene.toggleEffect) {
            currentScene.toggleEffect(num);
        }
        return;
    }
}

// ============================================
// 初期化と起動
// ============================================

async function init() {
    // レンダラーの初期化
    renderer = createRenderer();
    if (!renderer) {
        return;
    }

    await renderer.init();

    if (!renderer.backend.isWebGPUBackend) {
        error("Couldn't initialize WebGPU. Make sure WebGPU is supported by your Browser!");
        return;
    }

    // レンダラーをDOMに追加
    const container = document.getElementById("container") || document.body;
    container.appendChild(renderer.domElement);
    // マウスカーソルを非表示
    renderer.domElement.style.cursor = 'none';

    // カメラの初期化
    initCamera();

    // OSCの初期化
    initOSC();

    // シーンマネージャーを初期化
    initSceneManager();

    // プログレスバーを非表示
    const veil = document.getElementById("veil");
    if (veil) {
        veil.style.opacity = 0;
    }
    const progressBar = document.getElementById("progress-bar");
    if (progressBar) {
        progressBar.style.opacity = 0;
    }

    // イベントリスナー
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // リサイズを一度実行
    onWindowResize();

    // アニメーション開始
    animate();

    console.log('Three.js MAVRX4 Experiment 起動完了');
}

// DOM読み込み後に初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
