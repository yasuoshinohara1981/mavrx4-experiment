/**
 * SceneTemplate（WebGPU）
 *
 * 新しいシーンを追加するときは、基本的にこのクラスを継承して作る。
 * - HUD / スクリーンショット文字
 * - HDRI環境の適用
 * - PostFX（invert/chroma/glitch + bloom + overlay合成）
 * - OrbitControls（ライブ用途でデフォ無効）
 *
 * 使い方（最小）:
 * - `src/scenes/sceneXX/SceneXX.js` を作る
 * - `export class SceneXX extends SceneTemplate { ... }`
 * - `constructor()` で `this.title` と `this.trackEffects` だけ決める
 * - シーン固有の更新は `onUpdate()`、OSCトラック処理は `handleTrackNumber()` を上書き
 */

import { SceneBase } from './SceneBase.js';
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import hdri from '../assets/autumn_field_puresky_1k.hdr';
import { conf } from '../common/conf.js';
import { loadHdrCached } from '../lib/hdrCache.js';

export class SceneTemplate extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.sharedResourceManager = sharedResourceManager;

        // ここは子クラス側で上書きする想定
        this.title = 'SceneTemplate';
        this.trackEffects = {
            1: true,
            2: true,  // invert
            3: true,  // chroma
            4: true,  // glitch
            5: true,  // scene specific
            6: false,
            7: false,
            8: false,
            9: false,
        };
    }

    /**
     * 共通セットアップ
     * - 子クラスが上書きする場合は `await super.setup()` を最初に呼ぶこと
     */
    async setup() {
        await super.setup();

        // スクリーンショット用テキスト
        this.setScreenshotText(this.title);

        // カメラ（子クラスで変えたい場合は上書きOK）
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
        this.camera.position.set(0, 0.0, 2.0);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();

        // シーン（FX対象 + overlay合成）
        this.scene = new THREE.Scene();
        this.overlayScene = new THREE.Scene();
        this.overlayScene.background = null;

        // ライブ用途：マウス操作は基本OFF（必要なら子クラスでONに）
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, 0, 0);
        this.controls.enableDamping = true;
        this.controls.enablePan = false;
        this.controls.maxDistance = 5.0;
        this.controls.minDistance = 0.5;
        this.controls.enabled = false;

        // HDRI（共通）
        const hdriTexture = await loadHdrCached(hdri);
        this.applyHdriEnvironment(hdriTexture);

        // shadowMap は各シーンで個別に設定する（SceneTemplateでは設定しない）
        // 子クラスのsetup()で this._shadowMapEnabled と this._shadowMapType を設定すること

        // PostFX（共通）
        this.initPostFX();
    }

    /**
     * SceneManager から呼ばれる：リソースの有効/無効（ライブ用途：disposeはしない）
     */
    setResourceActive(active) {
        this._resourceActive = !!active;
    }

    /**
     * update() は SceneBase が呼ぶ（this.time更新など）
     * 子クラスは onUpdate() を上書きしてシーン固有ロジックを書く
     */
    onUpdate(deltaTime) {
        // PostFX（track2-4 + duration）を共通で更新
        this.updatePostFX();

        // controls を使う場合だけ update
        if (this.controls && this.controls.enabled) {
            this.controls.update();
        }
    }

    /**
     * render() は SceneManager が fire-and-forget で呼ぶ
     */
    async render() {
        if (!this.postProcessing) return;

        // 初回レンダリング時の計測（デバッグ用）
        const isFirstRender = !this._hasRendered;
        if (isFirstRender) {
            this._hasRendered = true;
            const renderStart = performance.now();
            try {
                await this.postProcessing.renderAsync();
            } catch (err) {
                // WebGPU のノード管理エラーを無視（レンダリングは継続）
                console.warn(`${this.title || 'Scene'} 初回renderエラー（無視）:`, err);
            }
            const renderTime = performance.now() - renderStart;
            if (renderTime > 10) {
                console.log(`${this.title || 'Scene'} 初回postProcessing.renderAsync: ${renderTime.toFixed(2)}ms`);
            }
        } else {
            try {
                await this.postProcessing.renderAsync();
            } catch (err) {
                // WebGPU のノード管理エラーをログに出力して確認
                console.error(`${this.title || 'Scene'} renderエラー:`, err);
                // エラーが発生してもHUDは表示する
            }
        }

        // HUD（最小）
        if (this.hud && this.showHUD) {
            const now = performance.now();
            const frameRate = this.lastFrameTime ? 1.0 / ((now - this.lastFrameTime) / 1000.0) : 60.0;
            this.lastFrameTime = now;

            const isInverted = this.fxUniforms?.invert ? (this.fxUniforms.invert.value > 0.0) : false;
            const camPos = this.camera?.position?.clone ? this.camera.position.clone() : new THREE.Vector3();
            const debugText = (typeof this.getHUDDebugText === 'function') ? (this.getHUDDebugText() || '') : '';

            this.hud.display(
                frameRate,
                0,
                camPos,
                0,
                this.time,
                0,
                0,
                0,
                0,
                isInverted,
                this.oscStatus,
                0,
                this.trackEffects,
                this.phase,
                {
                    distToTarget: camPos.length(),
                    fovDeg: this.camera?.fov ?? 60,
                    cameraY: camPos.y
                },
                null,
                this.currentBar || 0,
                debugText,
                this.actualTick || 0
            );
        }

        // スクリーンショット用のテキスト描画
        this.drawScreenshotText();
    }

    /**
     * HUD右下のデバッグテキスト用（Scene側でオーバーライド）
     */
    getHUDDebugText() {
        return '';
    }

    /**
     * OSC: trackEffects ON/OFF のチェックは SceneBase.handleOSC() 側で行われる
     * ここでは「トラック番号ごとの処理」を書く（子クラスで上書き可）
     */
    handleTrackNumber(trackNumber, message) {
        const args = message?.args || [];
        const velocity = Number(args[1] ?? 127);
        const durationMs = Number(args[2] ?? 0);

        // track1: カメラランダマイズ（CameraParticleがあるSceneだけ効く）
        if (trackNumber === 1) {
            this.applyTrack1CameraImpulse(velocity, durationMs);
            return;
        }

        // track2-4 は全シーン共通のPostFXとして扱う
        if (trackNumber === 2) {
            if (!this.trackEffects[2]) return;
            const dur = durationMs > 0 ? durationMs : 150;
            this.setInvert(true, dur);
            return;
        }
        if (trackNumber === 3) {
            if (!this.trackEffects[3]) return;
            const amount = Math.min(Math.max(velocity / 127, 0), 1) * 1.0;
            const dur = durationMs > 0 ? durationMs : 150;
            this.setChromatic(amount, dur);
            return;
        }
        if (trackNumber === 4) {
            if (!this.trackEffects[4]) return;
            const amount = Math.min(Math.max(velocity / 127, 0), 1) * 0.7;
            const dur = durationMs > 0 ? durationMs : 150;
            this.setGlitch(amount, dur);
            return;
        }

        // track5以降は子クラス側で自由に
    }

    reset() {
        super.reset();
        // PostFXを確実にOFF
        this.setInvert(false, 0);
        this.setChromatic(0.0, 0);
        this.setGlitch(0.0, 0);
    }

    dispose() {
        if (this.postProcessing) {
            try {
                this.postProcessing.dispose();
            } catch (e) {
                // WebGPU のノード管理エラーを無視
            }
        }
        super.dispose();
    }
}


