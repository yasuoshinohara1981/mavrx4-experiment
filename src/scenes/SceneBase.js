/**
 * シーンの基底クラス（WebGPU版）
 * すべてのシーンはこのクラスを継承
 */

import * as THREE from "three/webgpu";
import { HUD } from '../lib/HUD.js';
import { conf } from '../common/conf.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import {
    float,
    Fn,
    mrt,
    output,
    pass,
    vec2,
    vec3,
    vec4,
    uv,
    length,
    normalize,
    dot,
    sin,
    fract,
    floor,
    step,
    mix,
    time,
    uniform
} from "three/tsl";

export class SceneBase {
    constructor(renderer, camera) {
        this.renderer = renderer;
        this.camera = camera;
        this.scene = null;
        this.title = 'Base Scene';
        this.overlayScene = null;
        
        // HUD
        this.hud = null;
        this.showHUD = true;
        this.lastFrameTime = null;
        this.oscStatus = 'Unknown';
        this.phase = 0;
        // Max側の“時間”入力（再生開始からの累積tick）
        // - 96 tick = 1拍
        // - 96 tick * 4拍 = 1小節
        this.actualTick = 0;
        this.particleCount = 0;
        this.time = 0.0;
        
        // エフェクト状態管理（トラック1-9のオン/オフ）
        this.trackEffects = {
            1: true,  // カメラ切り替え
            2: true,  // 色反転
            3: true,  // 色収差
            4: false,  // グリッチ
            5: true,   // シーン固有のエフェクト
            6: false,
            7: false,
            8: false,
            9: false
        };
        
        // スクリーンショット用テキスト
        this.screenshotText = '';
        this.showScreenshotText = false;
        this.pendingScreenshot = false;
        this.screenshotTextEndTime = 0;
        this.screenshotTextX = 0;
        this.screenshotTextY = 0;
        this.screenshotTextSize = 48;
        this.pendingScreenshotFilename = '';
        this.screenshotCanvas = null;
        this.screenshotCtx = null;
        this.screenshotExecuting = false;  // スクリーンショット実行中フラグ
        this.backgroundWhite = false;  // 背景が白かどうか（テキスト色の判定用）

        // ===== カメラパーティクルのデバッグ表示（mavrx4互換・共通化）=====
        this.SHOW_CAMERA_DEBUG = false;          // c/Cでトグル
        this.SHOW_CAMERA_DEBUG_CIRCLES = false;  // 予備（必要なら後でキー追加）
        this.SHOW_AXES = false;
        this.cameraCenter = new THREE.Vector3(0, 0, 0);
        this.cameraParticles = [];
        this.currentCameraIndex = 0;

        this.cameraDebugGroup = null;
        this.cameraDebugSpheres = [];
        this.cameraDebugLines = [];
        this.cameraDebugCircles = [];
        this.cameraDebugCanvas = null;
        this.cameraDebugCtx = null;
        this.cameraDebugTextPositions = [];
        this.axesHelper = null;
        
        this.init();
    }
    
    init() {
        // シーンを作成
        this.scene = new THREE.Scene();
        
        // HUDを初期化（SceneBaseはHUDのみ共通化する）
        this.initializeHUD();
    }

    /**
     * カメラデバッグ表示の初期化（各Sceneのsetup後に呼ぶ）
     * - overlayScene がある場合はそこに描画（FX対象外/上に出す用途）
     */
    initCameraDebug(targetScene = null) {
        const hostScene = targetScene || this.overlayScene || this.scene;
        if (!hostScene) {
            console.warn('SceneBase.initCameraDebug: hostScene is null', {
                targetScene,
                overlayScene: this.overlayScene,
                scene: this.scene
            });
            return;
        }
        if (!this.cameraParticles || this.cameraParticles.length === 0) {
            console.warn('SceneBase.initCameraDebug: cameraParticles is empty', {
                cameraParticles: this.cameraParticles,
                length: this.cameraParticles?.length
            });
            return;
        }

        // group
        if (!this.cameraDebugGroup) {
            this.cameraDebugGroup = new THREE.Group();
            hostScene.add(this.cameraDebugGroup);
        } else if (this.cameraDebugGroup.parent !== hostScene) {
            try { this.cameraDebugGroup.parent?.remove(this.cameraDebugGroup); } catch (_) {}
            hostScene.add(this.cameraDebugGroup);
        }
        this.cameraDebugGroup.visible = !!this.SHOW_CAMERA_DEBUG;
        
        // デバッグ: hostSceneが正しく設定されているか確認
        if (this.cameraDebugGroup.parent !== hostScene) {
            console.warn('SceneBase.initCameraDebug: cameraDebugGroup parent mismatch', {
                expected: hostScene.constructor?.name || 'unknown',
                actual: this.cameraDebugGroup.parent?.constructor?.name || 'null',
                targetScene: targetScene?.constructor?.name || 'null',
                overlayScene: this.overlayScene?.constructor?.name || 'null',
                scene: this.scene?.constructor?.name || 'null'
            });
        }

        // canvas（テキストラベル用）
        // NOTE:
        // - 起動時に全シーンがinitされると Canvas がシーン数分ぶら下がってしまう
        // - ここでは c キーで有効化された時だけ生成する（3Dの線/球はCanvas無しでもOK）
        if (this.SHOW_CAMERA_DEBUG) {
            this._ensureCameraDebugCanvas();
        }

        // axes
        if (!this.axesHelper) {
            // Scene01/02のスケール感に合わせて短め
            this.axesHelper = new THREE.AxesHelper(0.9);
            this.axesHelper.visible = false;
            hostScene.add(this.axesHelper);
        } else if (this.axesHelper.parent !== hostScene) {
            try { this.axesHelper.parent?.remove(this.axesHelper); } catch (_) {}
            hostScene.add(this.axesHelper);
        }

        // 子クラスが独自のinitCameraDebugObjectsを持っている場合はそれを使う
        if (typeof this.initCameraDebugObjects === 'function') {
            this.initCameraDebugObjects();
        } else {
            this._rebuildCameraDebugObjects();
        }
    }

    getCameraDebugConfig() {
        // Sphereがデカい問題が出やすいので小さめデフォルト
        return {
            sphereSize: 0.018,
            circleRadius: 0.06,
            circleSegments: 28
        };
    }

    _rebuildCameraDebugObjects() {
        if (!this.cameraDebugGroup) return;
        const n = this.cameraParticles?.length || 0;
        if (n <= 0) return;

        // 既存を破棄（数が変わった/初期化し直したいケース用）
        this.cameraDebugGroup.clear();
        this.cameraDebugSpheres = [];
        this.cameraDebugLines = [];
        this.cameraDebugCircles = [];
        this.cameraDebugTextPositions = [];

        const conf = this.getCameraDebugConfig();
        const sphereSize = conf.sphereSize ?? 0.012;
        const circleRadius = conf.circleRadius ?? 0.045;
        const circleSegments = conf.circleSegments ?? 28;

        for (let i = 0; i < n; i++) {
            const sphereGeometry = new THREE.SphereGeometry(sphereSize, 20, 20);
            // NOTE: overlaySceneにライトが無いケースでも見えるよう MeshBasicMaterial にする
            const sphereMaterial = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: false,
                opacity: 1.0
            });
            const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
            sphere.visible = false;
            this.cameraDebugGroup.add(sphere);
            this.cameraDebugSpheres.push(sphere);

            const ringGeom = new THREE.RingGeometry(circleRadius * 0.94, circleRadius, circleSegments);
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 1.0,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const circleXY = new THREE.Mesh(ringGeom, ringMat);
            circleXY.rotation.x = -Math.PI / 2;
            circleXY.visible = false;
            circleXY.renderOrder = 1000;
            this.cameraDebugGroup.add(circleXY);

            const circleXZ = new THREE.Mesh(ringGeom.clone(), ringMat.clone());
            circleXZ.visible = false;
            circleXZ.renderOrder = 1000;
            this.cameraDebugGroup.add(circleXZ);

            const circleYZ = new THREE.Mesh(ringGeom.clone(), ringMat.clone());
            circleYZ.rotation.y = Math.PI / 2;
            circleYZ.visible = false;
            circleYZ.renderOrder = 1000;
            this.cameraDebugGroup.add(circleYZ);

            this.cameraDebugCircles.push([circleXY, circleXZ, circleYZ]);

            const lineGeometry = new THREE.BufferGeometry();
            const linePositions = new Float32Array(6);
            const linePosAttr = new THREE.BufferAttribute(linePositions, 3);
            lineGeometry.setAttribute('position', linePosAttr);
            const lineMaterial = new THREE.LineBasicMaterial({
                color: 0xff0000,
                transparent: false,
                opacity: 1.0
            });
            const line = new THREE.Line(lineGeometry, lineMaterial);
            line.visible = false;
            line.userData.positionAttr = linePosAttr;
            this.cameraDebugGroup.add(line);
            this.cameraDebugLines.push(line);
        }
    }

    _drawCameraDebug() {
        if (this.cameraDebugCtx && this.cameraDebugCanvas) {
            this.cameraDebugCtx.clearRect(0, 0, this.cameraDebugCanvas.width, this.cameraDebugCanvas.height);
        }
        if (!this.SHOW_CAMERA_DEBUG) return;
        if (!this.cameraDebugGroup) {
            console.warn('SceneBase._drawCameraDebug: cameraDebugGroup is null');
            return;
        }
        if (!this.cameraParticles || this.cameraParticles.length === 0) {
            console.warn('SceneBase._drawCameraDebug: cameraParticles is empty', {
                cameraParticles: this.cameraParticles,
                length: this.cameraParticles?.length
            });
            return;
        }
        // NOTE: projectはVector3側のメソッド。cameraにprojectは無いのでチェックしない。

        this.cameraDebugGroup.visible = true;
        if (this.axesHelper) this.axesHelper.visible = !!this.SHOW_AXES;

        const center = (this.cameraCenter && this.cameraCenter.clone) ? this.cameraCenter.clone() : new THREE.Vector3(0, 0, 0);

        for (let i = 0; i < this.cameraParticles.length; i++) {
            const cp = this.cameraParticles[i];
            if (!cp) continue;
            // getPositionメソッドがある場合はそれを使う、なければpositionプロパティを使う
            let pos;
            if (cp.getPosition && typeof cp.getPosition === 'function') {
                pos = cp.getPosition().clone();
            } else if (cp.position) {
                pos = cp.position.clone();
            } else {
                pos = center.clone();
            }
            pos.add(center);
            
            // NaNチェック
            if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
                console.warn(`SceneBase._drawCameraDebug: NaN detected for camera ${i}`, {
                    cp,
                    getPosition: cp.getPosition ? cp.getPosition() : null,
                    position: cp.position,
                    center
                });
                continue;
            }

            const sphere = this.cameraDebugSpheres[i];
            if (sphere) {
                sphere.position.copy(pos);
                sphere.visible = true;
            } else {
                console.warn(`SceneBase._drawCameraDebug: sphere ${i} is missing`, {
                    spheresLength: this.cameraDebugSpheres?.length,
                    cameraParticlesLength: this.cameraParticles.length
                });
            }

            const circles = this.cameraDebugCircles[i];
            if (circles && Array.isArray(circles)) {
                circles.forEach((c) => {
                    if (!c) return;
                    c.position.copy(pos);
                    c.visible = !!this.SHOW_CAMERA_DEBUG_CIRCLES;
                });
            }

            const line = this.cameraDebugLines[i];
            if (line?.userData?.positionAttr) {
                const attr = line.userData.positionAttr;
                const a = attr.array;
                a[0] = pos.x; a[1] = pos.y; a[2] = pos.z;
                a[3] = center.x; a[4] = center.y; a[5] = center.z;
                attr.needsUpdate = true;
                line.visible = true;
            }

            if (this.cameraDebugCtx && this.cameraDebugCanvas) {
                const v = pos.clone();
                v.project(this.camera);
                const x = (v.x * 0.5 + 0.5) * this.cameraDebugCanvas.width;
                const y = (-v.y * 0.5 + 0.5) * this.cameraDebugCanvas.height;

                if (x >= 0 && x <= this.cameraDebugCanvas.width && y >= 0 && y <= this.cameraDebugCanvas.height && v.z < 1.0 && v.z > -1.0) {
                    if (!this.cameraDebugTextPositions[i]) {
                        this.cameraDebugTextPositions[i] = { x, y };
                    }
                    const prev = this.cameraDebugTextPositions[i];
                    const dx = x - prev.x;
                    const dy = y - prev.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const smoothX = dist < 100 ? (prev.x * 0.3 + x * 0.7) : x;
                    const smoothY = dist < 100 ? (prev.y * 0.3 + y * 0.7) : y;

                    this.cameraDebugCtx.save();
                    this.cameraDebugCtx.fillStyle = 'white';
                    this.cameraDebugCtx.font = '16px monospace';
                    this.cameraDebugCtx.textAlign = 'center';
                    this.cameraDebugCtx.textBaseline = 'bottom';
                    this.cameraDebugCtx.fillText(`camera #${i + 1}`, smoothX, smoothY - 42);
                    this.cameraDebugCtx.restore();

                    this.cameraDebugTextPositions[i] = { x: smoothX, y: smoothY };
                }
            }
        }
    }

    handleKeyPress(key) {
        // 共通キー（mavrx4互換）
        if (key === 'c') {
            this.SHOW_CAMERA_DEBUG = !this.SHOW_CAMERA_DEBUG;
            if (this.SHOW_CAMERA_DEBUG) {
                // ONにした瞬間にCanvas/Groupを確実に用意
                this.initCameraDebug();
            }
            if (this.cameraDebugGroup) this.cameraDebugGroup.visible = !!this.SHOW_CAMERA_DEBUG;
            this.SHOW_AXES = this.SHOW_CAMERA_DEBUG;
            if (this.axesHelper) this.axesHelper.visible = !!this.SHOW_AXES;
            return true;
        }
        if (key === 'C') {
            if (this.cameraParticles?.length) {
                this.currentCameraIndex = (this.currentCameraIndex + 1) % this.cameraParticles.length;
            }
            return true;
        }
        return false;
    }

    _ensureCameraDebugCanvas() {
        if (this.cameraDebugCanvas) return;
        this.cameraDebugCanvas = document.createElement('canvas');
        this.cameraDebugCanvas.width = window.innerWidth;
        this.cameraDebugCanvas.height = window.innerHeight;
        this.cameraDebugCanvas.style.position = 'absolute';
        this.cameraDebugCanvas.style.top = '0';
        this.cameraDebugCanvas.style.left = '0';
        this.cameraDebugCanvas.style.pointerEvents = 'none';
        this.cameraDebugCanvas.style.zIndex = '1000';
        this.cameraDebugCtx = this.cameraDebugCanvas.getContext('2d');
        if (this.cameraDebugCtx) {
            this.cameraDebugCtx.font = '16px monospace';
            this.cameraDebugCtx.textAlign = 'center';
            this.cameraDebugCtx.textBaseline = 'bottom';
        }
        document.body.appendChild(this.cameraDebugCanvas);
    }
    
    /**
     * HUDの初期化（共通処理）
     */
    initializeHUD() {
        // HUDを初期化
        this.hud = new HUD();
        // NOTE:
        // スクリーンショットCanvasは重い＆各SceneごとにDOMが増えるので遅延生成にする。
        // drawScreenshotText() 側で必要になったタイミングで initScreenshotCanvas() される。
    }

    /**
     * 共通：環境（HDRI）を scene / overlayScene に適用
     * - Scene01/02でのコピペをなくし、数値のブレも防ぐ
     */
    applyHdriEnvironment(hdriTexture, {
        envRotationY = -2.15,
        envIntensity = 0.5,
        exposure = 0.66,
        backgroundColor = 0x000000,
        applyToOverlay = true
    } = {}) {
        if (!hdriTexture) return;
        if (this.scene) {
            this.scene.background = (backgroundColor != null) ? new THREE.Color(backgroundColor) : this.scene.background;
            this.scene.environment = hdriTexture;
            this.scene.environmentRotation = new THREE.Euler(0, envRotationY, 0);
            this.scene.environmentIntensity = envIntensity;
        }
        if (applyToOverlay && this.overlayScene) {
            this.overlayScene.background = null;
            this.overlayScene.environment = hdriTexture;
            this.overlayScene.environmentRotation = new THREE.Euler(0, envRotationY, 0);
            this.overlayScene.environmentIntensity = envIntensity;
        }
        if (this.renderer) {
            this.renderer.toneMappingExposure = exposure;
        }
        this.hdriTexture = hdriTexture;
    }

    /**
     * 共通：ポストFX（track2-4） + bloom + overlay合成
     * - Scene01/02で同じノードグラフを組むのを共通化
     */
    initPostFX({ scene = null, overlayScene = null, camera = null } = {}) {
        const baseScene = scene || this.scene;
        const ovScene = overlayScene || this.overlayScene;
        const cam = camera || this.camera;
        if (!baseScene || !ovScene || !cam || !this.renderer) {
            console.warn('SceneBase.initPostFX: Missing required parameters', {
                baseScene: !!baseScene,
                ovScene: !!ovScene,
                cam: !!cam,
                renderer: !!this.renderer,
                scene: !!scene,
                overlayScene: !!overlayScene,
                camera: !!camera,
                thisScene: !!this.scene,
                thisOverlayScene: !!this.overlayScene,
                thisCamera: !!this.camera
            });
            return;
        }

        const scenePass = pass(baseScene, cam);
        // MRT設定：outputとbloomIntensity（emissiveの代わりにカスタム出力を使用）
        scenePass.setMRT(mrt({
            output,
            bloomIntensity: output  // 一時的にoutputと同じにする（後でbloomIntensityを正しく設定する）
        }));
        const outputPass = scenePass.getTextureNode();
        const bloomIntensityPass = scenePass.getTextureNode('bloomIntensity');
        // 深度バッファを取得（DOF用）- 利用可能かどうかをチェック
        let depthPass = null;
        try {
            depthPass = scenePass.getTextureNode('depth');
        } catch (e) {
            // 深度バッファが利用できない場合は null のまま
            depthPass = null;
        }
        // bloomIntensityPassはoutputと同じなので、outputPassを使う
        const bloomPass = conf.bloom ? bloom(outputPass) : null;

        const overlayPass = pass(ovScene, cam);
        const overlayTex = overlayPass.getTextureNode();

        const postProcessing = new THREE.PostProcessing(this.renderer);
        postProcessing.outputColorTransform = false;

        this.fxUniforms = {
            invert: uniform(0.0),
            chromaAmount: uniform(0.0),
            glitchAmount: uniform(0.0),
            // 軽量DOF“っぽい”ブラー（深度無し / コスト低め）
            // NOTE: 本物のDOFではない（遠景ボケの空気感だけ）
            dofAmount: uniform(0.0),
            // CG感を少し抑える“エッジソフト”（超軽量：輝度差でブラーを混ぜる）
            edgeSoft: uniform(0.0),
            // SSAOっぽい“締まり”を出すための超軽量vignette（擬似AO）
            // NOTE: 本物のSSAOではない（深度/法線不要・ほぼコスト0）
            fakeAO: uniform(0.0),
        };
        this.fxEndTimeMs = {
            invert: 0,
            chroma: 0,
            glitch: 0,
        };

        const fxInvert = this.fxUniforms.invert;
        const fxChroma = this.fxUniforms.chromaAmount;
        const fxGlitch = this.fxUniforms.glitchAmount;
        const fxDOF = this.fxUniforms.dofAmount;
        const fxEdgeSoft = this.fxUniforms.edgeSoft;
        const fxFakeAO = this.fxUniforms.fakeAO;

        postProcessing.outputNode = Fn(() => {
            // uv / dist
            const u = uv().toVar();
            const center = vec2(0.5, 0.5).toVar();
            const dv = u.sub(center).toVar();
            const dir = normalize(dv).toVar();
            const dist = length(dv).toVar();

            // base color
            const c0 = outputPass.sample(u).rgb.clamp(0, 1).toVar();

            // 0) 軽量DOF“っぽい”ブラー（画面端ほどぼかす / 深度不要）
            const dof = fxDOF.clamp(0.0, 1.0).toVar();
            // 強すぎたので半径を少し戻す
            const dofOff = dof.mul(0.012).toVar();
            const sx1 = outputPass.sample(u.add(vec2(dofOff, 0.0))).rgb.clamp(0, 1).toVar();
            const sx2 = outputPass.sample(u.sub(vec2(dofOff, 0.0))).rgb.clamp(0, 1).toVar();
            const sy1 = outputPass.sample(u.add(vec2(0.0, dofOff))).rgb.clamp(0, 1).toVar();
            const sy2 = outputPass.sample(u.sub(vec2(0.0, dofOff))).rgb.clamp(0, 1).toVar();
            // 対角も足して、ボケが「十字」っぽくなるのを軽減（+4サンプル）
            const sxy1 = outputPass.sample(u.add(vec2(dofOff, dofOff))).rgb.clamp(0, 1).toVar();
            const sxy2 = outputPass.sample(u.add(vec2(dofOff, dofOff.negate()))).rgb.clamp(0, 1).toVar();
            const sxy3 = outputPass.sample(u.add(vec2(dofOff.negate(), dofOff))).rgb.clamp(0, 1).toVar();
            const sxy4 = outputPass.sample(u.add(vec2(dofOff.negate(), dofOff.negate()))).rgb.clamp(0, 1).toVar();

            const blur = c0.mul(0.26)
                .add(sx1.mul(0.11)).add(sx2.mul(0.11))
                .add(sy1.mul(0.11)).add(sy2.mul(0.11))
                .add(sxy1.mul(0.075)).add(sxy2.mul(0.075))
                .add(sxy3.mul(0.075)).add(sxy4.mul(0.075))
                .clamp(0, 1).toVar();

            // 端寄りから効く（やりすぎない）
            const td = dist.sub(float(0.06)).div(float(0.40)).clamp(0.0, 1.0).toVar();
            const sm = td.mul(td).mul(float(3.0).sub(td.mul(2.0))).toVar();
            const dofMix = sm.mul(dof).clamp(0.0, 1.0).toVar();
            const base = mix(c0, blur, dofMix).toVar();

            // 0.5) エッジソフト（軽量）: 輝度差で“輪郭だけ”少しブラーを混ぜる
            // NOTE: 既に取ったサンプル（sx/sy）を再利用してコストを増やさない
            const lumaW = vec3(0.299, 0.587, 0.114).toVar();
            const lum0 = dot(base, lumaW).toVar();
            const lumX1 = dot(sx1, lumaW).toVar();
            const lumX2 = dot(sx2, lumaW).toVar();
            const lumY1 = dot(sy1, lumaW).toVar();
            const lumY2 = dot(sy2, lumaW).toVar();
            const e = lum0.sub(lumX1).abs()
                .add(lum0.sub(lumX2).abs())
                .add(lum0.sub(lumY1).abs())
                .add(lum0.sub(lumY2).abs())
                .mul(1.8)
                .clamp(0.0, 1.0)
                .toVar();
            const edgeMix = e.mul(fxEdgeSoft.clamp(0.0, 1.0)).clamp(0.0, 1.0).toVar();
            const baseSoft = mix(base, blur, edgeMix).toVar();

            // 2) invert
            const inv = mix(baseSoft, vec3(1).sub(baseSoft), fxInvert).toVar();

            // 3) chromatic aberration
            const off = dir.mul(dist).mul(fxChroma).mul(0.05).toVar();
            const r = outputPass.sample(u.add(off)).r.toVar();
            const g = c0.g.toVar();
            const b0 = outputPass.sample(u.sub(off)).b.toVar();
            const chromaColor = vec3(r, g, b0).clamp(0, 1).toVar();
            // NOTE:
            // 以前は sign() で「0か1」みたいに扱ってたが、Track3のamount(0..1)が効かなくなって
            // “ONにした瞬間おかしい（効きすぎる）”になりやすいので線形でブレンドする。
            const chromaMix = mix(inv, chromaColor, fxChroma.clamp(0.0, 1.0)).toVar();

            // 4) glitch（横スライス＋RGBずらし＋明るさ）
            // DEBUG: timeを固定値にしてブルブル問題を切り分け
            const tt = float(0.0).toVar();  // time.mul(0.1).toVar();

            const rand2 = (st) => {
                return fract(sin(dot(st, vec2(12.9898, 78.233))).mul(43758.5453123));
            };

            const noise2 = (st) => {
                const i = floor(st).toVar();
                const f = fract(st).toVar();
                const a = rand2(i);
                const b = rand2(i.add(vec2(1.0, 0.0)));
                const c = rand2(i.add(vec2(0.0, 1.0)));
                const d0 = rand2(i.add(vec2(1.0, 1.0)));
                const u2 = f.mul(f).mul(vec2(3.0, 3.0).sub(f.mul(2.0))).toVar();
                const x1 = mix(a, b, u2.x).toVar();
                const termC = c.sub(a).mul(u2.y).mul(float(1.0).sub(u2.x)).toVar();
                const termD = d0.sub(b).mul(u2.x).mul(u2.y).toVar();
                return x1.add(termC).add(termD);
            };

            const n = noise2(vec2(u.y.mul(20.0).add(tt.mul(10.0)), tt.mul(5.0))).toVar();
            const gInt = step(float(0.7), n).mul(fxGlitch).toVar();
            const offX = n.sub(0.5).mul(gInt).mul(0.1).toVar();

            const sliceDiv = float(30.0);
            const sliceY = floor(u.y.mul(sliceDiv)).div(sliceDiv).toVar();
            const sn = noise2(vec2(sliceY, tt.mul(3.0))).toVar();
            const sInt = step(float(0.8), sn).mul(fxGlitch).toVar();
            const sOff = sn.sub(0.5).mul(sInt).mul(0.15).toVar();

            const ug = vec2(u.x.add(offX).add(sOff), u.y).toVar();
            const gr = outputPass.sample(ug.add(vec2(offX.mul(0.5), 0))).r.toVar();
            const gg = outputPass.sample(ug).g.toVar();
            const gb = outputPass.sample(ug.sub(vec2(offX.mul(0.5), 0))).b.toVar();
            const bright = float(1).add(n.sub(0.5).mul(gInt).mul(0.3)).toVar();
            const glitchColor = vec3(gr, gg, gb).mul(bright).clamp(0, 1).toVar();

            const mixed = mix(chromaMix, glitchColor, fxGlitch.clamp(0.0, 1.0)).toVar();

            // bloom（OFF時は素通し）
            const outRgb = (conf.bloom && bloomPass)
                ? (() => {
                    // bloomIntensityPassはoutputと同じなので、常に1として扱う（bloomを適用）
                    const bb = bloomPass.rgb.clamp(0, 1);
                    return vec3(1).sub(bb).sub(bb).mul(mixed).mul(mixed).add(bb.mul(mixed).mul(2)).clamp(0, 1).toVar();
                })()
                : mixed;

            // “AOっぽい”締まり：画面端をわずかに落とす（vignette）
            // distは中心からの距離（0..~0.707）。端ほど暗くする。
            const vig = dist.clamp(0.0, 1.0).mul(dist.clamp(0.0, 1.0)).toVar();
            const aoMul = float(1.0).sub(vig.mul(fxFakeAO.clamp(0.0, 1.0)).mul(0.35)).clamp(0.0, 1.0).toVar();
            const aoRgb = outRgb.mul(aoMul).clamp(0, 1).toVar();

            // overlay（alpha合成）
            const overlayA = overlayTex.a.clamp(0, 1).toVar();
            const overlayRgb = overlayTex.rgb.clamp(0, 1).toVar();
            const finalRgb = mix(aoRgb, overlayRgb, overlayA).clamp(0, 1);
            return vec4(finalRgb, 1.0);
        })().renderOutput();

        this.postProcessing = postProcessing;
        this.bloomPass = bloomPass;
        if (this.bloomPass) {
            this.bloomPass.threshold.value = 0.001;
            this.bloomPass.strength.value = 0.94;
            this.bloomPass.radius.value = 0.8;
        }
        
        console.log('SceneBase.initPostFX: PostFX initialized successfully', {
            title: this.title || 'Unknown',
            postProcessing: !!this.postProcessing,
            bloomPass: !!this.bloomPass
        });
    }

    /**
     * 共通：duration付きFXの自動OFF / trackEffects OFF時の強制0
     */
    updatePostFX() {
        if (!this.fxUniforms || !this.fxEndTimeMs) return;

        // トラック4がOFFならグリッチ量を毎フレーム強制0
        if (!this.trackEffects?.[4] && this.fxUniforms?.glitchAmount) {
            this.fxUniforms.glitchAmount.value = 0.0;
            this.fxEndTimeMs.glitch = 0;
        }
        // トラック2がOFFならinvert量を毎フレーム強制0
        if (!this.trackEffects?.[2] && this.fxUniforms?.invert) {
            this.fxUniforms.invert.value = 0.0;
            this.fxEndTimeMs.invert = 0;
        }

        // durationMs付きのエフェクトを自動でOFFにする
        const now = Date.now();
        if (this.fxEndTimeMs.invert > 0 && now >= this.fxEndTimeMs.invert) {
            this.fxUniforms.invert.value = 0.0;
            this.fxEndTimeMs.invert = 0;
        }
        if (this.fxEndTimeMs.chroma > 0 && now >= this.fxEndTimeMs.chroma) {
            this.fxUniforms.chromaAmount.value = 0.0;
            this.fxEndTimeMs.chroma = 0;
        }
        if (this.fxEndTimeMs.glitch > 0 && now >= this.fxEndTimeMs.glitch) {
            this.fxUniforms.glitchAmount.value = 0.0;
            this.fxEndTimeMs.glitch = 0;
        }

        // HUD/スクショ用：背景が白扱いかどうかをinvert状態に同期
        // （黒テキストのまま戻らない、を防ぐ）
        this.backgroundWhite = !!(this.fxUniforms?.invert && this.fxUniforms.invert.value > 0.0);
    }

    setInvert(enabled, durationMs = 0) {
        if (!this.fxUniforms?.invert || !this.fxEndTimeMs) return;
        this.fxUniforms.invert.value = enabled ? 1.0 : 0.0;
        this.fxEndTimeMs.invert = durationMs > 0 ? Date.now() + durationMs : 0;
        this.backgroundWhite = !!enabled;
    }

    setChromatic(amount01, durationMs = 0) {
        if (!this.fxUniforms?.chromaAmount || !this.fxEndTimeMs) return;
        const a = Math.min(Math.max(Number(amount01) || 0, 0), 1);
        this.fxUniforms.chromaAmount.value = a;
        this.fxEndTimeMs.chroma = durationMs > 0 ? Date.now() + durationMs : 0;
    }

    setGlitch(amount01, durationMs = 0) {
        if (!this.fxUniforms?.glitchAmount || !this.fxEndTimeMs) return;
        const a = Math.min(Math.max(Number(amount01) || 0, 0), 1);
        this.fxUniforms.glitchAmount.value = a;
        this.fxEndTimeMs.glitch = durationMs > 0 ? Date.now() + durationMs : 0;
    }
    
    /**
     * スクリーンショット用Canvasを初期化
     */
    initScreenshotCanvas() {
        if (this.screenshotCanvas) return;
        
        this.screenshotCanvas = document.createElement('canvas');
        this.screenshotCanvas.style.position = 'absolute';
        this.screenshotCanvas.style.top = '0';
        this.screenshotCanvas.style.left = '0';
        this.screenshotCanvas.style.pointerEvents = 'none';
        this.screenshotCanvas.style.zIndex = '1000';
        this.screenshotCtx = this.screenshotCanvas.getContext('2d');
        
        // レンダラーの親要素に追加
        if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentElement) {
            this.renderer.domElement.parentElement.appendChild(this.screenshotCanvas);
        }
        
        this.resizeScreenshotCanvas();
    }
    
    /**
     * スクリーンショット用Canvasのサイズを更新
     */
    resizeScreenshotCanvas() {
        if (!this.screenshotCanvas || !this.renderer) return;
        
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        const width = size.width;
        const height = size.height;
        
        this.screenshotCanvas.width = width;
        this.screenshotCanvas.height = height;
        this.screenshotCanvas.style.width = `${width}px`;
        this.screenshotCanvas.style.height = `${height}px`;
    }
    
    /**
     * セットアップ処理（シーン切り替え時に呼ばれる）
     */
    async setup() {
        // サブクラスで実装
    }
    
    /**
     * 更新処理（毎フレーム呼ばれる）
     */
    update(deltaTime) {
        // SceneBaseはロジックを持たず、Scene側のupdateに委譲する
        this.time += deltaTime;
        // 共通：Track1の一時ブースト（maxForce/maxSpeed）の期限切れを戻す
        // - CameraParticleを使うSceneだけに効く（cameraParticlesが無ければ何もしない）
        this.updateTrack1CameraBoosts();
        // サブクラスの更新処理
        this.onUpdate(deltaTime);
        // 共通：カメラデバッグ描画（ONの時だけ）
        if (this.SHOW_CAMERA_DEBUG) {
            // 子クラスが独自のdrawCameraDebugを持っている場合はそれを使う
            if (typeof this.drawCameraDebug === 'function') {
                this.drawCameraDebug();
            } else {
                this._drawCameraDebug();
            }
        } else if (this.cameraDebugCtx && this.cameraDebugCanvas) {
            // OFF時はCanvasだけクリア
            this.cameraDebugCtx.clearRect(0, 0, this.cameraDebugCanvas.width, this.cameraDebugCanvas.height);
        }
    }

    /**
     * Track1: カメラ用CameraParticleに「ランダムな力 + カメラ切替」を与える（共通）
     * - velocity(0..127) で “ブースト量” を決める
     * - durationMs の間だけ maxForce/maxSpeed を底上げして「ちゃんと動く」ようにする
     *
     * Scene側の想定:
     * - this.cameraParticles: CameraParticle[]
     * - this.currentCameraIndex: number
     * - this.switchCameraRandom(): カメラ切替（Scene01/02は実装済み）
     */
    applyTrack1CameraImpulse(velocity = 127, durationMs = 0) {
        if (!this.trackEffects?.[1]) return;
        const cps = this.cameraParticles;
        if (!cps || cps.length === 0) return;

        const v01 = Math.min(Math.max((Number(velocity) || 0) / 127, 0), 1);
        // さらにさらに弱め（“まだ強い”対策）
        // - maxForce: ほぼ上げない（= ランダムforceはmaxForceで強制的に小さくクランプされる）
        // - maxSpeed: ほぼ固定
        // 0.06..0.18
        const forceMul = 0.06 + 0.12 * v01;
        // 1.00..1.04
        const speedMul = 1.00 + 0.04 * v01;
        const now = Date.now();
        // デフォは短め（長いと暴れが残りやすい）
        const holdMs = Math.max(0, Number(durationMs) || 0) > 0 ? Number(durationMs) : 80;

        cps.forEach((cp) => {
            if (!cp) return;
            // baseを初回だけ記録
            if (typeof cp.__track1BaseMaxForce === 'undefined') cp.__track1BaseMaxForce = cp.maxForce;
            if (typeof cp.__track1BaseMaxSpeed === 'undefined') cp.__track1BaseMaxSpeed = cp.maxSpeed;

            // ブーストを設定（期限切れは updateTrack1CameraBoosts() が戻す）
            cp.__track1BoostUntilMs = now + holdMs;
            cp.maxForce = (Number(cp.__track1BaseMaxForce) || cp.maxForce) * forceMul;
            cp.maxSpeed = (Number(cp.__track1BaseMaxSpeed) || cp.maxSpeed) * speedMul;

            // 力をランダム化（方向/回転）
            // NOTE: 強すぎる場合があるので “Weak” を優先
            if (typeof cp.applyRandomForceWeak === 'function') {
                cp.applyRandomForceWeak();
            } else if (typeof cp.applyRandomForce === 'function') {
                cp.applyRandomForce();
            }
        });

        // カメラを切り替える（Scene側に実装があればそれを使う）
        if (typeof this.switchCameraRandom === 'function') {
            this.switchCameraRandom();
        } else {
            // fallback
            if (typeof this.currentCameraIndex !== 'number') this.currentCameraIndex = 0;
            if (cps.length >= 2) {
                let idx = this.currentCameraIndex;
                while (idx === this.currentCameraIndex) {
                    idx = Math.floor(Math.random() * cps.length);
                }
                this.currentCameraIndex = idx;
            }
        }
    }

    /**
     * Track1: 期限切れのブーストを元に戻す（毎フレーム呼ばれる）
     */
    updateTrack1CameraBoosts() {
        const cps = this.cameraParticles;
        if (!cps || cps.length === 0) return;
        const now = Date.now();
        cps.forEach((cp) => {
            if (!cp) return;
            const until = Number(cp.__track1BoostUntilMs || 0);
            if (until > 0 && now >= until) {
                if (typeof cp.__track1BaseMaxForce !== 'undefined') cp.maxForce = cp.__track1BaseMaxForce;
                if (typeof cp.__track1BaseMaxSpeed !== 'undefined') cp.maxSpeed = cp.__track1BaseMaxSpeed;
                cp.__track1BoostUntilMs = 0;
            }
        });
    }
    
    /**
     * サブクラスの更新処理（オーバーライド用）
     */
    onUpdate(deltaTime) {
        // サブクラスで実装
    }
    
    /**
     * 描画処理
     */
    async render() {
        // サブクラスで実装
    }
    
    /**
     * OSCメッセージのハンドリング
     */
    handleOSC(message) {
        // phaseを受け取るための入口（OSC側の仕様が変わってもSceneBaseは受け口だけ提供）
        // - message.phase があれば優先
        // - /phase などのaddressで飛んでくる場合は args[0] を採用
        if (typeof message?.phase !== 'undefined') {
            this.setPhase(message.phase);
        } else if (typeof message?.address === 'string' && message.address.includes('phase')) {
            const v0 = message?.args?.[0];
            if (typeof v0 !== 'undefined') {
                this.setPhase(v0);
            } else {
                // /phase/3 みたいにaddressに値が埋まってるパターンも拾う
                const m = message.address.match(/phase\/(-?\d+)/);
                if (m) this.setPhase(Number(m[1]));
            }
        }
        
        // bar（小節）を受け取る処理（actual_barという名前で渡される）
        if (typeof message?.actual_bar !== 'undefined') {
            this.setBar(message.actual_bar);
        } else if (typeof message?.bar !== 'undefined') {
            this.setBar(message.bar);
        } else if (typeof message?.address === 'string' && message.address.includes('bar')) {
            const v0 = message?.args?.[0];
            if (typeof v0 !== 'undefined') {
                this.setBar(v0);
            } else {
                // /bar/3 みたいにaddressに値が埋まってるパターンも拾う
                const m = message.address.match(/bar\/(-?\d+)/);
                if (m) this.setBar(Number(m[1]));
            }
        }

        // actual_tick（時間）を受け取る処理
        if (typeof message?.actual_tick !== 'undefined') {
            this.setTick(message.actual_tick);
        } else if (typeof message?.tick !== 'undefined') {
            this.setTick(message.tick);
        } else if (typeof message?.address === 'string' && message.address.includes('tick')) {
            const v0 = message?.args?.[0];
            if (typeof v0 !== 'undefined') {
                this.setTick(v0);
            } else {
                // /tick/1234 みたいにaddressに値が埋まってるパターンも拾う
                const m = message.address.match(/tick\/(-?\d+)/);
                if (m) this.setTick(Number(m[1]));
            }
        }

        const trackNumber = message.trackNumber;
        
        // trackEffectsの状態をチェック
        if (trackNumber >= 1 && trackNumber <= 9 && !this.trackEffects[trackNumber]) {
            return;
        }
        
        // その他のトラックはサブクラスで処理
        this.handleTrackNumber(trackNumber, message);
    }

    /**
     * actual_tick 更新（OSC/外部入力）
     */
    setTick(nextTick) {
        const tRaw = Number(nextTick);
        if (!Number.isFinite(tRaw)) return;
        const t = Math.max(0, Math.floor(tRaw));
        const prev = this.actualTick || 0;
        if (prev === t) return;
        this.actualTick = t;
        if (this.onTickChange) this.onTickChange(prev, t);
        if (this.applyTickEffects) this.applyTickEffects(t);
    }

    /**
     * tick変化フック（インターフェース）
     */
    onTickChange(prevTick, nextTick) {
        // サブクラスで実装
    }

    /**
     * tickをエフェクトに反映するフック（インターフェース）
     */
    applyTickEffects(tick) {
        // サブクラスで実装
    }
    
    /**
     * bar（小節）更新（OSC/外部入力）
     */
    setBar(bar) {
        const bRaw = Number(bar);
        if (!Number.isFinite(bRaw) || bRaw < 1) return;
        
        const prev = this.currentBar || 0;
        this.currentBar = Math.floor(bRaw);
        
        // サブクラスで処理
        if (this.onBarChange) this.onBarChange(prev, this.currentBar);
    }
    
    /**
     * bar変化フック（インターフェース）
     */
    onBarChange(prevBar, nextBar) {
        // サブクラスで実装
    }
    
    /**
     * トラック番号を処理（サブクラスでオーバーライド）
     */
    handleTrackNumber(trackNumber, message) {
        // サブクラスで実装
    }
    
    /**
     * エフェクトのオン/オフを切り替え（数字キー1-9用）
     */
    toggleEffect(trackNumber) {
        if (trackNumber < 1 || trackNumber > 9) return;
        
        this.trackEffects[trackNumber] = !this.trackEffects[trackNumber];
        // NOTE:
        // - ここでは「スイッチ状態」だけを管理する（自動で効果を発火させない）
        // - 実際の発火（uniform更新など）はOSC受信時/Scene側の処理で行う
    }

    /**
     * phase更新（OSC/外部入力）
     * - Scene側は onPhaseChange / applyPhaseEffects をオーバーライドしてエフェクトに使う
     */
    setPhase(nextPhase) {
        const pRaw = Number(nextPhase);
        if (!Number.isFinite(pRaw)) return;
        
        // phaseは 0..9 の10ステップとして扱う（OSC側はループ前提）
        const p = ((Math.floor(pRaw) % 10) + 10) % 10;
        
        const prev = this.phase;
        if (prev === p) return;
        this.phase = p;
        if (this.onPhaseChange) this.onPhaseChange(prev, p);
        if (this.applyPhaseEffects) this.applyPhaseEffects(p);
    }

    /**
     * phase変化フック（インターフェース）
     */
    onPhaseChange(prevPhase, nextPhase) {
        // サブクラスで実装
    }

    /**
     * phaseをエフェクトに反映するフック（インターフェース）
     */
    applyPhaseEffects(phase) {
        // サブクラスで実装
    }
    
    /**
     * キーアップ処理（全シーン共通）
     * 注意: エフェクトを即OFFではなく、スイッチをOFFにするだけ
     */
    handleKeyUp(trackNumber) {
        // トラック2,3,4はキーが離された時にスイッチをOFFにする
        // ただし、エフェクト自体はdurationで自然に終わる（即OFFではない）
        if (trackNumber === 2 || trackNumber === 3 || trackNumber === 4) {
            this.trackEffects[trackNumber] = false;
        }
    }
    
    /**
     * リセット処理
     */
    reset() {
        if (this.hud && this.hud.resetTime) {
            this.hud.resetTime();
        }
    }
    
    /**
     * リサイズ処理
     */
    onResize() {
        if (this.camera) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        }
        if (this.hud) {
            this.hud.updateSize();
        }
        if (this.cameraDebugCanvas) {
            this.cameraDebugCanvas.width = window.innerWidth;
            this.cameraDebugCanvas.height = window.innerHeight;
        }
        this.resizeScreenshotCanvas();
    }
    
    /**
     * スクリーンショット用テキストを設定
     */
    setScreenshotText(text) {
        this.screenshotText = text;
    }
    
    /**
     * スクリーンショットを撮影
     * @param {boolean} is16_9 - trueの場合は16:9枠、falseの場合は正方形枠
     */
    takeScreenshot(is16_9) {
        // 既にスクリーンショット処理中の場合はスキップ
        if (this.pendingScreenshot || this.screenshotExecuting) {
            return;
        }
        
        if (!this.renderer || !this.renderer.domElement) {
            return;
        }
        
        // スクリーンショットファイル名を生成
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        const filename = `screenshot_${year}${month}${day}_${hour}${minute}${second}.png`;
        
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        const width = size.width;
        const height = size.height;
        
        let frameWidth, frameHeight, frameX, frameY;
        
        if (is16_9) {
            // YouTube用16:9の枠を計算（中央配置）
            const aspect16_9 = 16.0 / 9.0;
            
            // 画面の高さを基準に16:9の幅を計算
            frameHeight = height;
            frameWidth = frameHeight * aspect16_9;
            
            // 幅が画面より大きい場合は、幅を基準に高さを計算
            if (frameWidth > width) {
                frameWidth = width;
                frameHeight = frameWidth / aspect16_9;
            }
            
            // 中央に配置
            frameX = (width - frameWidth) / 2;
            frameY = (height - frameHeight) / 2;
        } else {
            // 正方形の枠を計算（中央配置）
            const squareSize = Math.min(width, height);
            frameWidth = squareSize;
            frameHeight = squareSize;
            frameX = (width - squareSize) / 2;
            frameY = (height - squareSize) / 2;
        }
        
        // テキストサイズを固定（画像のサイズに合わせて調整）
        this.screenshotTextSize = is16_9 ? 260 : 175;
        
        // テキストの位置をランダムに決定（より広い範囲でランダムに）
        const margin = 20;  // マージンを小さくしてより広い範囲を使用
        
        // テキストの幅を事前に計算（仮のフォントで）
        if (this.screenshotCtx) {
            this.screenshotCtx.font = `${this.screenshotTextSize}px Helvetica, Arial, sans-serif`;
            const textWidth = this.screenshotCtx.measureText(this.screenshotText).width;
            const textHeight = this.screenshotTextSize * 1.2;
            
            // テキストが枠からはみ出さない範囲を計算（CENTER揃えなので、中心位置の範囲）
            // マージンを小さくして、より広い範囲を使用
            const minX = frameX + margin + textWidth / 2;
            const maxX = frameX + frameWidth - margin - textWidth / 2;
            
            // X位置をランダムに決定（可能な限り広い範囲で）
            if (maxX < minX) {
                // テキストが大きすぎる場合は中央に配置
                this.screenshotTextX = frameX + frameWidth / 2;
            } else {
                // ランダムな位置を決定（広い範囲で）
                this.screenshotTextX = minX + Math.random() * (maxX - minX);
            }
            
            // Y位置もランダムに決定（より広い範囲で）
            const minY = frameY + margin + textHeight / 2;
            const maxY = frameY + frameHeight - margin - textHeight / 2;
            if (maxY < minY) {
                // テキストが大きすぎる場合は中央に配置
                this.screenshotTextY = frameY + frameHeight / 2;
            } else {
                // ランダムな位置を決定（広い範囲で）
                this.screenshotTextY = minY + Math.random() * (maxY - minY);
            }
        }
        
        // テキストを表示してからスクリーンショットを取る（次のフレームで）
        this.showScreenshotText = true;
        this.pendingScreenshot = true;
        this.pendingScreenshotFilename = filename;
        this.screenshotTextEndTime = Date.now() + 1000; // 1秒後
    }
    
    /**
     * スクリーンショットテキストを描画
     */
    drawScreenshotText() {
        if (!this.showScreenshotText || !this.screenshotText || this.screenshotText === '') {
            if (this.screenshotCanvas && this.screenshotCtx) {
                // テキストをクリア
                this.screenshotCtx.clearRect(0, 0, this.screenshotCanvas.width, this.screenshotCanvas.height);
            }
            return;
        }
        
        // タイマーチェック
        if (this.screenshotTextEndTime > 0 && Date.now() >= this.screenshotTextEndTime) {
            this.showScreenshotText = false;
            this.screenshotTextEndTime = 0;
            this.pendingScreenshot = false;
            if (this.screenshotCtx) {
                this.screenshotCtx.clearRect(0, 0, this.screenshotCanvas.width, this.screenshotCanvas.height);
            }
            return;
        }
        
        if (!this.screenshotCanvas || !this.screenshotCtx) {
            this.initScreenshotCanvas();
            if (!this.screenshotCanvas || !this.screenshotCtx) return;
        }
        
        // Canvasをクリア
        this.screenshotCtx.clearRect(0, 0, this.screenshotCanvas.width, this.screenshotCanvas.height);
        
        // フォントを設定
        this.screenshotCtx.font = `${this.screenshotTextSize}px Helvetica, Arial, sans-serif`;
        this.screenshotCtx.textAlign = 'center';
        this.screenshotCtx.textBaseline = 'middle';
        
        // テキストを描画（背景に応じて色を変更）
        if (this.backgroundWhite) {
            this.screenshotCtx.fillStyle = 'rgba(0, 0, 0, 1.0)';  // 白背景の場合は黒テキスト
        } else {
            this.screenshotCtx.fillStyle = 'rgba(255, 255, 255, 1.0)';  // 黒背景の場合は白テキスト
        }
        
        // テキストの位置が設定されているか確認
        if (this.screenshotTextX > 0 && this.screenshotTextY > 0) {
            this.screenshotCtx.fillText(this.screenshotText, this.screenshotTextX, this.screenshotTextY);
        } else {
            // 位置が設定されていない場合は中央に配置
            const size = new THREE.Vector2();
            this.renderer.getSize(size);
            this.screenshotTextX = size.width / 2;
            this.screenshotTextY = size.height / 2;
            this.screenshotCtx.fillText(this.screenshotText, this.screenshotTextX, this.screenshotTextY);
        }
        
        // スクリーンショットを実行（テキスト表示後に）
        // 注意: executePendingScreenshot()は1回だけ実行されるように、フラグをチェック
        if (this.pendingScreenshot && !this.screenshotExecuting) {
            // 次のフレームで実行するように遅延（テキストが確実に描画されるように）
            requestAnimationFrame(() => {
                if (this.pendingScreenshot && this.showScreenshotText && !this.screenshotExecuting) {
                    this.executePendingScreenshot();
                }
            });
        }
    }
    
    /**
     * スクリーンショットを実際に撮影（テキスト表示後に呼ばれる）
     */
    executePendingScreenshot() {
        // 既に実行中の場合はスキップ（念のため）
        if (this.screenshotExecuting) {
            return;
        }
        
        // 実行中フラグを設定（重複実行を防ぐ）
        this.screenshotExecuting = true;
        
        if (!this.pendingScreenshot || !this.showScreenshotText) {
            this.screenshotExecuting = false;
            return;
        }
        if (!this.renderer || !this.renderer.domElement) {
            this.screenshotExecuting = false;
            return;
        }
        
        // ファイル名をローカル変数に保存（非同期処理中にリセットされないように）
        const filename = this.pendingScreenshotFilename;
        
        if (!filename) {
            console.error('❌ ファイル名が設定されていません');
            this.pendingScreenshot = false;
            this.pendingScreenshotFilename = '';
            this.screenshotExecuting = false;
            return;
        }
        
        console.log(`📸 スクリーンショット撮影開始: ${filename}`);
        
        // Three.jsのCanvasとスクリーンショット用Canvasを合成
        const size = new THREE.Vector2();
        this.renderer.getSize(size);
        const width = size.width;
        const height = size.height;
        
        // 一時的なCanvasを作成して合成
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Three.jsのCanvasを描画
        tempCtx.drawImage(this.renderer.domElement, 0, 0);
        
        // HUDのCanvasを描画（HUDが表示されている場合）
        if (this.hud && this.hud.canvas && this.showHUD) {
            tempCtx.drawImage(this.hud.canvas, 0, 0);
        }
        
        // スクリーンショット用Canvas（テキスト）を描画
        if (this.screenshotCanvas) {
            tempCtx.drawImage(this.screenshotCanvas, 0, 0);
        }
        
        // 画像をBase64に変換してサーバーに送信
        tempCanvas.toBlob((blob) => {
            if (!blob) {
                console.error('❌ Blobの作成に失敗しました');
                this.pendingScreenshot = false;
                this.pendingScreenshotFilename = '';
                this.screenshotExecuting = false;
                return;
            }
            
            // BlobをBase64に変換
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result;
                
                // データの検証
                if (!base64data) {
                    console.error('❌ Base64データが生成されていません');
                    this.pendingScreenshot = false;
                    this.pendingScreenshotFilename = '';
                    this.screenshotExecuting = false;
                    return;
                }
                
                const requestData = {
                    filename: filename,
                    imageData: base64data
                };
                
                // サーバーに送信
                fetch('http://localhost:3001/api/screenshot', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestData)
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        console.log(`✅ スクリーンショット保存成功: ${data.path}`);
                    } else {
                        console.error('❌ スクリーンショット保存エラー:', data.error);
                    }
                    // 成功/失敗に関わらず、フラグをリセット
                    this.pendingScreenshot = false;
                    this.pendingScreenshotFilename = '';
                    this.screenshotExecuting = false;
                })
                .catch(error => {
                    console.error('❌ スクリーンショット送信エラー:', error.message);
                    // エラー時もフラグをリセット
                    this.pendingScreenshot = false;
                    this.pendingScreenshotFilename = '';
                    this.screenshotExecuting = false;
                });
            };
            reader.onerror = (error) => {
                console.error('❌ FileReaderエラー:', error);
                this.pendingScreenshot = false;
                this.pendingScreenshotFilename = '';
                this.screenshotExecuting = false;
            };
            reader.readAsDataURL(blob);
        }, 'image/png');
    }
    
    /**
     * OSC状態を設定
     */
    setOSCStatus(status) {
        this.oscStatus = status;
    }
    
    /**
     * パーティクル数を設定
     */
    setParticleCount(count) {
        this.particleCount = count;
    }
    
    /**
     * リソースの有効/無効を切り替え（update/レンダリングのスキップ制御）
     */
    setResourceActive(active) {
        // サブクラスで実装
    }
    
    /**
     * シーン固有の要素をクリーンアップ
     */
    cleanupSceneSpecificElements() {
        // サブクラスで実装
    }
    
    /**
     * クリーンアップ処理（シーン切り替え時に呼ばれる）
     */
    dispose() {
        // スクリーンショット用Canvasを削除
        if (this.screenshotCanvas && this.screenshotCanvas.parentElement) {
            this.screenshotCanvas.parentElement.removeChild(this.screenshotCanvas);
            this.screenshotCanvas = null;
            this.screenshotCtx = null;
        }

        // カメラデバッグ用Canvasを削除
        if (this.cameraDebugCanvas && this.cameraDebugCanvas.parentElement) {
            this.cameraDebugCanvas.parentElement.removeChild(this.cameraDebugCanvas);
            this.cameraDebugCanvas = null;
            this.cameraDebugCtx = null;
        }
        
        // サブクラスで実装
    }
}

