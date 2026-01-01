/**
 * Scene02 (WebGPU): Simple Curl Noise Particle System
 * - シンプルに初期値が球体のGPGPUパーティクル
 * - 150万粒程度
 * - カールノイズで適当に動かす
 * - 各パーティクルは疑似sphereにして、疑似ライティングも実装
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import hdri from '../../assets/autumn_field_puresky_1k.hdr';
import { clamp, max, pow, abs, attribute } from "three/tsl";
import { SimpleParticleSystem } from './SimpleParticleSystem.js';
import { GridRuler3D } from '../../lib/GridRuler3D.js';
import { RandomLFO } from '../../lib/RandomLFO.js';
import { conf } from '../../common/conf.js';
import { loadHdrCached } from '../../lib/hdrCache.js';
import { CameraMode } from '../../lib/CameraParticle.js';

export class Scene02 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | Scene02 - Curl Noise Particles';
        
        this.sharedResourceManager = sharedResourceManager;
        
        // カメラパーティクル設定
        this.cameraParticles = [];
        this.currentCameraIndex = 0;
        this.cameraCenter = new THREE.Vector3(0, 0, 0);
        this.currentBar = 0;
        this.lastForceRandomizedBar = 0;
        
        // トラックのON/OFF
        this.trackEffects = {
            1: true,   // camera randomize
            2: true,   // invert
            3: true,   // chroma
            4: true,   // glitch
            5: true,   // シーン固有の処理
            6: false,
            7: false,
            8: false,  // 触手エフェクト（削除）
            9: false,
        };

        // 表示
        this.SHOW_PARTICLES = true;
        
        // 3Dオブジェクトとしてのグリッド＋ルーラー（遮蔽が効く）
        this.SHOW_WORLD_GRID = true; // gキーのデフォルトON
        this.worldGrid = null;
        this.boundaryBox = null;

        // ===== RandomLFO（シーンの“ゆれ”）=====
        this.yureLFO = {
            noiseScale: null,
            heightAmp: null,
            noiseSpeed: null
        };

        // モード切替（フラグ式）
        // - ノイズは無効化（Track5の圧力のみ使用）
        // - 圧力モードをデフォルトON
        this.ENABLE_YURE_LFO = false;
        this.ENABLE_PRESSURE = true;
        // ノイズモード（球面固定/球面を流す）
        this.ENABLE_FLOW_ON_SPHERE = false;

        // Track5: 内側からの圧力パルス（前回からの間隔で"遠い方向"を引きやすく）
        this._lastPressureMs = 0;
        this._lastPressureDir = null; // THREE.Vector3
        // モード7（フォロー）の注視点更新用：最後に更新した時刻
        this._lastFollowTargetUpdateMs = 0;
        
        // Track5インパルス表示用
        this.impulseIndicators = [];
        this.impulseCanvas = null;
        this.impulseCtx = null;
        
        // ===== トラックオブジェクト（シーン3風） =====
        // ノイズシード
        this._noiseSeed = Math.random() * 1000;
        
        // トラックごとのInstancedMesh
        this.trackObjects = {
            track1: null, // トーラス
            track2: null, // ボックス
            track3: null, // 円柱+サークル
            track4: null  // 金属片
        };
        
        // トラックごとのデータ配列
        this.trackData = {
            track1: { instances: [], maxCount: 50 },
            track2: { instances: [], maxCount: 50 },
            track3: { instances: [], maxCount: 50 },
            track4: { instances: [], maxCount: 50 }
        };
    }
    
    async setup() {
        await super.setup();
        
        // スクリーンショット用テキストを設定
        this.setScreenshotText(this.title);
        
        // カメラ設定
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
        this.camera.position.set(0, 0, 2);
        this.camera.updateProjectionMatrix();
        
        // シーン設定
        this.scene = new THREE.Scene();
        this.overlayScene = new THREE.Scene();
        this.overlayScene.background = null;
        
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, 0, 0);
        this.controls.enableDamping = true;
        this.controls.enablePan = false;
        this.controls.maxDistance = 5.0;
        this.controls.minDistance = 0.5;
        this.controls.enabled = false;

        // HDRテクスチャを読み込み（キャッシュ）→ 共通適用
        const hdriTexture = await loadHdrCached(hdri);
        this.applyHdriEnvironment(hdriTexture);
        
        // シーン固有のシャドウ設定（conf.jsに依存せず、シーンごとに独立）
        // Scene02: シャドウ有効（パーティクルシステムで影が重要）
        this._shadowMapEnabled = true;
        this._shadowMapType = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.enabled = this._shadowMapEnabled;
        this.renderer.shadowMap.type = this._shadowMapType;
        
        // パーティクルシステムを初期化
        this.particleSystem = new SimpleParticleSystem(this.renderer);
        await this.particleSystem.init();
        this.scene.add(this.particleSystem.object);
        this.particleSystem.object.visible = !!this.SHOW_PARTICLES;
        this.particleSystem.computeEnabled = !!this.SHOW_PARTICLES;

        // NOTE: 塗りは撤去（ユーザー要望）

        // ===== RandomLFOでノイズパラメータをゆっくり揺らす =====
        // - noiseScale: 最小をもっと小さく（粗い→細かいのレンジを広げる）、最大は現状キープ
        // - heightAmp: 最大をもっと強く（盛り上がりMAXを上げる）
        // - LFO自体の周波数: 少しだけゆっくりに（rateレンジを下げる）
        const lfoMinRate = 0.0006;
        // 周期側の最大スピードが早すぎるので抑える
        const lfoMaxRate = 0.0025;
        this.yureLFO.noiseScale = new RandomLFO(lfoMinRate, lfoMaxRate, 0.55, 3.6);
        this.yureLFO.heightAmp = new RandomLFO(lfoMinRate, lfoMaxRate, 0.24, 0.92);
        this.yureLFO.noiseSpeed = new RandomLFO(lfoMinRate, lfoMaxRate, 0.010, 0.060);
        
        // actual_tickで変化させるための初期値保存
        this._lfoInitialParams = {
            noiseScale: {
                minRate: lfoMinRate,
                maxRate: lfoMaxRate,
                minValue: 0.55,
                maxValue: 3.6
            },
            heightAmp: {
                minRate: lfoMinRate,
                maxRate: lfoMaxRate,
                minValue: 0.24,
                maxValue: 0.92
            },
            noiseSpeed: {
                minRate: lfoMinRate,
                maxRate: lfoMaxRate,
                minValue: 0.010,
                maxValue: 0.060
            }
        };
        
        // actual_tickの最大値（100小節 = 96 tick * 4拍 * 100小節 = 38400 tick）
        // デフォルトは100小節分
        this._tickMaxTicks = 38400;

        // ノイズを物凄く薄く掛ける（heightAmpを非常に小さい値に設定）
        this.particleSystem.uniforms.heightAmp.value = 0.03; // 物凄く薄いノイズ
        
        // NOTE: ENABLE_YURE_LFO が true のときだけuniformへ反映する（現在は無効化）
        if (this.ENABLE_YURE_LFO) {
            this.yureLFO.noiseScale.update(1 / 60);
            this.yureLFO.heightAmp.update(1 / 60);
            this.yureLFO.noiseSpeed.update(1 / 60);
            this.particleSystem.uniforms.noiseScale.value = this.yureLFO.noiseScale.getValue();
            this.particleSystem.uniforms.heightAmp.value = this.yureLFO.heightAmp.getValue();
            this.particleSystem.uniforms.noiseSpeed.value = this.yureLFO.noiseSpeed.getValue();
        }

        // ノイズモード初期反映
        if (this.particleSystem?.uniforms?.flowOnSphereEnabled) {
            this.particleSystem.uniforms.flowOnSphereEnabled.value = this.ENABLE_FLOW_ON_SPHERE ? 1.0 : 0.0;
        }

        // 圧力モードはデフォOFF（GPU側も軽量化）
        if (this.particleSystem?.setPressureModeEnabled) {
            this.particleSystem.setPressureModeEnabled(!!this.ENABLE_PRESSURE);
        }

        // ===== CameraParticle（Track1 / barでランダム化）=====
        // NOTE:
        // - 粒子の半径が確定してから（uniform反映後）カメラ範囲を決める
        // - 近づき過ぎると疑似sphereの粗が見えるので、距離は“遠め”に固定
        const { CameraParticle } = await import('../../lib/CameraParticle.js');
        this.cameraParticles = [];
        this.currentCameraIndex = 0;
        this.cameraCenter = this.controls.target.clone();

        const baseR_cam = Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.1);
        const ampR_cam = Number(this.particleSystem?.uniforms?.heightAmp?.value ?? 0.38);
        const rMax_cam = Math.max(0.2, baseR_cam + ampR_cam);

        // Scene01と同じ方式：CameraParticleを「箱の中」で泳がせる（距離クランプはしない）
        // NOTE:
        // カメラ用のBox（サイドパンとオービット用に広く）
        const camBoxSizeX = rMax_cam * 8.0; // X方向を大きく（サイドパン用）
        const camBoxSizeY = rMax_cam * 8.0; // Y方向を大きく（オービット用）
        const camBoxSizeZ = rMax_cam * 8.0; // Z方向を大きく（オービット用）
        const camBoxZCenter = rMax_cam * 3.0; // Z中心をプラス方向にシフト
        const boxMin = new THREE.Vector3(
            -camBoxSizeX / 2,
            -camBoxSizeY / 2,
            camBoxZCenter - camBoxSizeZ / 2
        );
        const boxMax = new THREE.Vector3(
            camBoxSizeX / 2,
            camBoxSizeY / 2,
            camBoxZCenter + camBoxSizeZ / 2
        );
        // 念のため：球の中へ入らない最小距離（ワールド）
        // カメラを離すために、最小距離も大きくする
        this.cameraMinDistanceWorld = rMax_cam * 1.50;

        // カメラモード用の状態管理（_setupCameraModeより前に初期化）
        this.cameraModeState = {
            sidePanDirection: Math.random() > 0.5 ? 1 : -1, // 左→右 or 右→左
            sidePanSpeed: 0.02,
            orbitAngle: 0, // 初期角度（_setupCameraModeでランダムに設定される）
            orbitRadius: rMax_cam * 2.8,
            orbitSpeed: 0.0008, // 回転速度を弱く（0.01 → 0.0008）
            followTarget: new THREE.Vector3(0, 0, 0),
            followLerp: 0.05, // 追従の遅延
            offCenterOffset: new THREE.Vector3(
                (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 0.3,
                0
            )
        };

        // カメラモード定義
        const cameraModes = [
            { name: 'frontWide', mode: 0 },      // ① フロント・ワイド
            { name: 'frontMedium', mode: 1 },   // ② フロント・ミディアム
            { name: 'closeup', mode: 2 },       // ③ クローズアップ
            { name: 'sidePan', mode: 3 },       // ④ サイド・パン
            { name: 'offCenter', mode: 4 },     // ⑤ オフセンター固定
            { name: 'slowOrbit', mode: 5 },     // ⑥ スロー・オービット
            { name: 'follow', mode: 6 },        // ⑦ フォロー
            { name: 'still', mode: 7 }           // ⑧ 静止ショット
        ];

        // 各モード用のCameraParticleを作成
        for (let i = 0; i < 8; i++) {
            const cp = new CameraParticle();
            const modeInfo = cameraModes[i];
            cp.cameraMode = modeInfo.mode;
            cp.modeName = modeInfo.name;
            
            // モードに応じた初期設定
            cp.setupCameraMode(modeInfo.mode, rMax_cam, boxMin, boxMax);
            
            this.cameraParticles.push(cp);
        }

        // カメラパーティクルの可視化（c/C）を共通化：SceneBase側で描画
        this.initCameraDebug(this.overlayScene);
        
        // カメラパーティクル用のライトを追加
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        this.scene.add(directionalLight);

        // 初期フレームで球体内部に入らないよう、初期カメラ位置も外へ
        const cp0 = this.cameraParticles[0];
        if (cp0) {
            const p0 = cp0.getPosition().clone().add(this.cameraCenter);
            this.camera.position.copy(p0);
            this.camera.lookAt(this.cameraCenter);
        }
        
        // ===== 床グリッド（Scene01と同系統に統一） =====
        // Scene02は球体なので、球を収めるBoxを仮定して床を作る
        const baseR_grid = Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 0.75);
        const ampR_grid = Number(this.particleSystem?.uniforms?.heightAmp?.value ?? 0.28);
        const rMax_grid = Math.max(0.2, baseR_grid + ampR_grid);
        const boxSize = rMax_grid * 2.6; // 少し余白
        const boxCenterX = 0.0;
        const boxCenterY = 0.0;
        const boxCenterZ = 0.0;
        const boxSizeX = boxSize;
        const boxSizeY = boxSize;
        const boxSizeZ = boxSize;
        const floorY = -rMax_grid - 0.002;
        // Scene01 と同じスケール感に寄せる（赤い十字/ラベルは labelMax=64 前提）
        const floorSize = boxSize * 2.2;

        this.worldGrid = new GridRuler3D();
        this.worldGrid.init({
            center: { x: boxCenterX, y: boxCenterY, z: boxCenterZ },
            size: { x: boxSizeX, y: boxSizeY, z: boxSizeZ },
            floorSize,
            floorY,
            color: 0xffffff,
            opacity: 0.25
        });
        this.worldGrid.setVisible(this.SHOW_WORLD_GRID);
        this.scene.add(this.worldGrid.group);

        // 境界Box
        // NOTE:
        // overlayScene に入れると「常に最前面合成」になって球体に隠れない。
        // → scene 側に置いて depthTest で隠れるようにする。
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
        this.scene.add(boxWireframe);
        this.boundaryBox = boxWireframe;

        // ポストFX（共通）
        this.initPostFX();
        
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

    // ===== ノイズ関数（シーン3と同じ） =====
    _hash11(n) {
        const x = Math.sin(n * 127.1 + this._noiseSeed * 0.17) * 43758.5453123;
        return x - Math.floor(x);
    }
    
    _noise1D(x) {
        const i = Math.floor(x);
        const f = x - i;
        const a = this._hash11(i);
        const b = this._hash11(i + 1);
        const u = f * f * (3.0 - 2.0 * f);
        return a * (1.0 - u) + b * u;
    }
    
    /**
     * トラックオブジェクトの初期化
     */
    _initTrackObjects() {
        const dummy = new THREE.Object3D();
        
        // マテリアル
        const matMetal = new THREE.MeshStandardMaterial({
            color: 0x222222,
            metalness: 0.9,
            roughness: 0.2
        });
        
        const matAccent = new THREE.MeshStandardMaterial({
            color: 0xccaa66,
            metalness: 0.8,
            roughness: 0.3
        });
        
        // Track1: トーラス
        const torusGeom = new THREE.TorusGeometry(0.05, 0.02, 16, 32);
        this.trackObjects.track1 = new THREE.InstancedMesh(
            torusGeom,
            matMetal,
            this.trackData.track1.maxCount
        );
        this.trackObjects.track1.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.trackObjects.track1.castShadow = true;
        this.trackObjects.track1.receiveShadow = true;
        this.trackObjects.track1.frustumCulled = false;
        
        // 初期化（見えない位置に配置）
        dummy.position.set(0, 0, -9999);
        dummy.updateMatrix();
        for (let i = 0; i < this.trackData.track1.maxCount; i++) {
            this.trackObjects.track1.setMatrixAt(i, dummy.matrix);
            this.trackData.track1.instances[i] = { active: false };
        }
        this.trackObjects.track1.instanceMatrix.needsUpdate = true;
        this.scene.add(this.trackObjects.track1);
        
        // Track2: ボックス
        const boxGeom = new THREE.BoxGeometry(0.08, 0.08, 0.08);
        this.trackObjects.track2 = new THREE.InstancedMesh(
            boxGeom,
            matAccent,
            this.trackData.track2.maxCount
        );
        this.trackObjects.track2.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.trackObjects.track2.castShadow = true;
        this.trackObjects.track2.receiveShadow = true;
        this.trackObjects.track2.frustumCulled = false;
        
        for (let i = 0; i < this.trackData.track2.maxCount; i++) {
            this.trackObjects.track2.setMatrixAt(i, dummy.matrix);
            this.trackData.track2.instances[i] = { active: false };
        }
        this.trackObjects.track2.instanceMatrix.needsUpdate = true;
        this.scene.add(this.trackObjects.track2);
        
        // Track3: 円柱（シンプル版）
        const cylGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.15, 16);
        this.trackObjects.track3 = new THREE.InstancedMesh(
            cylGeom,
            matMetal,
            this.trackData.track3.maxCount
        );
        this.trackObjects.track3.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.trackObjects.track3.castShadow = true;
        this.trackObjects.track3.receiveShadow = true;
        this.trackObjects.track3.frustumCulled = false;
        
        for (let i = 0; i < this.trackData.track3.maxCount; i++) {
            this.trackObjects.track3.setMatrixAt(i, dummy.matrix);
            this.trackData.track3.instances[i] = { active: false };
        }
        this.trackObjects.track3.instanceMatrix.needsUpdate = true;
        this.scene.add(this.trackObjects.track3);
        
        // Track4: 金属片（円柱の一部）- 小さめ
        const shardGeom = new THREE.CylinderGeometry(
            0.03, 0.03, 0.08, 24, 1, true, 0, Math.PI * 0.6
        );
        shardGeom.rotateY(Math.PI * 0.1);
        this.trackObjects.track4 = new THREE.InstancedMesh(
            shardGeom,
            matMetal,
            this.trackData.track4.maxCount
        );
        this.trackObjects.track4.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.trackObjects.track4.castShadow = true;
        this.trackObjects.track4.receiveShadow = true;
        this.trackObjects.track4.frustumCulled = false;
        
        for (let i = 0; i < this.trackData.track4.maxCount; i++) {
            this.trackObjects.track4.setMatrixAt(i, dummy.matrix);
            this.trackData.track4.instances[i] = { active: false };
        }
        this.trackObjects.track4.instanceMatrix.needsUpdate = true;
        this.scene.add(this.trackObjects.track4);
        
        console.log('Scene02: トラックオブジェクト初期化完了');
    }
    
    /**
     * SceneManager から呼ばれる：リソースの有効/無効（ライブ用途：disposeはしない）
     */
    setResourceActive(active) {
        this._resourceActive = !!active;
        if (this.particleSystem) {
            // 非アクティブ時は計算も描画も止める（常駐は維持）
            this.particleSystem.computeEnabled = this._resourceActive && !!this.SHOW_PARTICLES;
            this.particleSystem.object.visible = this._resourceActive && !!this.SHOW_PARTICLES;
        }
    }
    
    onUpdate(deltaTime) {
        // ノイズを物凄く薄く掛ける（heightAmpを非常に小さい値に保つ）
        if (this.particleSystem) {
            this.particleSystem.uniforms.heightAmp.value = 0.03; // 物凄く薄いノイズ
        }
        
        // ===== “ゆれ”更新（RandomLFO / 無効化）=====
        if (this.ENABLE_YURE_LFO && this.particleSystem && this.yureLFO?.noiseScale) {
            // deltaTimeはLFO内部で60fps基準処理だが、APIとして渡しておく
            const dt = (!deltaTime || deltaTime <= 0 || !isFinite(deltaTime)) ? (1 / 60) : deltaTime;
            this.yureLFO.noiseScale.update(dt);
            this.yureLFO.heightAmp.update(dt);
            this.yureLFO.noiseSpeed.update(dt);

            this.particleSystem.uniforms.noiseScale.value = this.yureLFO.noiseScale.getValue();
            this.particleSystem.uniforms.heightAmp.value = this.yureLFO.heightAmp.getValue();
            this.particleSystem.uniforms.noiseSpeed.value = this.yureLFO.noiseSpeed.getValue();
        }

        // パーティクルシステムの更新
        if (this.particleSystem) {
            this.particleSystem.update(deltaTime, this.time);
        }
        
        // Track5インパルス表示の更新
        if (this.updateImpulseIndicator) {
            this.updateImpulseIndicator();
        }

        // NOTE: 塗りは撤去（ユーザー要望）

        // ===== CameraParticle update（モード別処理） =====
        // Scene02では1小節ごとのランダマイズのみ使用（Track1の力は加えない）
        this.cameraParticles.forEach((cp, idx) => {
            // モード別の動作は有効化
            cp.enableMovement = true;
            
            // 現在アクティブなカメラのみ、モード別の力を加える
            if (idx === this.currentCameraIndex) {
                const rMax = Math.max(0.2, (Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0) + Number(this.particleSystem?.uniforms?.heightAmp?.value ?? 0.03)));
                
                
                // スローオービットの場合は、updateCameraModeで位置を直接設定するので、update()をスキップ
                if (cp.cameraMode === 5) { // CameraMode.SLOW_ORBIT
                    cp.updateCameraMode(deltaTime, rMax);
                    // update()は呼ばない（位置が上書きされるため）
                } else {
                    // 通常のモードは、update()してからupdateCameraMode()
                    cp.update();
                    cp.updateCameraMode(deltaTime, rMax);
                }
            } else {
                // 非アクティブなカメラは通常のupdate()のみ
                cp.update();
            }
        });

        const cp = this.cameraParticles[this.currentCameraIndex];
        if (cp) {
            const cameraPos = this._getCameraPositionForMode(cp);
            const lookAtTarget = this._getLookAtTargetForMode(cp);
            
            // Scene02だけ：球体内部に入らないよう最小距離でクランプ
            // ただし、サイドパンとスローオービットは除外（自由に動かす）
            if (this.cameraMinDistanceWorld !== undefined && cp.cameraMode !== 3 && cp.cameraMode !== 5) {
                const d = cameraPos.length();
                if (d > 0 && d < this.cameraMinDistanceWorld) {
                    cameraPos.multiplyScalar(this.cameraMinDistanceWorld / d);
                }
            }
            
            this.camera.position.copy(cameraPos);
            this.camera.lookAt(lookAtTarget);
            this.camera.matrixWorldNeedsUpdate = false;
            
        }

        // カメラパーティクルの可視化メッシュを更新
        this.cameraParticles.forEach((cp) => {
            if (cp.visualMesh) {
                cp.visualMesh.position.copy(cp.position);
                cp.visualMesh.visible = this.SHOW_CAMERA_PARTICLES;
            }
        });
        
        // 3Dグリッドのラベルをカメラに向ける & 表示トグル反映
        if (this.worldGrid) {
            this.worldGrid.setVisible(this.SHOW_WORLD_GRID);
            this.worldGrid.update(this.camera);
        }
        
        // 共通：FX更新（track2-4 + duration）
        this.updatePostFX();
    }
    
    async render() {
        // 初期化が完了しているかチェック
        if (!this.particleSystem || !this.postProcessing) {
            return;
        }
        // ポストプロセッシング描画（Scene01と同じ）
        try {
            await this.postProcessing.renderAsync();
        } catch (err) {
            // WebGPU のノード管理エラーをログに出力して確認
            console.error('Scene02 renderエラー:', err);
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
                hudData.currentCameraIndex || 0,
                hudData.cameraPosition || new THREE.Vector3(),
                0,
                this.time,
                0,
                0,
                0,
                0,
                hudData.isInverted || false,
                this.oscStatus,
                hudData.particleCount || this.particleSystem.numParticles,
                hudData.trackEffects || this.trackEffects,
                this.phase,
                hudData.hudScales,
                null,
                hudData.currentBar || 0,
                hudData.debugText || '',
                this.actualTick || 0,
                hudData.cameraModeName || null
            );
        }
        
        // スクリーンショットテキストを描画
        this.drawScreenshotText();
    }
    
    getHUDData() {
        const cp = this.cameraParticles?.[this.currentCameraIndex];
        const cameraPos = cp ? cp.getPosition().clone().add(this.cameraCenter) : this.camera.position.clone();
        const distance = cameraPos.length();
        const distToTarget = cp ? cp.getPosition().length() : distance;
        const rotationX = cp ? cp.getRotationX() : 0;
        const rotationY = cp ? cp.getRotationY() : 0;
        const isInverted = this.fxUniforms && this.fxUniforms.invert ? this.fxUniforms.invert.value > 0.0 : false;
        const updateMode = (this.particleSystem?.updateStride >= 2) ? 'HALF' : 'FULL';
        const noiseMode = (this.ENABLE_FLOW_ON_SPHERE ? 'FLOW' : 'SPHERE');
        const debugText = `UPDATE:${updateMode}  NOISE:${noiseMode}  PRESS:${this.ENABLE_PRESSURE ? 'ON' : 'OFF'}  LFO:${this.ENABLE_YURE_LFO ? 'ON' : 'OFF'}`;
        
        // カメラモード名を取得
        const cameraModeName = cp?.modeName || 'unknown';

        return {
            currentCameraIndex: this.currentCameraIndex,
            cameraModeName: cameraModeName,
            cameraPosition: cameraPos,
            rotationX,
            rotationY,
            distance,
            trackEffects: this.trackEffects,
            isInverted,
            currentBar: this.currentBar || 0,
            debugText,
            hudScales: {
                distToTarget,
                fovDeg: this.camera?.fov ?? 60,
                cameraY: cameraPos.y
            },
            time: this.time,
            particleCount: this.particleSystem?.numParticles || 0
        };
    }
    
    handleTrackNumber(trackNumber, message) {
        const args = message.args || [];
        const noteNumber = Number(args[0] ?? 64);
        const velocity = Number(args[1] ?? 127);
        const durationMs = Number(args[2] ?? 0);
        
        if (trackNumber === 1) {
            // Track1: エフェクトなし（削除）
        } else if (trackNumber === 2) {
            this.applyTrack2Invert(velocity, durationMs);
        } else if (trackNumber === 3) {
            this.applyTrack3Chromatic(velocity, durationMs);
        } else if (trackNumber === 4) {
            this.applyTrack4Glitch(velocity, durationMs);
        } else if (trackNumber === 5) {
            this.applyTrack5Pressure(noteNumber, velocity, durationMs);
        }
    }
    
    /**
     * トラックオブジェクトの寿命管理
     */
    _updateTrackObjects() {
        // 寿命管理を無効化（常に表示）
        // NOTE: 必要に応じて有効化できる
        return;
        
        const now = performance.now();
        const dummy = new THREE.Object3D();
        dummy.position.set(0, 0, -9999); // 見えない位置
        dummy.updateMatrix();
        
        // 各トラックのオブジェクトをチェック
        for (const trackKey in this.trackData) {
            const trackData = this.trackData[trackKey];
            const trackObj = this.trackObjects[trackKey];
            if (!trackData || !trackObj) continue;
            
            let needsUpdate = false;
            for (let i = 0; i < trackData.maxCount; i++) {
                const inst = trackData.instances[i];
                if (!inst.active) continue;
                
                const elapsed = now - inst.startMs;
                if (elapsed >= inst.durationMs) {
                    // 寿命切れ：非表示にする
                    trackObj.setMatrixAt(i, dummy.matrix);
                    inst.active = false;
                    needsUpdate = true;
                }
            }
            
            if (needsUpdate) {
                trackObj.instanceMatrix.needsUpdate = true;
            }
        }
    }
    
    /**
     * トラックオブジェクトを生成
     * @param {string} trackKey - 'track1', 'track2', 'track3', 'track4'
     * @param {number} noteNumber - MIDIノート番号
     * @param {number} velocity - ベロシティ
     * @param {number} durationMs - 持続時間
     */
    _spawnTrackObject(trackKey, noteNumber = 64, velocity = 96, durationMs = 420) {
        const trackData = this.trackData[trackKey];
        const trackObj = this.trackObjects[trackKey];
        if (!trackData || !trackObj) return;
        
        // 空きスロットを探す
        let idx = -1;
        for (let i = 0; i < trackData.maxCount; i++) {
            if (!trackData.instances[i].active) {
                idx = i;
                break;
            }
        }
        if (idx === -1) {
            // 空きがない場合は最も古いものを上書き
            idx = 0;
        }
        
        const v01 = Math.min(Math.max(velocity / 127, 0), 1);
        const n01 = Math.min(Math.max(noteNumber / 127, 0), 1);
        
        // パーティクルシステムの基準半径を取得
        const baseRadius = this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0;
        const heightAmp = this.particleSystem?.uniforms?.heightAmp?.value ?? 0.03;
        const rMax = baseRadius + heightAmp;
        
        // ノイズベースの球面座標を生成
        const tick = performance.now() * 0.001; // 時間ベースのノイズ
        const u = tick * 0.01 + n01 * 10.0 + idx * 3.0;
        const v = tick * 0.008 + v01 * 7.0 + idx * 5.0;
        
        // 経度・緯度をノイズで決定
        const longitude = this._noise1D(u) * Math.PI * 2;
        const latitude = (this._noise1D(v) * 0.5 + 0.25) * Math.PI; // 45°～135°の範囲
        
        // 球面座標から3D座標に変換
        // パーティクルの表面に配置（rMaxを使用）
        const r = rMax * (1.0 + 0.1 * v01); // velocityで少し外側に
        const x = r * Math.sin(latitude) * Math.cos(longitude);
        const y = r * Math.cos(latitude);
        const z = r * Math.sin(latitude) * Math.sin(longitude);
        
        // サイズをvelocityで変化
        const scale = (0.5 + 1.5 * v01) * (0.85 + 0.3 * Math.random());
        
        // 球面の法線方向（中心から外側）に向ける
        const normal = new THREE.Vector3(x, y, z).normalize();
        
        // インスタンスデータを更新
        const dummy = new THREE.Object3D();
        dummy.position.set(x, y, z);
        
        // 法線方向にY軸を向ける（円柱が生える方向）
        // quaternionを使って法線方向にY軸を向ける
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(up, normal);
        dummy.quaternion.copy(quaternion);
        
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        
        trackObj.setMatrixAt(idx, dummy.matrix);
        trackObj.instanceMatrix.needsUpdate = true;
        
        // データを記録
        trackData.instances[idx] = {
            active: true,
            startMs: performance.now(),
            durationMs: durationMs,
            position: new THREE.Vector3(x, y, z),
            scale: scale
        };
    }

    /**
     * Track5: 球体マッピング上の「高さ」変動（ノイズの代わり）
     * - ランダムな方向に対して圧力を加えて、球体の高さ（半径）を変動させる
     * - velocityで強さを変える
     * - ノイズで掛けていた部分をTrack5で制御
     * - 前回のシーケンスと近ければ近い場所に、遠ければ遠い場所にランダムになる
     */
    applyTrack5Pressure(noteNumber, velocity, durationMs) {
        if (!this.trackEffects?.[5]) return;
        if (!this.particleSystem) return;

        // 圧力モードを有効化（Track5が来た時に自動でON）
        if (!this.ENABLE_PRESSURE) {
            this.ENABLE_PRESSURE = true;
            if (this.particleSystem?.setPressureModeEnabled) {
                this.particleSystem.setPressureModeEnabled(true);
            }
        }

        const now = performance.now();
        const gapMs = this._lastPressureMs > 0 ? (now - this._lastPressureMs) : 9999;
        this._lastPressureMs = now;

        const v01 = Math.min(Math.max((Number(velocity) || 0) / 127, 0), 1);
        const gap01 = Math.min(Math.max(gapMs / 1500, 0), 1); // 0..1（1.5sで最大）

        // ランダムな方向（球面上のランダムな点）を生成
        const theta = Math.random() * Math.PI * 2; // 0..2π
        const phi = Math.acos(2 * Math.random() - 1); // 0..π
        const base = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
        ).normalize();

        // gapが小さい（前回と近い）ほど「前回と近い方向」に、大きい（前回と遠い）ほど「前回と遠い方向（反対寄り）」に寄せる
        let dir = base;
        if (this._lastPressureDir) {
            // gap01が小さい（0に近い）→ 前回の方向に近づける
            // gap01が大きい（1に近い）→ 前回の反対方向に寄せる
            const far = this._lastPressureDir.clone().multiplyScalar(-1);
            // gap01が小さいほど base（ランダム）に近く、大きいほど far（反対）に近づく
            // でも、ユーザーの要望は「近ければ近い場所に」なので、gap01が小さいほど前回に近づける
            const lerpFactor = 1.0 - gap01; // gap01が小さい（0）→ lerpFactorが大きい（1）→ 前回に近い
            dir = base.clone().lerp(this._lastPressureDir, lerpFactor * 0.7).normalize();
        }
        this._lastPressureDir = dir.clone();

        // 強さ（velocity依存 + ランダム）
        // ノイズの代わりなので、もっと弱めに調整
        const randMul = 0.7 + Math.random() * 0.6; // 0.7..1.3
        const strength = (0.02 + 0.10 * Math.pow(v01, 1.2)) * randMul; // さらに弱める（約半分）

        // 範囲（角度）：velocity高いほど絞る、ランダム要素も追加
        const baseAngle = 0.8 - 0.5 * v01; // 0.3..0.8 rad
        const angle = baseAngle + (Math.random() - 0.5) * 0.2; // ±0.1 rad のランダム

        // 速度上限も velocity に合わせて上げる（弱めに調整）
        const velMax = (0.4 + 0.9 * Math.pow(v01, 1.1)) * (0.85 + Math.random() * 0.3);
        // 上限の高さを無効化（非常に大きな値に設定）
        const offsetMax = 999999.0; // 実質的に上限なし
        this.particleSystem.setPressureTuning({ velMax, offsetMax });

        // 永続圧力（粒子offsetVelへインパルス→offsetへ積分）
        // これが球体マッピング上の「高さ」変動になる
        this.particleSystem.applyPressure(dir, strength, angle);
        
        // Circleエフェクトとテキスト、赤いsphereを表示
        const baseR = Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.1);
        const posWorld = dir.clone().multiplyScalar(baseR);
        this.triggerImpulseIndicator({
            dir: dir.clone(),
            posWorld: posWorld,
            strength: strength,
            angle: angle,
            velocity: velocity
        });
        
        // モード7（フォロー）の注視点を更新（1秒以内の連続したイベントは無視）
        const nowForFollow = performance.now();
        const gapFollowMs = nowForFollow - this._lastFollowTargetUpdateMs;
        if (gapFollowMs >= 1000) { // 1秒以上経過している場合のみ更新
            const followCp = this.cameraParticles.find(cp => cp.cameraMode === 6);
            if (followCp && followCp._followTarget) {
                followCp._followTarget.copy(posWorld);
                this._lastFollowTargetUpdateMs = nowForFollow;
            }
        }
    }
    
    // ===== Track5 indicator =====
    initImpulseIndicator() {
        const max = 8; // 最大8個のインパルスを同時表示
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
                radiusWorld: 0.1,
                dir: new THREE.Vector3(),
                posWorld: new THREE.Vector3(),
                circleGroup,
                sphereGroup,
                sphere,
                circle,
                edges
            });
        }
    }
    
    triggerImpulseIndicator(info) {
        // 使用可能なスロットを探す
        let slot = -1;
        for (let i = 0; i < this.impulseIndicators.length; i++) {
            if (!this.impulseIndicators[i].active) {
                slot = i;
                break;
            }
        }
        if (slot < 0) {
            // すべて使用中なら最初のスロットを使う
            slot = 0;
        }
        
        const ind = this.impulseIndicators[slot];
        if (!ind) return;
        
        ind.active = true;
        ind.startMs = Date.now();
        ind.endMs = ind.startMs + 400; // 400ms表示
        ind.maxStrength = Math.max(0.0001, info?.strength ?? 1.0);
        ind.radiusWorld = (info?.angle ?? 0.5) * (info?.posWorld?.length() ?? 1.0) * 0.3;
        ind.dir.copy(info?.dir ?? new THREE.Vector3(0, 0, 1));
        ind.posWorld.copy(info?.posWorld ?? new THREE.Vector3(0, 0, 1));
        
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
            
            const strength01 = Math.min(1, Math.max(0, ind.maxStrength / 1.0));
            
            const s = 0.75 + strength01 * 0.65;
            ind.sphere.scale.set(s, s, s);
            
            const radiusWorld = ind.radiusWorld * (0.6 + 0.9 * t);
            ind.circle.scale.set(radiusWorld, radiusWorld, 1);
            ind.circle.material.opacity = alpha * 0.22;
            ind.edges.scale.set(radiusWorld, radiusWorld, 1);
            ind.edges.material.opacity = alpha * 0.8;
            
            // Circleを画面（カメラ）に対して平行にする（Scene01と同じ）
            // カメラの向きに合わせて回転
            ind.circleGroup.lookAt(ind.circleGroup.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3())));
            
            // テキスト表示
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
                    
                    const dirText = `Dir: (${ind.dir.x.toFixed(2)}, ${ind.dir.y.toFixed(2)}, ${ind.dir.z.toFixed(2)})`;
                    const strengthText = `Strength: ${ind.maxStrength.toFixed(2)}`;
                    const radiusText = `Radius: ${ind.radiusWorld.toFixed(2)}`;
                    
                    this.impulseCtx.globalAlpha = alpha;
                    this.impulseCtx.fillText(dirText, x, y);
                    this.impulseCtx.fillText(strengthText, x, y + 24);
                    this.impulseCtx.fillText(radiusText, x, y + 48);
                    this.impulseCtx.restore();
                }
            }
        }
    }

    switchCameraRandom() {
        if (!this.trackEffects[1]) return;
        if (!this.cameraParticles?.length) return;
        let newIndex = this.currentCameraIndex;
        while (newIndex === this.currentCameraIndex) {
            newIndex = Math.floor(Math.random() * this.cameraParticles.length);
        }
        this.currentCameraIndex = newIndex;
    }
    
    /**
     * カメラモードの初期設定（削除予定 - CameraParticle.setupCameraModeを使用）
     */
    _setupCameraMode_OLD(cp, mode, rMax, boxMin, boxMax) {
        cp.boxMin = boxMin.clone();
        cp.boxMax = boxMax.clone();
        
        // カメラモードを設定（重要！これがないと_updateCameraModeで判定できない）
        cp.cameraMode = mode;
        
        switch (mode) {
            case 0: // ① フロント・ワイド（基準視点）
                cp.maxSpeed = 0.01; // ほぼ固定
                cp.maxForce = 0.005;
                cp.friction = conf.cameraNoDamping ? 0.0 : 0.05; // 強めの減衰
                cp.position.set(0, 0, rMax * 4.5); // もっと引く（3.75 → 4.5）
                cp.desired = cp.position.clone();
                cp.modeName = 'frontWide';
                break;
                
            case 1: // ② フロント・ミディアム
                cp.maxSpeed = 0.03; // 微ドリフト
                cp.maxForce = 0.01;
                cp.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                cp.position.set(0, 0, rMax * 2.0); // 少し近い
                cp.desired = cp.position.clone();
                cp.modeName = 'frontMedium';
                break;
                
            case 2: // ③ クローズアップ
                cp.maxSpeed = 0.05;
                cp.maxForce = 0.02;
                cp.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                // ランダムな方向に近づく（もっと近く）
                const closeupDir = new THREE.Vector3(
                    (Math.random() - 0.5) * 1.0, // 0.5 → 1.0 に変更（注視点をよりランダムに）
                    (Math.random() - 0.5) * 1.0, // 0.5 → 1.0 に変更（注視点をよりランダムに）
                    1
                ).normalize();
                cp.position.copy(closeupDir.multiplyScalar(rMax * 0.5)); // 0.8 → 0.5 に変更（もっと近く）
                cp.desired = cp.position.clone();
                cp.modeName = 'closeup';
                break;
                
            case 3: // ④ サイド・パン
                cp.maxSpeed = 0.12;
                cp.maxForce = 0.08;
                cp.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                // 切り替わった時にランダムで右か左に方向を決める
                this.cameraModeState.sidePanDirection = Math.random() > 0.5 ? 1 : -1;
                // 初期位置は中央付近
                cp.position.set(0, 0, rMax * 2.4);
                cp.desired = cp.position.clone();
                cp.modeName = 'sidePan';
                // 切替時フラグをリセット
                cp._sidePanInitialized = false;
                break;
                
            case 4: // ⑤ オフセンター固定
                cp.maxSpeed = 0.01;
                cp.maxForce = 0.005;
                cp.friction = conf.cameraNoDamping ? 0.0 : 0.05;
                // オフセットを適用した位置に配置
                const offCenterX = this.cameraModeState.offCenterOffset.x * rMax * 2.0;
                const offCenterY = this.cameraModeState.offCenterOffset.y * rMax * 2.0;
                cp.position.set(offCenterX, offCenterY, rMax * 2.4);
                cp.desired = cp.position.clone();
                cp.modeName = 'offCenter';
                break;
                
            case 5: // ⑥ スロー・オービット（球面座標系で動く）
                cp.maxSpeed = 0.15;
                cp.maxForce = 0.08;
                cp.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                
                // 球面座標系の初期化
                // 経度（longitude）: 0～360° をランダムに開始
                this.cameraModeState.orbitLongitude = Math.random() * Math.PI * 2; // 0～2π
                // 緯度（latitude）: 固定（180°固定 = 赤道を通る）+ ランダム角度
                this.cameraModeState.orbitLatitudeBase = Math.PI; // 180° (赤道)
                this.cameraModeState.orbitLatitudeOffset = (Math.random() - 0.5) * Math.PI; // ±90°のランダム角度
                
                const rMax_orbit_init = Math.max(0.2, (Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0) + Number(this.particleSystem?.uniforms?.heightAmp?.value ?? 0.03)));
                const orbitRadius_init = rMax_orbit_init * 2.8; // 球体より少し大きめ
                
                // 球面座標から3D座標に変換
                const lon = this.cameraModeState.orbitLongitude;
                const lat = this.cameraModeState.orbitLatitudeBase + this.cameraModeState.orbitLatitudeOffset;
                
                cp.position.set(
                    orbitRadius_init * Math.sin(lat) * Math.cos(lon), // X
                    orbitRadius_init * Math.cos(lat),                  // Y
                    orbitRadius_init * Math.sin(lat) * Math.sin(lon)  // Z
                );
                cp.desired = cp.position.clone();
                cp.modeName = 'slowOrbit';
                // boxの制限を解除（範囲関係なく周回）
                cp.boxMin = null;
                cp.boxMax = null;
                break;
                
            case 6: // ⑦ フォロー（Track5の注視点を追う）
                cp.maxSpeed = 0.06;
                cp.maxForce = 0.025;
                cp.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                cp.position.set(0, 0, rMax * 2.2);
                cp.desired = cp.position.clone();
                // Track5の最新の圧力位置を記録
                cp._followTarget = new THREE.Vector3(0, 0, 0);
                // 滑らかな注視点（補間用）
                cp._smoothLookAtTarget = new THREE.Vector3(0, 0, 0);
                cp.modeName = 'follow';
                break;
                
            case 7: // ⑧ 静止ショット
                cp.maxSpeed = 0.005; // 最小限
                cp.maxForce = 0.002;
                cp.friction = conf.cameraNoDamping ? 0.0 : 0.08; // 強めの減衰
                cp.position.set(0, 0, rMax * 2.5);
                cp.desired = cp.position.clone();
                cp.modeName = 'still';
                break;
        }
    }
    
    /**
     * カメラモード別の更新処理（削除予定 - CameraParticle.updateCameraModeを使用）
     */
    _updateCameraMode_OLD(cp, deltaTime) {
        if (cp.cameraMode === undefined) return;

        switch (cp.cameraMode) {
            case 0: // ① フロント・ワイド - ほぼ固定
                // desiredを現在位置に固定
                cp.desired.copy(cp.position);
                break;
                
            case 1: // ② フロント・ミディアム - 微ドリフト
                // desiredを少しだけ動かす
                const drift = new THREE.Vector3(
                    (Math.random() - 0.5) * 0.01,
                    (Math.random() - 0.5) * 0.01,
                    0
                );
                cp.desired.add(drift);
                break;
                
            case 2: // ③ クローズアップ - ランダムに近づく（もっと近く）
                // 時々新しい近接位置を設定
                if (Math.random() < 0.01) {
                    const closeupDir = new THREE.Vector3(
                        (Math.random() - 0.5) * 1.0, // 0.5 → 1.0 に変更（注視点をよりランダムに）
                        (Math.random() - 0.5) * 1.0, // 0.5 → 1.0 に変更（注視点をよりランダムに）
                        1
                    ).normalize();
                    const baseR = Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0);
                    cp.desired.copy(closeupDir.multiplyScalar(baseR * 0.5)); // 0.8 → 0.5 に変更（もっと近く）
                }
                break;
                
            case 3: // ④ サイド・パン - 切替時のみ力を加える（物理演算で動く）
                // 切替時のみ力を加える（_updateCameraModeは毎フレーム呼ばれるので、フラグで管理）
                if (!cp._sidePanInitialized) {
                    const panDir = this.cameraModeState.sidePanDirection;
                    const panForce = 0.01; // 力をもっと弱く（0.05 → 0.01）
                    
                    // 右か左に力を加える（切替時のみ）
                    cp.force.x = panDir * panForce;
                    cp.force.y = 0;
                    cp.force.z = 0;
                    
                    cp._sidePanInitialized = true;
                }
                
                // 範囲を超えたら方向を反転（境界でバウンド）
                const rMax_pan = Math.max(0.2, (Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0) + Number(this.particleSystem?.uniforms?.heightAmp?.value ?? 0.03)));
                const panLimit = rMax_pan * 3.0;
                
                if (Math.abs(cp.position.x) > panLimit) {
                    this.cameraModeState.sidePanDirection *= -1;
                }
                break;
                
            case 4: // ⑤ オフセンター固定 - 固定（位置を維持）
                // オフセット位置を維持
                const offCenterX = this.cameraModeState.offCenterOffset.x * (Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0) * 2.0);
                const offCenterY = this.cameraModeState.offCenterOffset.y * (Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0) * 2.0);
                const rMax_update = Math.max(0.2, (Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0) + Number(this.particleSystem?.uniforms?.heightAmp?.value ?? 0.03)));
                cp.desired.set(offCenterX, offCenterY, rMax_update * 2.4);
                break;
                
            case 5: // ⑥ スロー・オービット - 球面座標系で円周に沿って動く
                // 経度を連続的に更新（0～360°をループ）
                this.cameraModeState.orbitLongitude += this.cameraModeState.orbitSpeed * deltaTime * 60;
                // 角度を0～2πの範囲に正規化
                while (this.cameraModeState.orbitLongitude >= Math.PI * 2) {
                    this.cameraModeState.orbitLongitude -= Math.PI * 2;
                }
                
                const lon = this.cameraModeState.orbitLongitude;
                const lat = this.cameraModeState.orbitLatitudeBase + this.cameraModeState.orbitLatitudeOffset;
                
                // 半径を動的に更新（パーティクルシステムのサイズに合わせる）
                const rMax_orbit = Math.max(0.2, (Number(this.particleSystem?.uniforms?.baseRadius?.value ?? 1.0) + Number(this.particleSystem?.uniforms?.heightAmp?.value ?? 0.03)));
                const radius = rMax_orbit * 2.8;
                
                // 球面座標から3D座標に変換（目標位置）
                const targetX = radius * Math.sin(lat) * Math.cos(lon);
                const targetY = radius * Math.cos(lat);
                const targetZ = radius * Math.sin(lat) * Math.sin(lon);
                
                // 現在位置から目標位置への方向ベクトル
                const toTargetX = targetX - cp.position.x;
                const toTargetY = targetY - cp.position.y;
                const toTargetZ = targetZ - cp.position.z;
                const distance = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY + toTargetZ * toTargetZ);
                
                // 球面に沿うように力を加える（求心力）
                if (distance > 0.001) {
                    const seekForce = 0.08; // 目標位置に向かう力
                    cp.force.x = (toTargetX / distance) * seekForce;
                    cp.force.y = (toTargetY / distance) * seekForce;
                    cp.force.z = (toTargetZ / distance) * seekForce;
                } else {
                    cp.force.set(0, 0, 0);
                }
                break;
                
            case 6: // ⑦ フォロー - Track5の注視点を追う（滑らかな連続移動）
                // Track5の最新の圧力位置を追う（滑らかに補間）
                if (cp._followTarget && cp._smoothLookAtTarget) {
                    // 注視点を滑らかに補間（カメラを回すような連続した動き）
                    const lookAtLerp = 0.08; // 補間係数（大きいほど速く追う）
                    cp._smoothLookAtTarget.lerp(cp._followTarget, lookAtLerp);
                    
                    // カメラ位置も滑らかに追う
                    const toTarget = cp._followTarget.clone().sub(cp.desired);
                    const distance = toTarget.length();
                    
                    // 距離に応じて追従速度を変える（遠い時は速く、近い時は遅く）
                    let followSpeed = 0.0;
                    if (distance > 0.5) {
                        // 遠い時：やや速めに追う
                        followSpeed = 0.015;
                    } else if (distance > 0.2) {
                        // 中距離：普通の速度
                        followSpeed = 0.008;
                    } else {
                        // 近い時：ゆっくり追う（微調整）
                        followSpeed = 0.003;
                    }
                    
                    // 最大速度制限（人間らしい動きの上限）
                    const maxStep = 0.02 * deltaTime * 60; // フレームレートに依存しない最大ステップ
                    const step = Math.min(distance * followSpeed, maxStep);
                    
                    if (distance > 0.001) { // 閾値以下は追わない（微細な揺れを防ぐ）
                        toTarget.normalize().multiplyScalar(step);
                        cp.desired.add(toTarget);
                    }
                }
                break;
                
            case 7: // ⑧ 静止ショット - ほぼ動かない
                cp.desired.copy(cp.position);
                break;
        }
    }
    
    /**
     * モード別のカメラ位置を取得
     */
    _getCameraPositionForMode(cp) {
        // 全てのモードで cp.position を使う（パーティクルとして動くため）
        const basePos = cp.position.clone().add(this.cameraCenter);
        
        // モードによって位置を調整
        if (cp.cameraMode === 4) { // オフセンター固定
            // オフセットを適用
            return basePos.add(this.cameraModeState.offCenterOffset.clone().multiplyScalar(0.5));
        }
        
        return basePos;
    }
    
    /**
     * モード別のlookAtターゲットを取得
     */
    _getLookAtTargetForMode(cp) {
        // クローズアップの場合は、ランダムな注視点
        if (cp.cameraMode === 2) { // CameraMode.CLOSEUP
            if (cp.modeState.lookAtTarget) {
                return cp.modeState.lookAtTarget.clone();
            }
        }
        
        // オフセンターの場合は、ランダムな注視点
        if (cp.cameraMode === 4) { // CameraMode.OFF_CENTER
            if (cp.modeState.lookAtTarget) {
                return cp.modeState.lookAtTarget.clone();
            }
        }
        
        // フォローの場合は、Track5の注視点を見る（滑らかな補間位置）
        if (cp.cameraMode === 6) { // CameraMode.FOLLOW
            if (cp._smoothLookAtTarget) {
                return cp._smoothLookAtTarget.clone();
            }
        }
        
        return this.cameraCenter.clone();
    }

    onBarChange(prevBar, nextBar) {
        // 2小節に1回、カメラモードをランダマイズ
        if (!this.cameraParticles?.length) return;
        
        // 2小節に1回のみ実行（奇数小節のみ）
        if (nextBar % 2 === 0) return;
        
        // 現在のカメラインデックスとは異なるインデックスをランダムに選択
        let newIndex = this.currentCameraIndex;
        while (newIndex === this.currentCameraIndex) {
            newIndex = Math.floor(Math.random() * this.cameraParticles.length);
        }
        this.currentCameraIndex = newIndex;
        
        // デバッグ用：モード名を表示
        const cp = this.cameraParticles[newIndex];
    }
    
    applyTrack2Invert(velocity, durationMs) {
        if (!this.trackEffects[2]) return;
        const dur = durationMs > 0 ? durationMs : 150;
        this.setInvert(true, dur);
    }
    
    applyTrack3Chromatic(velocity, durationMs) {
        if (!this.trackEffects[3]) return;
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
    
    /**
     * actual_tickに応じてLFOの深さと周期を段々早めていく
     * - tickが進むほど、LFOのrate範囲を早くする（周期を短くする）
     * - tickが進むほど、LFOのvalue範囲を広げる（深さを大きくする）
     */
    applyTickEffects(tick) {
        if (!this.yureLFO || !this._lfoInitialParams) return;
        
        // tickを0..1に正規化
        const maxTicks = this._tickMaxTicks || 38400;
        const tickNormalized = Math.min(Math.max(Number(tick) / maxTicks, 0), 1);
        
        // tickが進むほど変化量を大きくする（0..1の範囲で）
        // 例: tickNormalized = 0 → 変化なし、tickNormalized = 1 → 最大変化
        
        // 各LFOに対して適用
        const lfos = ['noiseScale', 'heightAmp', 'noiseSpeed'];
        
        lfos.forEach((key) => {
            const lfo = this.yureLFO[key];
            if (!lfo) return;
            
            const initial = this._lfoInitialParams[key];
            if (!initial) return;
            
            // 1. rate範囲を早くする（周期を短くする）
            // tickNormalized = 0 → 初期値、tickNormalized = 1 → 3倍速
            const rateMultiplier = 1.0 + tickNormalized * 2.0; // 1.0倍 → 3.0倍
            const newMinRate = initial.minRate * rateMultiplier;
            const newMaxRate = initial.maxRate * rateMultiplier;
            lfo.setRateRange(newMinRate, newMaxRate);
            
            // 2. value範囲を広げる（深さを大きくする）
            // tickNormalized = 0 → 初期値、tickNormalized = 1 → 1.5倍の範囲
            const valueRange = initial.maxValue - initial.minValue;
            const centerValue = (initial.minValue + initial.maxValue) / 2.0;
            const rangeMultiplier = 1.0 + tickNormalized * 0.5; // 1.0倍 → 1.5倍
            const newRange = valueRange * rangeMultiplier;
            const newMinValue = centerValue - newRange / 2.0;
            const newMaxValue = centerValue + newRange / 2.0;
            lfo.setValueRange(newMinValue, newMaxValue);
        });
    }
    
    toggleEffect(trackNumber) {
        super.toggleEffect(trackNumber);
    }
    
    // 共通エフェクト制御
    // setInvert / setChromatic / setGlitch は SceneBase に共通化

    handleKeyPress(key) {
        // 共通キーはSceneBaseで処理（c/Cなど）
        if (super.handleKeyPress && super.handleKeyPress(key)) return;
        if (key === 'g' || key === 'G') this.SHOW_WORLD_GRID = !this.SHOW_WORLD_GRID;
        if (key === 'p' || key === 'P') this.SHOW_PARTICLES = !this.SHOW_PARTICLES;
        // u/U: パーティクル更新方式（切り分け用）
        // - フル更新(毎フレ全粒) ⇄ 半分更新(偶数/奇数を交互)
        if (key === 'u' || key === 'U') {
            if (this.particleSystem) {
                this.particleSystem.updateStride = (this.particleSystem.updateStride >= 2) ? 1 : 2;
            }
        }
        // n/N: 球体マッピングじゃないノイズ（dirを流す）ON/OFF
        if (key === 'n' || key === 'N') {
            this.ENABLE_FLOW_ON_SPHERE = !this.ENABLE_FLOW_ON_SPHERE;
            if (this.particleSystem?.uniforms?.flowOnSphereEnabled) {
                this.particleSystem.uniforms.flowOnSphereEnabled.value = this.ENABLE_FLOW_ON_SPHERE ? 1.0 : 0.0;
            }
        }
        // m/M: 圧力モード <-> LFOモード切替
        if (key === 'm' || key === 'M') {
            this.ENABLE_PRESSURE = !this.ENABLE_PRESSURE;
            this.ENABLE_YURE_LFO = !this.ENABLE_PRESSURE;
            if (this.particleSystem?.setPressureModeEnabled) {
                this.particleSystem.setPressureModeEnabled(!!this.ENABLE_PRESSURE);
            }
        }
        if (this.particleSystem?.object) this.particleSystem.object.visible = !!this.SHOW_PARTICLES;
        if (this.particleSystem) this.particleSystem.computeEnabled = !!this.SHOW_PARTICLES;
    }

    // NOTE: 塗りは撤去（ユーザー要望）
    
    reset() {
        super.reset();
        
        // エフェクトOFF
        this.setInvert(false, 0);
        this.setChromatic(0.0, 0);
        this.setGlitch(0.0, 0);
        
        // カメラをデフォルトへ
        if (this.controls) {
            this.controls.target.set(0, 0, 0);
        }
        this.camera.position.set(0, 0, 2);
        if (this.controls) {
            this.camera.lookAt(this.controls.target);
        }
        
        // パーティクルをリセット
        if (this.particleSystem?.reset) {
            this.particleSystem.reset();
        }

        // 表示トグルも初期値へ
        this.SHOW_PARTICLES = true;
        if (this.particleSystem?.object) this.particleSystem.object.visible = true;
        if (this.particleSystem) this.particleSystem.computeEnabled = true;

        // Track5 圧力をリセット
        const u = this.particleSystem?.uniforms;
        if (u?.pressureStrength) u.pressureStrength.value = 0.0;
        this._lastPressureMs = 0;
        this._lastPressureDir = null;
        this._lastFollowTargetUpdateMs = 0;
        
        // Track5インパルス表示をリセット
        if (this.impulseIndicators) {
            this.impulseIndicators.forEach((ind) => {
                if (ind.circleGroup) ind.circleGroup.visible = false;
                if (ind.sphereGroup) ind.sphereGroup.visible = false;
                ind.active = false;
            });
        }
        
    }
    
    onResize() {
        super.onResize();
        if (this.camera) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        }
    }
    
    dispose() {
        // ポストプロセッシングを破棄
        if (this.postProcessing) {
            this.postProcessing.dispose();
        }
        
        // Track5インパルス表示用Canvasを削除
        if (this.impulseCanvas && this.impulseCanvas.parentNode) {
            this.impulseCanvas.parentNode.removeChild(this.impulseCanvas);
        }
        
        super.dispose();
    }
    
    initCameraDebugObjects() {
        if (!this.cameraDebugGroup) return;
        
        const sphereSize = 0.03;
        const circleRadius = 0.08;
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
}

