/**
 * Scene01 (WebGPU): MLS-MPM Particle Simulation
 * - 旧scene12をWebGPU専用システムのScene01として固定
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { Lights } from '../../lib/lights.js';
import hdri from '../../assets/autumn_field_puresky_1k.hdr';
import { float } from "three/tsl";
import { conf } from '../../common/conf.js';
// import BackgroundGeometry from '../../lib/BackgroundGeometry.js'; // 床グリッドはGridRuler3Dに統一
import { GridRuler3D } from '../../lib/GridRuler3D.js';
import { MlsMpmParticleSystem } from '../../systems/MlsMpmParticleSystem.js';
import { loadHdrCached } from '../../lib/hdrCache.js';

export class Scene01 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | vinko_plashra';
        
        this.sharedResourceManager = sharedResourceManager;
        
        // SceneBaseのカメラパーティクルを上書き（MLS-MPM用の設定）
        this.cameraParticles = [];
        this.currentCameraIndex = 0;
        this.cameraCenter = new THREE.Vector3(0, 0.5, 0.0);
        
        // 小節ベースのランダマイズ設定
        this.currentBar = 0;  // 現在の小節（1始まり）
        this.barRandomizeInterval = 8;  // カメラ切り替え間隔（デフォルト8小節）
        this.lastRandomizedBar = 0;  // 最後にカメラ切り替えした小節
        this.lastForceRandomizedBar = 0;  // 最後にランダマイズした小節
        
        // トラックのON/OFF（数字キーでトグル）
        this.trackEffects = {
            1: true,   // camera randomize（カメラ切り替えは無効化、パーティクルへの力は残す）
            2: true,   // invert（OSCで発火する前提）
            3: true,   // chroma（OSCで発火する前提）
            4: true,   // glitch（OSCで発火する前提）
            5: true,   // impulse（Track5）
            6: false,
            7: false,
            8: false,
            9: false,
        };

        // HUD上の擬似3DグリッドはデフォOFF（最前面固定になるのでNG）
        this.SHOW_HUD_GRID = false;
        this.hudGridConfig = null; // setup()でセット（互換用）

        // 3Dオブジェクトとしてのグリッド＋ルーラー（遮蔽が効く）
        this.SHOW_WORLD_GRID = true; // gキーのデフォルトON
        this.worldGrid = null;

        // パーティクル表示（デフォルトON）
        this.SHOW_PARTICLES = true;

        // phase(0..9)の代わりに actual_tick を使って “展開” を滑らかにする
        this.USE_ACTUAL_TICK_FOR_PHASE = true;
        // tick→展開の最大（96小節）
        this._tickPhaseMaxTicks = 96 * 4 * 96; // 96tick/拍 * 4拍/小節 * 96小節
        // 粒数更新の量子化（OSC tickが高頻度でも重くならんように）
        this._tickParticleQuant = 512;
        this._lastTickDrivenParticles = null;
        
        // フェーズ変更時にカメラをランダマイズ（Track1とは別に自動実行）
        this.onPhaseChange = (prevPhase, nextPhase) => {
            this.switchCameraRandom(true); // force=trueでtrackEffects[1]を無視
        };
    }
    
    async setup() {
        await super.setup();
        
        // スクリーンショット用テキストを設定
        this.setScreenshotText(this.title);
        
        // カメラをMLS-MPM用の設定に変更
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 5);
        this.camera.position.set(0, 0.5, -1);
        this.camera.updateProjectionMatrix();
        
        // シーンをMLS-MPM用の設定に変更
        this.scene = new THREE.Scene();           // レイヤー1: オブジェクト（FX対象）
        this.overlayScene = new THREE.Scene();    // レイヤー3: カメラパーティクル/Box/サークル等（FX対象外・加算合成）
        this.overlayScene.background = null;
        
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, 0.5, 0.0);
        this.controls.enableDamping = true;
        this.controls.enablePan = false;
        this.controls.touches = {
            TWO: THREE.TOUCH.DOLLY_ROTATE,
        };
        this.controls.maxDistance = 2.0;
        this.controls.minPolarAngle = 0.2 * Math.PI;
        this.controls.maxPolarAngle = 0.8 * Math.PI;
        this.controls.minAzimuthAngle = 0.7 * Math.PI;
        this.controls.maxAzimuthAngle = 1.3 * Math.PI;
        this.controls.enabled = false;
        
        // カメラパーティクルを初期化（MLS-MPM用の設定）
        const { CameraParticle } = await import('../../lib/CameraParticle.js');
        
        // カメラパーティクルのBox範囲を定義
        // NOTE:
        // 旧システム比で「ランダマイズ幅が狭い」感が出やすいので、デフォを広げる
        const camBoxSizeX = 1.40;  // 0.8 -> 1.4
        const camBoxSizeZ = 1.60;  // 0.8 -> 1.6
        const camBoxZCenter = -1.25; // -1.0 -> -1.25（手前〜奥の幅を増やす）
        const boxMin = new THREE.Vector3(
            -camBoxSizeX * 0.5,
            0.0,
            camBoxZCenter - camBoxSizeZ * 0.5
        );
        const boxMax = new THREE.Vector3(
            camBoxSizeX * 0.5,
            1.05,
            camBoxZCenter + camBoxSizeZ * 0.5
        );
        
        // 8台のカメラを初期化
        for (let i = 0; i < 8; i++) {
            const cp = new CameraParticle();
            // 狭く感じる原因になりやすいので、デフォを少し上げる（Scene02とバランス）
            cp.maxSpeed = 0.07;
            cp.maxForce = 0.02;
            // 減衰は conf で一括管理（いつでも戻せるように）
            cp.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
            
            // Boxの境界を設定（バウンドするように）
            cp.boxMin = boxMin.clone();
            cp.boxMax = boxMax.clone();
            
            // 初期位置をBox内にランダムに配置
            cp.position.set(
                boxMin.x + Math.random() * (boxMax.x - boxMin.x),
                boxMin.y + Math.random() * (boxMax.y - boxMin.y),
                boxMin.z + Math.random() * (boxMax.z - boxMin.z)
            );
            
            this.cameraParticles.push(cp);
        }
        
        this.currentCameraIndex = 0;
        this.cameraCenter = this.controls.target.clone();
        
        // HDRテクスチャを読み込み（キャッシュ）→ 共通適用
        const hdriTexture = await loadHdrCached(hdri);
        this.applyHdriEnvironment(hdriTexture);
        
        // シーン固有のシャドウ設定（conf.jsに依存せず、シーンごとに独立）
        // Scene01: シャドウ有効（MLS-MPMパーティクルで影が重要）
        this._shadowMapEnabled = true;
        this._shadowMapType = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.enabled = this._shadowMapEnabled;
        this.renderer.shadowMap.type = this._shadowMapType;
        
        // MLS-MPMパーティクルシステム（再利用ユニット）
        this.particleSystem = new MlsMpmParticleSystem(this.renderer);
        await this.particleSystem.init({ scene: this.scene });
        this.mlsMpmSim = this.particleSystem.sim; // 既存コード互換（Track5やHUDで参照）
        this.particleRenderer = this.particleSystem.particleRenderer;
        this.pointRenderer = this.particleSystem.pointRenderer;

        // Scene01: シャドウを有効にするため、パーティクルのシャドウ設定を明示的に有効化
        if (this.particleRenderer?.object) {
            this.particleRenderer.object.castShadow = true;
            this.particleRenderer.object.receiveShadow = true;
        }
        if (this.pointRenderer?.object) {
            this.pointRenderer.object.castShadow = true;
            this.pointRenderer.object.receiveShadow = true;
        }

        // デフォルトで粒子を一時OFF（床/グリッド確認しやすくする）
        this.particleSystem.setVisible?.(this.SHOW_PARTICLES);

        // phaseが変化していなくても、起動時に現在phaseで一度適用（粒子数/色mixを反映）
        if (typeof this.applyPhaseEffects === 'function') {
            this.applyPhaseEffects(this.phase);
        }
        
        this.lights = new Lights();
        this.scene.add(this.lights.object);
        
        this.overlayLights = new Lights();
        this.overlayScene.add(this.overlayLights.object);
        
        // ワイヤーフレームのBox（境界表示用）
        const gridSize = 64;
        const wallMin = 1;
        const wallMax = 63;
        const wallRange = wallMax - wallMin;
        const s = 1.0 / gridSize;
        const zScale = 0.4;
        
        const boxSizeX = wallRange * s;
        const boxSizeY = wallRange * s;
        const boxSizeZ = wallRange * s * zScale;
        
        const centerGrid = (wallMin + wallMax) * 0.5;
        const boxCenterX = centerGrid * s - 0.5;
        const boxCenterY = centerGrid * s;
        const boxCenterZ = centerGrid * s * zScale - 32.0 * s * zScale;

        // HUD用：パーティクルBoxのワイヤー/グリッド（3D投影で描画するためワールド座標で保持）
        this.hudGridConfig = {
            enabled: () => this.SHOW_HUD_GRID,
            // 3D投影に使うカメラは毎フレームのthis.cameraを参照
            get camera() { return null; }, // HUD側でSceneから受け取る
            box: {
                // Boxの中心・サイズ（ワールド座標）
                center: { x: boxCenterX, y: boxCenterY, z: boxCenterZ },
                size: { x: boxSizeX, y: boxSizeY, z: boxSizeZ },
                // 目盛り分割（適当なデフォルト、必要なら後でconf化）
                divX: 12,
                divY: 10,
                divZ: 8,
                // ラベル表示（0..64のグリッド値っぽく）
                labelMax: 64
            }
        };
        
        // 床をBoxに合わせる
        const boxBottomY = boxCenterY - boxSizeY * 0.5;
        const floorY = boxBottomY - 0.002;
        // 床グリッドの大きさ（箱の外側に少し余白があるくらいにする）
        // 以前は *4.0 で大きすぎたので縮小
        const floorSize = Math.max(boxSizeX, boxSizeZ) * 2.2;
        // NOTE:
        // - 床グリッドは GridRuler3D 側に統一（2枚重なって見える問題を回避）
        // - BackgroundGeometry(GridHelper) はここでは使わない

        // 3Dグリッド＋ルーラー（床＋垂直面＋目盛り）
        this.worldGrid = new GridRuler3D();
        this.worldGrid.init({
            center: { x: boxCenterX, y: boxCenterY, z: boxCenterZ },
            size: { x: boxSizeX, y: boxSizeY, z: boxSizeZ },
            // 床グリッドは大きい方に合わせる
            floorSize,
            floorY,
            color: 0xffffff,
            // 床グリッド線は控えめに（パーティクルが主役）
            opacity: 0.25
        });
        this.worldGrid.setVisible(this.SHOW_WORLD_GRID);
        this.scene.add(this.worldGrid.group);
        
        // カメラがパーティクルBoxの「裏側（+Z側）」に回り込まないように制限
        const boxFrontZ = boxCenterZ - boxSizeZ * 0.5;
        const cameraZMargin = 0.05;
        this.cameraMaxZWorld = boxFrontZ - cameraZMargin;
        this.cameraMaxZLocal = this.cameraMaxZWorld - this.cameraCenter.z;
        
        const boxGeometry = new THREE.BoxGeometry(boxSizeX, boxSizeY, boxSizeZ);
        const boxEdges = new THREE.EdgesGeometry(boxGeometry);
        const boxMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.82,
            depthTest: true,
            depthWrite: false
        });
        const boxWireframe = new THREE.LineSegments(boxEdges, boxMaterial);
        boxWireframe.position.set(boxCenterX, boxCenterY, boxCenterZ);
        this.overlayScene.add(boxWireframe);
        this.boundaryBox = boxWireframe;
        
        // ポストFX（共通、bloomを無効化）
        const originalBloom = conf.bloom;
        conf.bloom = false;
        this.initPostFX();
        conf.bloom = originalBloom; // 他のシーンに影響しないように戻す
        
        // カメラパーティクルの可視化（c/C）を共通化：SceneBase側で描画
        // NOTE: Scene01はoverlaySceneに載せる（FX対象外）
        this.initCameraDebug(this.overlayScene);
        
        // Track5インパルス表示用Canvas
        this.impulseCanvas = document.createElement('canvas');
        this.impulseCanvas.width = window.innerWidth;
        this.impulseCanvas.height = window.innerHeight;
        this.impulseCanvas.style.position = 'absolute';
        this.impulseCanvas.style.top = '0';
        this.impulseCanvas.style.left = '0';
        this.impulseCanvas.style.pointerEvents = 'none';
        this.impulseCanvas.style.zIndex = '900';
        this.impulseCtx = this.impulseCanvas.getContext('2d');
        this.impulseCtx.font = '24px monospace';
        this.impulseCtx.textAlign = 'center';
        this.impulseCtx.textBaseline = 'top';
        document.body.appendChild(this.impulseCanvas);
        
        // Track5インパルス表示
        this.initImpulseIndicator();
    }

    /**
     * SceneManager から呼ばれる：リソースの有効/無効（ライブ用途：disposeはしない）
     * - DOM(Canvas)や重い更新だけ止めて、常駐は維持する
     */
    setResourceActive(active) {
        this._resourceActive = !!active;
        // impulseCanvas は Scene01 固有なので、非アクティブ時は非表示にしてコストを下げる
        if (this.impulseCanvas) {
            this.impulseCanvas.style.display = this._resourceActive ? 'block' : 'none';
        }
        // パーティクル表示も合わせて止めたい場合（切替時のチラつき防止）
        if (this.particleSystem && this.particleSystem.setVisible) {
            this.particleSystem.setVisible(this._resourceActive && !!this.SHOW_PARTICLES);
        }
    }
    
    setupCameraParticleDistance(cameraParticle) {
        cameraParticle.maxSpeed = 0.03;
        cameraParticle.maxForce = 0.01;
        cameraParticle.friction = 0.02;
        cameraParticle.minDistance = 0.55;
        cameraParticle.maxDistanceReset = 1.0;
        cameraParticle.maxDistance = 1.6;
    }
    
    onUpdate(deltaTime) {
        // 時間の更新
        this.time += deltaTime;
        
        // 初期化が完了しているかチェック
        if (!this.particleRenderer || !this.pointRenderer) {
            return;
        }
        
        // パーティクル表示は MlsMpmParticleSystem 側で一元管理（pキーでトグル）
        // （ここで毎フレームvisibleを書き換えると setVisible(false) が効かなくなる）
        
        // CameraParticle更新
        // - トラック1 OFF: 新しいランダマイズは入れないが、直前の慣性は減衰で自然に止まる
        const camMoveOn = !!this.trackEffects[1];
        this.cameraParticles.forEach((cp) => {
            cp.enableMovement = camMoveOn;
            cp.update();
            
            // トラック1がOFFの時は、力もリセット（新しいランダマイズを止める）
            if (!camMoveOn) {
                cp.force.set(0, 0, 0);
            }
            
            // Boxより後ろ（+Z側）に行かせない
            if (this.cameraMaxZLocal !== undefined && cp.position && cp.velocity) {
                if (cp.position.z > this.cameraMaxZLocal) {
                    cp.position.z = this.cameraMaxZLocal;
                    cp.velocity.z = Math.min(cp.velocity.z, 0);
                }
            }
        });
        
        const cp = this.cameraParticles[this.currentCameraIndex];
        if (cp) {
            const cameraPos = cp.getPosition().clone().add(this.cameraCenter);
            if (this.cameraMaxZWorld !== undefined) {
                cameraPos.z = Math.min(cameraPos.z, this.cameraMaxZWorld);
            }
            this.camera.position.copy(cameraPos);
            this.camera.lookAt(this.cameraCenter);
            this.camera.matrixWorldNeedsUpdate = false;
        }
        
        // 初期化が完了しているかチェック
        if (!this.particleRenderer || !this.pointRenderer || !this.lights) {
            return;
        }
        
        this.lights.update(this.time);
        if (this.particleSystem) {
            this.particleSystem.updateRenderers();
        }
        
        // Scene01: パーティクルのシャドウ設定を維持（particleRenderer.update()でconf.particleCastShadowに上書きされるのを防ぐ）
        if (this.particleRenderer?.object) {
            this.particleRenderer.object.castShadow = true;
            this.particleRenderer.object.receiveShadow = true;
        }
        if (this.pointRenderer?.object) {
            this.pointRenderer.object.castShadow = true;
            this.pointRenderer.object.receiveShadow = true;
        }

        // 3Dグリッドのラベルをカメラに向ける & 表示トグル反映
        if (this.worldGrid) {
            this.worldGrid.setVisible(this.SHOW_WORLD_GRID);
            this.worldGrid.update(this.camera);
        }

        // 共通：FX更新（track2-4 + duration）
        this.updatePostFX();
        
        // 初期化済みのメソッドのみ呼び出す
        // NOTE: カメラデバッグ描画はSceneBaseに共通化（update内で自動）
        if (this.updateImpulseIndicator) {
            this.updateImpulseIndicator();
        }
        
        // durationMs付きの自動OFFも SceneBase.updatePostFX() 側で処理
        
        // MLS-MPMシミュレーション更新
        if (this.mlsMpmSim) {
            // updateはrender()で呼ぶ（非同期のため）
        }
    }
    
    async render() {
        // 初期化が完了しているかチェック
        if (!this.mlsMpmSim || !this.postProcessing) {
            return;
        }
        
        // MLS-MPMシミュレーション更新（非同期）
        // 物理エンジンなので常にupdate()を実行（力を加えないだけ）
        const delta = 0.016; // 固定delta
        if (this.particleSystem) {
            await this.particleSystem.stepSimulation(delta, this.time);
        } else if (this.mlsMpmSim) {
            await this.mlsMpmSim.update(delta, this.time);
        }
        
        // ポストプロセッシング描画
        try {
            await this.postProcessing.renderAsync();
        } catch (err) {
            // WebGPU のノード管理エラーをログに出力して確認
            console.error('Scene01 renderエラー:', err);
            // エラーが発生してもHUDは表示する
        }
        
        // HUDを描画
        if (this.hud && this.showHUD) {
            const hudData = this.getHUDData();
            const now = performance.now();
            const frameRate = this.lastFrameTime ? 1.0 / ((now - this.lastFrameTime) / 1000.0) : 60.0;
            this.lastFrameTime = now;
            
            this.hud.display(
                frameRate,
                hudData.currentCameraIndex || this.currentCameraIndex,
                hudData.cameraPosition || new THREE.Vector3(),
                0,
                this.time,
                hudData.rotationX || 0,
                hudData.rotationY || 0,
                hudData.distance || 0,
                0,
                hudData.isInverted || false,
                this.oscStatus,
                hudData.particleCount || 0,
                hudData.trackEffects || this.trackEffects,
                this.phase,
                hudData.hudScales,
                null,
                hudData.currentBar || 0,
                '',
                this.actualTick || 0,
                hudData.cameraModeName || null
            );
        }
        
        // スクリーンショットテキストを描画
        this.drawScreenshotText();
    }
    
    getHUDData() {
        const cp = this.cameraParticles[this.currentCameraIndex];
        const cameraPos = cp ? cp.getPosition().clone().add(this.cameraCenter) : new THREE.Vector3();
        const distance = cameraPos.length();
        const distToTarget = cp ? cp.getPosition().length() : distance;
        const rotationX = cp ? cp.getRotationX() : 0;
        const rotationY = cp ? cp.getRotationY() : 0;
        // invert.valueが0.0に戻った時に確実にfalseになるように、> 0.0で判定
        const isInverted = this.fxUniforms && this.fxUniforms.invert ? this.fxUniforms.invert.value > 0.0 : false;
        return {
            currentCameraIndex: this.currentCameraIndex,
            cameraModeName: 'random', // シーン01はランダムモード
            cameraPosition: cameraPos,
            rotationX,
            rotationY,
            distance,
            trackEffects: this.trackEffects,
            isInverted,
            currentBar: this.currentBar || 0,
            hudScales: {
                distToTarget,
                fovDeg: this.camera?.fov ?? 60,
                cameraY: cameraPos.y
            },
            time: this.time,
            particleCount: conf.particles || 0
        };
    }
    
    handleTrackNumber(trackNumber, message) {
        const args = message.args || [];
        const noteNumber = Number(args[0] ?? 64);
        const velocity = Number(args[1] ?? 127);
        const durationMs = Number(args[2] ?? 0);
        
        if (trackNumber === 1) {
            this.applyTrack1Camera(velocity, durationMs);
        } else if (trackNumber === 2) {
            this.applyTrack2Invert(velocity, durationMs);
        } else if (trackNumber === 3) {
            this.applyTrack3Chromatic(velocity, durationMs);
        } else if (trackNumber === 4) {
            this.applyTrack4Glitch(velocity, durationMs);
        } else if (trackNumber === 5) {
            const dur = durationMs > 0 ? durationMs : 120;
            this.applyTrack5Force(noteNumber, velocity, dur);
        }
    }

    /**
     * phase(0..9)に合わせて表示/シミュレーション粒子数を10段階で増やす
     * - phase 0 -> 10%
     * - phase 9 -> 100%
     */
    applyPhaseEffects(phase) {
        // actual_tick が来てる時は tick側で滑らかに制御する
        if (this.USE_ACTUAL_TICK_FOR_PHASE && Number.isFinite(this.actualTick) && this.actualTick > 0) {
            return;
        }
        // 最大値は「起動時のconf.particles」を基準に固定
        if (this._phaseParticleMax == null) {
            this._phaseParticleMax = conf.particles;
        }
        const maxP = Math.max(1, Number(this._phaseParticleMax) || 1);
        const step = Math.min(Math.max(Number(phase) || 0, 0), 9) + 1; // 1..10
        const target = Math.max(1, Math.round(maxP * (step / 10)));

        // phase 0..9 を 0..1 に正規化して、グレースケール→ヒートマップへ
        const t = Math.min(Math.max((Number(phase) || 0) / 9, 0), 1);
        const heatMix = this.particleSystem?.particleRenderer?.uniforms?.heatmapMix;
        if (heatMix) {
            heatMix.value = t;
        }
        
        if (conf.particles !== target) {
            conf.particles = target;
            // 粒数に依存するパラメータ（restDensityなど）も更新
            if (typeof conf.updateParams === 'function') {
                conf.updateParams();
            }
        }
    }

    /**
     * actual_tick を 0..(96小節) にクランプして、phase相当(0..1)へリニアマップ
     * - 粒数: 10%→100%を連続で
     * - 色(heatmapMix): 0→1を連続で
     */
    applyTickEffects(tick) {
        if (!this.USE_ACTUAL_TICK_FOR_PHASE) return;
        if (this._phaseParticleMax == null) {
            this._phaseParticleMax = conf.particles;
        }
        const maxP = Math.max(1, Number(this._phaseParticleMax) || 1);
        const maxTicks = Math.max(1, Number(this._tickPhaseMaxTicks) || 1);
        const tn = Math.min(Math.max(Number(tick) / maxTicks, 0), 1); // 0..1

        // heatmapMix（グレースケール→ヒートマップ）を滑らかに
        const heatMix = this.particleSystem?.particleRenderer?.uniforms?.heatmapMix;
        if (heatMix) heatMix.value = tn;

        // 粒数も 10%→100% を滑らかに（ただし更新頻度は量子化で抑える）
        const ratio = 0.1 + 0.9 * tn;
        const desired = Math.round(maxP * ratio);
        const q = Math.max(1, Number(this._tickParticleQuant) || 1);
        const target = Math.min(maxP, Math.max(1, Math.round(desired / q) * q));
        if (this._lastTickDrivenParticles !== target) {
            this._lastTickDrivenParticles = target;
            if (conf.particles !== target) {
                conf.particles = target;
                if (typeof conf.updateParams === 'function') conf.updateParams();
            }
        }
    }
    
    toggleEffect(trackNumber) {
        super.toggleEffect(trackNumber);
        // NOTE:
        // - Scene01ではトグルは「OSCで発火を許可するスイッチ」扱い
        // - ここで永続的にuniformをONにしない（OSCが無いのに勝手に見た目が変わるのを防ぐ）
        // - Track5はOSC impulseのみ（キーでは発火しない）
    }
    
    handleKeyPress(key) {
        // 共通キーはSceneBaseで処理（c/Cなど）
        if (super.handleKeyPress && super.handleKeyPress(key)) return;
        if (key === 'g' || key === 'G') {
            // g/Gは3Dグリッド（遮蔽が効く方）をトグル
            this.SHOW_WORLD_GRID = !this.SHOW_WORLD_GRID;
        } else if (key === 'p' || key === 'P') {
            this.SHOW_PARTICLES = !this.SHOW_PARTICLES;
            if (this.particleSystem) {
                this.particleSystem.setVisible?.(this.SHOW_PARTICLES);
            } else {
                if (this.particleRenderer?.object) this.particleRenderer.object.visible = this.SHOW_PARTICLES;
                if (this.pointRenderer?.object) this.pointRenderer.object.visible = false;
            }
        }
    }
    
    // 共通エフェクト制御
    // setInvert / setChromatic / setGlitch は SceneBase に共通化
    
    switchCameraRandom(force = false) {
        // force=trueの場合はtrackEffects[1]をチェックしない（フェーズ変更時など）
        if (!force && !this.trackEffects[1]) return;
        
        let newIndex = this.currentCameraIndex;
        while (newIndex === this.currentCameraIndex) {
            newIndex = Math.floor(Math.random() * this.cameraParticles.length);
        }
        this.currentCameraIndex = newIndex;
    }
    
    applyTrack1Camera(velocity, durationMs) {
        // Track1: カメラ用CameraParticleに「力ランダム（弱め）+ カメラ切替」
        // - velocity でブースト量を決める（SceneBase共通ロジック）
        // - 力を弱めに調整
        if (!this.trackEffects?.[1]) return;
        const cps = this.cameraParticles;
        if (!cps || cps.length === 0) return;

        const v01 = Math.min(Math.max((Number(velocity) || 0) / 127, 0), 1);
        // さらにさらに弱め（"まだ強い"対策）
        // - maxForce: ほぼ上げない（= ランダムforceはmaxForceで強制的に小さくクランプされる）
        // - maxSpeed: ほぼ固定
        // 0.03..0.09（元の0.06..0.18の半分）
        const forceMul = 0.03 + 0.06 * v01;
        // 1.00..1.02（元の1.00..1.04の半分）
        const speedMul = 1.00 + 0.02 * v01;
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
            // NOTE: 強すぎる場合があるので "Weak" を優先
            if (typeof cp.applyRandomForceWeak === 'function') {
                cp.applyRandomForceWeak();
            } else if (typeof cp.applyRandomForce === 'function') {
                cp.applyRandomForce();
            }
        });

        // カメラを切り替える
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
     * bar（小節）変化時の処理
     */
    onBarChange(prevBar, nextBar) {
        // NOTE:
        // 以前の「barごと自動ランダマイズ」はやめて、Track1（OSC）トリガーに戻す。
        // bar情報自体はHUDなどに使うので保持だけしておく（super/setBar側で currentBar は更新済み）。
    }
    
    applyTrack2Invert(velocity, durationMs) {
        if (!this.trackEffects[2]) return;
        const dur = durationMs > 0 ? durationMs : 150;
        this.setInvert(true, dur);
    }
    
    applyTrack3Chromatic(velocity, durationMs) {
        if (!this.trackEffects[3]) return;
        // Track3（色相/色収差ディストーション）:
        // mavrx4側の最大効き = amount 1.0 として、velocity(0..127) を 0..1.0 にマッピング
        const amount = Math.min(Math.max(velocity / 127, 0), 1) * 1.0;
        const dur = durationMs > 0 ? durationMs : 150;
        this.setChromatic(amount, dur);
    }
    
    applyTrack4Glitch(velocity, durationMs) {
        if (!this.trackEffects[4]) return;
        const amount = Math.min(Math.max(velocity / 127, 0), 1) * 0.7;
        const dur = durationMs > 0 ? durationMs : 150;
        this.setGlitch(amount, dur);
    }
    
    applyTrack5Force(noteNumber, velocity, durationMs) {
        if (!this.trackEffects[5]) return;
        if (!this.mlsMpmSim || !this.mlsMpmSim.applyTrack5Force) return;
        const info = this.mlsMpmSim.applyTrack5Force(noteNumber, velocity, durationMs);
        if (info && typeof info.slot === 'number') {
            this.triggerImpulseIndicator(info.slot, info);
        }
    }
    
    reset() {
        super.reset();
        
        // エフェクトOFF
        this.setInvert(false, 0);
        this.setChromatic(0.0, 0);
        this.setGlitch(0.0, 0);
        
        // カメラをデフォルトへ
        if (this.controls) {
            this.controls.target.set(0, 0.5, 0.0);
        }
        this.camera.position.set(0, 0.5, -1);
        if (this.controls) {
            this.camera.lookAt(this.controls.target);
        }
        
        // パーティクルをGPUで再初期化
        if (this.mlsMpmSim?.resetParticles) {
            // 非同期なのでawaitは呼び出し側で
            this.mlsMpmSim.resetParticles();
        }
        
        // インパルス表示をリセット
        if (this.impulseIndicators && this.impulseIndicators.length) {
            this.impulseIndicators.forEach((ind) => {
                ind.active = false;
                if (ind.circleGroup) ind.circleGroup.visible = false;
                if (ind.sphereGroup) ind.sphereGroup.visible = false;
            });
        }
    }
    
    onResize() {
        super.onResize();
        if (this.camera) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        }
        if (this.cameraDebugCanvas) {
            this.cameraDebugCanvas.width = window.innerWidth;
            this.cameraDebugCanvas.height = window.innerHeight;
        }
        if (this.impulseCanvas) {
            this.impulseCanvas.width = window.innerWidth;
            this.impulseCanvas.height = window.innerHeight;
        }
    }
    
    // ===== Track5 indicator =====
    gridToWorld(gridPos) {
        const s = 1.0 / 64.0;
        const zScale = 0.4;
        return new THREE.Vector3(
            gridPos.x * s - 0.5,
            gridPos.y * s,
            gridPos.z * s * zScale - 0.2
        );
    }
    
    initImpulseIndicator() {
        const max = this.mlsMpmSim?.maxImpulses ?? 8;
        this.impulseIndicators = [];
        
        const sphereGeom = new THREE.SphereGeometry(0.02, 16, 16);
        const sphereMatBase = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            transparent: false,
            opacity: 1.0,
            emissive: 0x330000,
            emissiveIntensity: 0.25,
            roughness: 0.8,
            metalness: 0.0
        });
        
        const segments = 32;
        const ringFillGeom = new THREE.RingGeometry(0.0, 1.0, segments);
        const ringFillMatBase = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.22,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const ringEdgeGeom = new THREE.RingGeometry(0.985, 1.0, segments);
        const ringEdgeMatBase = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        for (let i = 0; i < max; i++) {
            const circleGroup = new THREE.Group();
            circleGroup.visible = false;
            this.overlayScene.add(circleGroup);
            
            const sphereGroup = new THREE.Group();
            sphereGroup.visible = false;
            this.scene.add(sphereGroup);
            
            const sphere = new THREE.Mesh(sphereGeom, sphereMatBase.clone());
            sphereGroup.add(sphere);
            
            const circle = new THREE.Mesh(ringFillGeom, ringFillMatBase.clone());
            circle.rotation.set(0, 0, 0);
            circleGroup.add(circle);
            
            const edges = new THREE.Mesh(ringEdgeGeom, ringEdgeMatBase.clone());
            edges.rotation.set(0, 0, 0);
            circleGroup.add(edges);
            
            this.impulseIndicators.push({
                active: false,
                startMs: 0,
                endMs: 0,
                maxStrength: 1.0,
                radiusGrid: 10.0,
                posGrid: new THREE.Vector3(),
                posWorld: new THREE.Vector3(),
                circleGroup,
                sphereGroup,
                sphere,
                circle,
                edges
            });
        }
    }
    
    triggerImpulseIndicator(slot, info) {
        const ind = this.impulseIndicators?.[slot];
        if (!ind) return;
        
        ind.active = true;
        ind.startMs = info?.startMs ?? Date.now();
        ind.endMs = info?.endMs ?? (ind.startMs + 400);
        ind.maxStrength = Math.max(0.0001, info?.baseStrength ?? 1.0);
        ind.radiusGrid = info?.radius ?? 10.0;
        ind.posGrid.copy(info?.pos ?? new THREE.Vector3());
        ind.posWorld.copy(this.gridToWorld(ind.posGrid));
        
        ind.circleGroup.position.copy(ind.posWorld);
        ind.circleGroup.visible = true;
        ind.sphereGroup.position.copy(ind.posWorld);
        ind.sphereGroup.visible = true;
    }
    
    updateImpulseIndicator() {
        if (this.impulseCtx && this.impulseCanvas) {
            this.impulseCtx.clearRect(0, 0, this.impulseCanvas.width, this.impulseCanvas.height);
        }
        const now = Date.now();
        const list = this.impulseIndicators || [];
        if (!list.length) return;
        
        for (let i = 0; i < list.length; i++) {
            const ind = list[i];
            if (!ind.active) continue;
            if (now > ind.endMs) {
                ind.active = false;
                ind.circleGroup.visible = false;
                ind.sphereGroup.visible = false;
                continue;
            }
            
            const total = Math.max(1, ind.endMs - ind.startMs);
            const t = Math.min(1, Math.max(0, (now - ind.startMs) / total));
            const alpha = Math.max(0, 1 - t);
            
            const strengthNow = this.mlsMpmSim?.impulses?.[i]?.currentStrength ?? 0;
            const strength01 = Math.min(1, Math.max(0, strengthNow / ind.maxStrength));
            
            const s = 0.75 + strength01 * 0.65;
            ind.sphere.scale.set(s, s, s);
            
            const radiusWorld = (ind.radiusGrid / 64.0) * (0.6 + 0.9 * t);
            ind.circle.scale.set(radiusWorld, radiusWorld, 1);
            ind.circle.material.opacity = alpha * 0.22;
            ind.edges.scale.set(radiusWorld, radiusWorld, 1);
            ind.edges.material.opacity = alpha * 0.8;
            
            if (this.impulseCtx && this.impulseCanvas) {
                const v = ind.posWorld.clone();
                v.project(this.camera);
                const x = (v.x * 0.5 + 0.5) * this.impulseCanvas.width;
                const y = (-v.y * 0.5 + 0.5) * this.impulseCanvas.height;
                if (x >= 0 && x <= this.impulseCanvas.width && y >= 0 && y <= this.impulseCanvas.height && v.z > -1.0 && v.z < 1.0) {
                    this.impulseCtx.save();
                    this.impulseCtx.fillStyle = 'white';
                    this.impulseCtx.font = '20px monospace';
                    this.impulseCtx.textAlign = 'center';
                    this.impulseCtx.textBaseline = 'top';
                    
                    const coordText = `(${Math.round(ind.posGrid.x)}, ${Math.round(ind.posGrid.y)}, ${Math.round(ind.posGrid.z)})`;
                    const strengthText = `Strength: ${(strengthNow).toFixed(1)}`;
                    const radiusText = `Radius: ${Math.round(ind.radiusGrid)}`;
                    
                    this.impulseCtx.fillText(coordText, x, y - 52);
                    this.impulseCtx.fillText(strengthText, x, y - 28);
                    this.impulseCtx.fillText(radiusText, x, y - 4);
                    this.impulseCtx.restore();
                }
            }
        }
    }
    
    initCameraDebugObjects() {
        if (!this.cameraDebugGroup) return;
        
        // Scene01はスケールが小さい（camera far: 5）ので、デバッグ球体も小さく
        const sphereSize = 0.008;
        const circleRadius = 0.025;
        const circleSegments = 32;
        
        this.cameraDebugTextPositions = [];
        
        for (let i = 0; i < this.cameraParticles.length; i++) {
            const sphereGeometry = new THREE.SphereGeometry(sphereSize, 32, 32);
            const sphereMaterial = new THREE.MeshStandardMaterial({
                color: 0xff0000,
                transparent: false,
                opacity: 1.0,
                emissive: 0x330000,
                emissiveIntensity: 0.2,
                roughness: 0.8,
                metalness: 0.0
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
    
    drawCameraDebug() {
        if (this.cameraDebugCtx && this.cameraDebugCanvas) {
            this.cameraDebugCtx.clearRect(0, 0, this.cameraDebugCanvas.width, this.cameraDebugCanvas.height);
        }
        if (!this.SHOW_CAMERA_DEBUG || !this.cameraDebugGroup) return;
        
        const center = this.cameraCenter.clone();
        
        for (let i = 0; i < this.cameraParticles.length; i++) {
            const cp = this.cameraParticles[i];
            const pos = cp.getPosition().clone().add(center);
            
            const sphere = this.cameraDebugSpheres[i];
            if (sphere) {
                sphere.position.copy(pos);
                sphere.visible = true;
            }
            
            const circles = this.cameraDebugCircles[i];
            if (circles && Array.isArray(circles)) {
                circles.forEach((c) => {
                    if (!c) return;
                    c.position.copy(pos);
                    c.scale.set(1.0, 1.0, 1.0);
                    c.visible = this.SHOW_CAMERA_DEBUG_CIRCLES;
                    if (c.material) {
                        c.material.opacity = 1.0;
                        c.material.needsUpdate = true;
                    }
                });
            }
            
            const line = this.cameraDebugLines[i];
            if (line && line.userData && line.userData.positionAttr) {
                const attr = line.userData.positionAttr;
                const a = attr.array;
                a[0] = pos.x; a[1] = pos.y; a[2] = pos.z;
                a[3] = center.x; a[4] = center.y; a[5] = center.z;
                attr.needsUpdate = true;
                line.visible = true;
            }
            
            if (this.cameraDebugCtx && this.cameraDebugCanvas) {
                const vector = pos.clone();
                vector.project(this.camera);
                const x = (vector.x * 0.5 + 0.5) * this.cameraDebugCanvas.width;
                const y = (-vector.y * 0.5 + 0.5) * this.cameraDebugCanvas.height;
                
                if (x >= 0 && x <= this.cameraDebugCanvas.width && y >= 0 && y <= this.cameraDebugCanvas.height && vector.z < 1.0 && vector.z > -1.0) {
                    if (!this.cameraDebugTextPositions[i]) {
                        this.cameraDebugTextPositions[i] = { x, y };
                    }
                    const prevPos = this.cameraDebugTextPositions[i];
                    const dx = x - prevPos.x;
                    const dy = y - prevPos.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    if (distance < 100) {
                        const smoothX = prevPos.x * 0.3 + x * 0.7;
                        const smoothY = prevPos.y * 0.3 + y * 0.7;
                        
                        this.cameraDebugCtx.save();
                        this.cameraDebugCtx.fillStyle = 'white';
                        this.cameraDebugCtx.font = '16px monospace';
                        this.cameraDebugCtx.textAlign = 'center';
                        this.cameraDebugCtx.textBaseline = 'bottom';
                        
                        const cameraText = `camera #${i + 1}`;
                        const coordText = `(${Math.round(pos.x * 100) / 100}, ${Math.round(pos.y * 100) / 100}, ${Math.round(pos.z * 100) / 100})`;
                        this.cameraDebugCtx.fillText(cameraText, smoothX, smoothY - 80);
                        this.cameraDebugCtx.fillText(coordText, smoothX, smoothY - 60);
                        
                        this.cameraDebugCtx.restore();
                        
                        this.cameraDebugTextPositions[i] = { x: smoothX, y: smoothY };
                    } else {
                        this.cameraDebugTextPositions[i] = { x, y };
                    }
                }
            }
        }
        
        this.cameraDebugGroup.visible = true;
    }
    
    cleanupSceneSpecificElements() {
        // シーン固有の要素をクリーンアップ
        if (this.impulseIndicators) {
            this.impulseIndicators.forEach((ind) => {
                if (ind.circleGroup) ind.circleGroup.visible = false;
                if (ind.sphereGroup) ind.sphereGroup.visible = false;
            });
        }
    }
    
    dispose() {
        // Canvasを削除
        if (this.cameraDebugCanvas && this.cameraDebugCanvas.parentElement) {
            this.cameraDebugCanvas.parentElement.removeChild(this.cameraDebugCanvas);
        }
        if (this.impulseCanvas && this.impulseCanvas.parentElement) {
            this.impulseCanvas.parentElement.removeChild(this.impulseCanvas);
        }
        
        // ポストプロセッシングを破棄
        if (this.postProcessing) {
            this.postProcessing.dispose();
        }
        
        super.dispose();
    }
}
