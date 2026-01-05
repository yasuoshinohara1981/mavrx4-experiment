/**
 * Scene04 (WebGPU): Terrain only
 *
 * シンプルなTerrainを表示するシーン（CPU頂点計算方式）
 */
import { SceneTemplate } from '../SceneTemplate.js';
import * as THREE from "three/webgpu";
import { GridRuler3D } from '../../lib/GridRuler3D.js';
import {
    Fn,
    float,
    vec3,
    sin,
    cos,
    abs,
    max,
    min,
    pow,
    sqrt,
    mix,
    step,
    Loop,
    If,
    attribute,
    uniform,
    time
} from 'three/tsl';

export class Scene04 extends SceneTemplate {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera, sharedResourceManager);
        this.title = 'mathym | coalesce (Sky)';

        // トラックのON/OFF
        this.trackEffects = {
            1: true,   // カメラランダマイズ
            2: true,   // invert
            3: true,   // chroma
            4: true,   // glitch
            5: true,   // ノイズアニメーション
            6: false,
            7: false,
            8: false,
            9: false,
        };
        
        // ノイズアニメーション用の時間（GPUシェーダーで使用）
        this.noiseTime = 0;
        this.terrainNoiseTimeUniform = null;

        this.terrainMesh = null;
        
        // クレーター管理（トラック5用）
        this.craters = []; // { x, z, radius, depth, age, maxAge }
        this.maxCraters = 10;
        this.craterUniforms = null; // GPUシェーダー用のuniform配列
        this.lastCraterSpawnTime = 0;
        this.craterSpawnInterval = 2000; // 2秒ごとにクレーターを追加
        
        // カメラパーティクル（Track1用）
        this.cameraParticles = [];
        this.currentCameraIndex = 0;
        this.cameraCenter = new THREE.Vector3(0, 0, 0);
        
        // グリッド表示（gキーでトグル）
        this.SHOW_WORLD_GRID = false; // デフォルトOFF
        this.worldGrid = null;
    }

    async setup() {
        await super.setup();
        
        // スクリーンショットテキストを非表示にする（中央のテキストを消す）
        this.showScreenshotText = false;
        this.screenshotText = '';

        // シーン固有のシャドウ設定（conf.jsに依存せず、シーンごとに独立）
        // Scene04: シャドウ無効（Terrainが大きすぎてパフォーマンスに影響するため）
        this._shadowMapEnabled = false;
        this._shadowMapType = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.enabled = this._shadowMapEnabled;
        this.renderer.shadowMap.type = this._shadowMapType;

        // 背景は削除
        this.scene.background = null;
        this.scene.fog = null;

        // HDRI環境の強度を上げてライトを明るくする
        if (this.hdriTexture) {
            this.applyHdriEnvironment(this.hdriTexture, {
                envIntensity: 2.0, // 環境マップの強度を上げる
                exposure: 1.5, // 露出を上げる
            });
        }

        // カメラ設定（Terrainが大きいので、もっと遠くから見る）
        this.camera.fov = 60;
        this.camera.near = 0.01;
        this.camera.far = 5000; // 160 -> 5000（Terrainが大きいので遠くまで見えるように）
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.position.set(0, 120, 100); // カメラを上から見下ろす位置に（高く設定：50 -> 120）
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();

        // ライト（全体的に均等に照らすように調整）
        // AmbientLightを強めにして、全体的に明るくする
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
        this.scene.add(ambientLight);
        
        // メインのDirectionalLight（上から照らす）
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(0, 200, 0);
        directionalLight.castShadow = false;
        directionalLight.target.position.set(0, 0, 0);
        this.scene.add(directionalLight.target);
        this.scene.add(directionalLight);
        
        // 補助ライト（斜めから照らして立体感を出す）
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight2.position.set(200, 100, 200);
        directionalLight2.castShadow = false;
        directionalLight2.target.position.set(0, 0, 0);
        this.scene.add(directionalLight2.target);
        this.scene.add(directionalLight2);
        
        // さらに補助ライト（反対側から照らして影を減らす）
        const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight3.position.set(-200, 100, -200);
        directionalLight3.castShadow = false;
        directionalLight3.target.position.set(0, 0, 0);
        this.scene.add(directionalLight3.target);
        this.scene.add(directionalLight3);

        // カメラパーティクルを初期化（Track1用）
        const { CameraParticle } = await import('../../lib/CameraParticle.js');
        this.cameraParticles = [];
        this.currentCameraIndex = 0;
        this.cameraCenter = new THREE.Vector3(0, 0, 0);
        
        // Terrainの上を動き回るカメラパーティクルを設定
        // カメラをもっと遠くまで動かせるように範囲を大幅に拡大
        // ただし、Terrainの範囲内に収まるように調整（Terrainは-1000～1000の範囲）
        const terrainHalfSize = 1000; // Terrainの半分のサイズ
        // カメラを高くする（Y方向の範囲を上げる）
        const boxMin = new THREE.Vector3(-terrainHalfSize * 0.8, 80, -terrainHalfSize * 0.8);  // 20 -> 80
        const boxMax = new THREE.Vector3(terrainHalfSize * 0.8, 250, terrainHalfSize * 0.8);  // 150 -> 250
        
        // 8台のカメラを初期化
        for (let i = 0; i < 8; i++) {
            const cp = new CameraParticle();
            // Scene04はTerrainが大きいので、少し強めに設定
            cp.maxSpeed = 0.15;  // Scene01より少し大きめ
            cp.maxForce = 0.05;  // Scene01より少し大きめ（forceMulを掛けても0.0025～0.0075になる）
            cp.friction = 0.005;  // 摩擦を弱くする（0.02 -> 0.005）
            
            // Boxの境界を設定
            cp.boxMin = boxMin.clone();
            cp.boxMax = boxMax.clone();
            
            // 初期位置をBox内にランダムに配置（Terrainの範囲内に収まるように）
            cp.position.set(
                boxMin.x + Math.random() * (boxMax.x - boxMin.x),
                boxMin.y + Math.random() * (boxMax.y - boxMin.y),
                boxMin.z + Math.random() * (boxMax.z - boxMin.z)
            );
            
            this.cameraParticles.push(cp);
        }
        
        // 初期カメラ位置も設定（Terrainの範囲内に収まるように、高く設定）
        const initialCamPos = new THREE.Vector3(0, 120, 100);  // 50 -> 120（高く）
        this.camera.position.copy(initialCamPos);
        this.camera.lookAt(this.cameraCenter);
        this.camera.updateMatrixWorld();
        
        // Terrain作成（TSL頂点シェーダー方式）
        this._createTerrain();
        
        // カメラパーティクルの可視化（c/C）を共通化：SceneBase側で描画
        // NOTE: overlaySceneが確実に初期化された後に呼ぶ
        this.initCameraDebug(this.overlayScene);
        
        // 3Dグリッド＋ルーラー（床＋垂直面＋目盛り）
        // Scene01と同じ計算式を使用
        const terrainSize = 2000;
        const terrainHeight = 20; // 高さ方向の範囲
        const floorY = -0.02; // TerrainのgroundYと同じ
        // Scene01と同じ計算式：床グリッドの大きさ（箱の外側に少し余白があるくらいにする）
        const floorSize = Math.max(terrainSize, terrainSize) * 2.2; // 2000 * 2.2 = 4400
        this.worldGrid = new GridRuler3D();
        this.worldGrid.init({
            center: { x: 0, y: 0, z: 0 },
            size: { x: terrainSize, y: terrainHeight, z: terrainSize },
            floorSize: floorSize, // Scene01と同じ計算式
            floorY: floorY,
            color: 0xffffff,
            opacity: 0.25 // Scene01と同じ（控えめに）
        });
        this.worldGrid.setVisible(this.SHOW_WORLD_GRID);
        this.scene.add(this.worldGrid.group);
        
        // カメラ設定を変更した後、PostFXを再初期化（カメラが変更されているため）
        if (this.postProcessing) {
            try {
                this.postProcessing.dispose();
            } catch (e) {
                // エラーを無視
            }
            this.postProcessing = null;
        }
        // 明示的にシーン、オーバーレイシーン、カメラを渡して初期化
        this.initPostFX({
            scene: this.scene,
            overlayScene: this.overlayScene,
            camera: this.camera
        });
        
        // デバッグ: シーンの状態を確認
        console.log('Scene04 setup complete:', {
            sceneChildren: this.scene.children.length,
            terrainMesh: this.terrainMesh ? 'exists' : 'missing',
            cameraPos: this.camera.position.clone(),
            cameraLookAt: new THREE.Vector3(0, 0, 0),
            cameraParticles: this.cameraParticles.length,
            postProcessing: this.postProcessing ? 'exists' : 'missing',
            scene: this.scene ? 'exists' : 'missing',
            overlayScene: this.overlayScene ? 'exists' : 'missing'
        });
    }

    _createTerrain() {
        // 本物の山脈のような地形を作成（CPU頂点計算方式）
        const terrainWidth = 2000;
        const terrainDepth = 2000;
        const terrainSegments = 500;

        const terrainGeom = new THREE.PlaneGeometry(terrainWidth, terrainDepth, terrainSegments, terrainSegments);
        terrainGeom.rotateX(-Math.PI / 2);

        const positions = terrainGeom.attributes.position;
        const vertexCount = positions.count;
        const groundY = -0.02;

        // Ridged Noise関数（尾根を作る）
        const ridgedNoise = (val) => 1.0 - Math.abs(val);
        
        // FBM（Fractal Brownian Motion）的なノイズ生成
        const fbmNoise = (x, z, octaves, persistence, lacunarity) => {
            let total = 0;
            let amplitude = 1;
            let frequency = 1;
            let maxValue = 0;
            
            for (let i = 0; i < octaves; i++) {
                const nx = x * frequency;
                const nz = z * frequency;
                // 複数のsin/cosを組み合わせてノイズっぽく
                const n = Math.sin(nx * 0.01) * Math.cos(nz * 0.01) +
                          Math.sin(nx * 0.017 + nz * 0.013) * 0.5 +
                          Math.cos(nz * 0.019 - nx * 0.011) * 0.25;
                total += n * amplitude;
                maxValue += amplitude;
                amplitude *= persistence;
                frequency *= lacunarity;
            }
            return total / maxValue;
        };

        for (let i = 0; i < vertexCount; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);

            // ===== 1. 大きな山脈の骨格（Ridged Noise）=====
            // 斜め方向に伸びる尾根を複数作る
            const ridgeAngle1 = 0.7; // 約40度
            const ridgeAngle2 = -0.5; // 約-27度
            const ridge1 = ridgedNoise(Math.sin((x * ridgeAngle1 + z) * 0.003)) * 80;
            const ridge2 = ridgedNoise(Math.sin((x * ridgeAngle2 + z * 1.2) * 0.004)) * 60;
            const ridge3 = ridgedNoise(Math.sin((x + z * ridgeAngle1) * 0.0025)) * 50;
            
            // 尾根を組み合わせ（乗算で交差点を強調）
            const ridgeCombined = (ridge1 + ridge2 * 0.7 + ridge3 * 0.5);
            
            // ===== 2. 中規模の起伏（FBM）=====
            const fbm = fbmNoise(x, z, 4, 0.5, 2.0) * 40;
            
            // ===== 3. 山頂を尖らせる（もっと尖らせる）=====
            const rawHeight = ridgeCombined + fbm;
            const normalizedHeight = (rawHeight + 100) / 200; // 0-1に正規化
            const sharpenedHeight = Math.pow(Math.max(0, normalizedHeight), 2.5) * 200 - 50; // 1.8 → 2.5（より尖らせる）
            
            // ===== 4. 谷と平地を作る（低い部分を平らに）=====
            const valleyThreshold = -20;
            let height = sharpenedHeight;
            if (height < valleyThreshold) {
                // 谷は緩やかに
                height = valleyThreshold + (height - valleyThreshold) * 0.3;
            }
            
            // ===== 5. 細かいディテール（高周波ノイズ）=====
            const detail1 = Math.sin(x * 0.08) * Math.cos(z * 0.09) * 5;
            const detail2 = Math.sin(x * 0.12 + z * 0.1) * Math.cos(z * 0.11 - x * 0.09) * 3;
            const detail3 = Math.sin(x * 0.15 - z * 0.14) * 2;
            const detailNoise = detail1 + detail2 + detail3;
            
            // 高い場所ほどディテールを強く
            const detailScale = Math.max(0, (height + 50) / 150) * 0.8 + 0.2;
            height += detailNoise * detailScale;
            
            // ===== 6. エリアごとの高低差（塊を作る）=====
            const areaX = Math.sin(x * 0.0015) * Math.cos(z * 0.0012);
            const areaZ = Math.sin(z * 0.0018) * Math.cos(x * 0.0014);
            const areaMask = (areaX + areaZ + 2) / 4; // 0-1
            const areaBoost = Math.pow(areaMask, 2) * 80 - 30;
            height += areaBoost;
            
            // ===== 7. 端を低くする（島っぽく）=====
            const distFromCenter = Math.sqrt(x * x + z * z);
            const edgeFalloff = Math.max(0, 1 - distFromCenter / 900);
            const edgeFalloffSmooth = Math.pow(edgeFalloff, 1.5);
            height = height * edgeFalloffSmooth - 30 * (1 - edgeFalloffSmooth);

            positions.setY(i, groundY + height);
        }

        positions.needsUpdate = true;
        terrainGeom.computeVertexNormals();

        // TSLでGPUシェーダーを使用（ノイズをGPUで計算）
        // MeshStandardNodeMaterialを使う必要がある（positionNodeを使うため）
        const terrainMat = new THREE.MeshStandardNodeMaterial({
            color: 0x2a2a2a,
            roughness: 0.3,
            metalness: 0.8,
            side: THREE.DoubleSide,
        });
        
        // ノイズアニメーション用のuniform
        const noiseTime = uniform(0.0);
        this.terrainNoiseTimeUniform = noiseTime;
        
        // クレーター用のuniform（最大10個）
        // 各クレーター: [x, z, radius, depth]
        this.craterUniforms = [];
        for (let i = 0; i < this.maxCraters; i++) {
            this.craterUniforms.push(uniform(new THREE.Vector4(0, 0, 0, 0)));
        }
        
        // 頂点シェーダーでノイズを計算（TSL構文を修正）
        terrainMat.positionNode = Fn(() => {
            const pos = attribute('position');
            const x = pos.x;
            const z = pos.z;
            const t = noiseTime;
            const groundY = float(-0.02);
            
            // FBMノイズ（時間を追加、Loopを使用）
            const total = float(0).toVar();
            const amplitude = float(1).toVar();
            const frequency = float(1).toVar();
            const maxValue = float(0).toVar();
            
            Loop({ start: 0, end: 4, type: 'int', condition: '<' }, () => {
                const nx = x.mul(frequency);
                const nz = z.mul(frequency);
                const n = sin(nx.mul(0.01).add(t.mul(0.1))).mul(cos(nz.mul(0.01).add(t.mul(0.08))))
                    .add(sin(nx.mul(0.017).add(nz.mul(0.013)).add(t.mul(0.12))).mul(0.5))
                    .add(cos(nz.mul(0.019).sub(nx.mul(0.011)).add(t.mul(0.15))).mul(0.25));
                total.addAssign(n.mul(amplitude));
                maxValue.addAssign(amplitude);
                amplitude.mulAssign(0.5); // persistence
                frequency.mulAssign(2.0); // lacunarity
            });
            
            // maxValueが0にならないように保護
            const safeMaxValue = max(maxValue, float(0.0001));
            const fbm = total.div(safeMaxValue).mul(40);
            
            // 1. 大きな山脈の骨格（Ridged Noise、時間を追加）
            // Ridged Noise: 1.0 - abs(val)
            const ridgeAngle1 = float(0.7);
            const ridgeAngle2 = float(-0.5);
            const ridge1Val = sin(x.mul(ridgeAngle1).add(z).mul(0.003).add(t.mul(0.05)));
            const ridge1 = float(1.0).sub(abs(ridge1Val)).mul(80);
            const ridge2Val = sin(x.mul(ridgeAngle2).add(z.mul(1.2)).mul(0.004).add(t.mul(0.06)));
            const ridge2 = float(1.0).sub(abs(ridge2Val)).mul(60);
            const ridge3Val = sin(x.add(z.mul(ridgeAngle1)).mul(0.0025).add(t.mul(0.04)));
            const ridge3 = float(1.0).sub(abs(ridge3Val)).mul(50);
            const ridgeCombined = ridge1.add(ridge2.mul(0.7)).add(ridge3.mul(0.5));
            
            // 2. 中規模の起伏（FBM、時間を追加）
            const rawHeight = ridgeCombined.add(fbm);
            const normalizedHeight = rawHeight.add(100).div(200);
            const sharpenedHeight = pow(max(normalizedHeight, 0), 2.5).mul(200).sub(50);
            
            // 3. 山頂を尖らせる
            // 4. 谷と平地を作る
            const valleyThreshold = float(-20);
            const height = sharpenedHeight.toVar();
            // 条件分岐をstep関数で実装
            const isAboveThreshold = step(valleyThreshold, height);
            height.assign(mix(
                valleyThreshold.add(height.sub(valleyThreshold).mul(0.3)),
                height,
                isAboveThreshold
            ));
            
            // 5. 細かいディテール（高周波ノイズ、時間を追加）
            const detail1 = sin(x.mul(0.08).add(t.mul(0.2))).mul(cos(z.mul(0.09).add(t.mul(0.18)))).mul(5);
            const detail2 = sin(x.mul(0.12).add(z.mul(0.1)).add(t.mul(0.25))).mul(cos(z.mul(0.11).sub(x.mul(0.09)).add(t.mul(0.22)))).mul(3);
            const detail3 = sin(x.mul(0.15).sub(z.mul(0.14)).add(t.mul(0.3))).mul(2);
            const detailNoise = detail1.add(detail2).add(detail3);
            const detailScale = max(height.add(50).div(150), 0).mul(0.8).add(0.2);
            height.addAssign(detailNoise.mul(detailScale));
            
            // 6. エリアごとの高低差（時間を追加）
            const areaX = sin(x.mul(0.0015).add(t.mul(0.02))).mul(cos(z.mul(0.0012).add(t.mul(0.015))));
            const areaZ = sin(z.mul(0.0018).add(t.mul(0.025))).mul(cos(x.mul(0.0014).add(t.mul(0.02))));
            const areaMask = areaX.add(areaZ).add(2).div(4);
            const areaBoost = pow(areaMask, 2).mul(80).sub(30);
            height.addAssign(areaBoost);
            
            // 7. 端を低くする（島っぽく）
            const distFromCenter = sqrt(x.mul(x).add(z.mul(z)));
            const edgeFalloff = max(float(1).sub(distFromCenter.div(900)), 0);
            const edgeFalloffSmooth = pow(edgeFalloff, 1.5);
            height.mulAssign(edgeFalloffSmooth);
            height.subAssign(float(30).mul(float(1).sub(edgeFalloffSmooth)));
            
            // 8. クレーターの影響を計算（トラック5用）- 一旦無効化してデバッグ
            // const craterEffect = float(0).toVar();
            // ... クレーター処理は一旦コメントアウト
            
            return vec3(x, groundY.add(height), z);
        })();

        this.terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
        this.terrainMesh.position.set(0, 0, 0);
        this.terrainMesh.receiveShadow = false;
        this.terrainMesh.castShadow = false;
        this.terrainMesh.frustumCulled = false;
        this.scene.add(this.terrainMesh);

        console.log('Terrain created (GPU shader calculation)');
    }
    
    // CPU更新処理は削除（GPUシェーダーで計算するため不要）

    onUpdate(deltaTime) {
        super.onUpdate(deltaTime);
        
        // トラック5でノイズを動かす（GPUシェーダーで計算）
        if (this.trackEffects[5] && this.terrainNoiseTimeUniform) {
            this.noiseTime += deltaTime * 0.001; // 時間を更新
            this.terrainNoiseTimeUniform.value = this.noiseTime;
            
            // クレーターの更新
            const currentTime = Date.now();
            
            // 古いクレーターを削除（年齢がmaxAgeを超えたもの）
            this.craters = this.craters.filter(crater => {
                crater.age += deltaTime * 1000; // ミリ秒単位
                return crater.age < crater.maxAge;
            });
            
            // 新しいクレーターを追加（一定間隔で）
            if (currentTime - this.lastCraterSpawnTime > this.craterSpawnInterval) {
                if (this.craters.length < this.maxCraters) {
                    // ランダムな位置にクレーターを追加
                    const x = (Math.random() - 0.5) * 1800; // -900 ～ 900
                    const z = (Math.random() - 0.5) * 1800; // -900 ～ 900
                    const radius = 50 + Math.random() * 100; // 50 ～ 150
                    const depth = 20 + Math.random() * 30; // 20 ～ 50
                    const maxAge = 5000 + Math.random() * 5000; // 5秒 ～ 10秒
                    
                    this.craters.push({
                        x, z, radius, depth,
                        age: 0,
                        maxAge: maxAge
                    });
                }
                this.lastCraterSpawnTime = currentTime;
            }
            
            // クレーターのuniformを更新
            for (let i = 0; i < this.maxCraters; i++) {
                if (i < this.craters.length) {
                    const crater = this.craters[i];
                    // 年齢に応じて深さを減らす（徐々に消える）
                    const ageFactor = 1.0 - (crater.age / crater.maxAge);
                    const currentDepth = crater.depth * Math.max(0, ageFactor);
                    this.craterUniforms[i].value.set(crater.x, crater.z, crater.radius, currentDepth);
                } else {
                    // クレーターがない場合は無効化（半径0）
                    this.craterUniforms[i].value.set(0, 0, 0, 0);
                }
            }
        } else {
            // トラック5がOFFの時はクレーターをクリア
            this.craters = [];
            for (let i = 0; i < this.maxCraters; i++) {
                this.craterUniforms[i].value.set(0, 0, 0, 0);
            }
        }
        
        // グリッドの更新（カメラに追従）
        if (this.worldGrid) {
            this.worldGrid.setVisible(this.SHOW_WORLD_GRID);
            this.worldGrid.update(this.camera);
        }
        
        // カメラパーティクルの更新（Track1用）
        const camMoveOn = !!this.trackEffects[1];
        if (this.cameraParticles && this.cameraParticles.length > 0) {
            this.cameraParticles.forEach((cp) => {
                cp.enableMovement = camMoveOn;
                cp.update(deltaTime);
                
                // トラック1がOFFの時は、力もリセット（新しいランダマイズを止める）
                if (!camMoveOn) {
                    cp.force.set(0, 0, 0);
                }
            });
            
            const cp = this.cameraParticles[this.currentCameraIndex];
            if (cp) {
                // カメラ位置を更新
                const camPos = cp.getPosition();
                this.camera.position.copy(camPos);
                
                // カメラの向きを更新（Terrainの中心を見る）
                this.camera.lookAt(this.cameraCenter);
                this.camera.updateMatrixWorld();
                
                // デバッグ: カメラ位置が範囲外に出ていないか確認
                if (this.SHOW_CAMERA_DEBUG) {
                    const distToCenter = camPos.length();
                    const maxDist = Math.sqrt(2000 * 2000 + 200 * 200 + 2000 * 2000); // 最大距離
                    if (distToCenter > maxDist * 1.1) {
                        console.warn('Scene04: カメラが範囲外:', {
                            position: camPos.clone(),
                            distance: distToCenter,
                            maxDistance: maxDist
                        });
                    }
                }
            }
        }
    }
    
    switchCameraRandom(force = false) {
        // force=trueの場合はtrackEffects[1]をチェックしない（フェーズ変更時など）
        if (!force && !this.trackEffects[1]) return;
        
        if (!this.cameraParticles || this.cameraParticles.length < 2) return;
        let newIndex = this.currentCameraIndex;
        while (newIndex === this.currentCameraIndex) {
            newIndex = Math.floor(Math.random() * this.cameraParticles.length);
        }
        this.currentCameraIndex = newIndex;
    }
    
    applyTrack1Camera(velocity, durationMs) {
        // Track1: カメラ用CameraParticleに「力ランダム（弱め）+ カメラ切替」
        // - velocity でブースト量を決める（Scene01と同じロジック）
        // - 力を弱めに調整
        if (!this.trackEffects?.[1]) {
            console.warn('Scene04.applyTrack1Camera: trackEffects[1] is false');
            return;
        }
        const cps = this.cameraParticles;
        if (!cps || cps.length === 0) {
            console.warn('Scene04.applyTrack1Camera: cameraParticles is empty');
            return;
        }

        const v01 = Math.min(Math.max((Number(velocity) || 0) / 127, 0), 1);
        // Scene01と同じパラメータ
        // NOTE: forceMulはmaxForceに掛けるので、小さな値になる
        // Scene04はTerrainが大きいので、少し強めに設定
        // でも、applyRandomForceWeak()のstrengthが0.2～1.0なので、maxForceもそれに合わせる必要がある
        const forceMul = 1.0 + 0.5 * v01;  // 1.0～1.5（maxForceを増やす）
        const speedMul = 1.00 + 0.02 * v01;
        const now = Date.now();
        const holdMs = Math.max(0, Number(durationMs) || 0) > 0 ? Number(durationMs) : 80;

        cps.forEach((cp, index) => {
            if (!cp) return;
            // baseを初回だけ記録
            if (typeof cp.__track1BaseMaxForce === 'undefined') cp.__track1BaseMaxForce = cp.maxForce;
            if (typeof cp.__track1BaseMaxSpeed === 'undefined') cp.__track1BaseMaxSpeed = cp.maxSpeed;

            // ブーストを設定（期限切れは updateTrack1CameraBoosts() が戻す）
            cp.__track1BoostUntilMs = now + holdMs;
            const oldMaxForce = cp.maxForce;
            const oldMaxSpeed = cp.maxSpeed;
            // maxForceを増やして、applyRandomForceWeak()の力がクランプされないようにする
            cp.maxForce = (Number(cp.__track1BaseMaxForce) || cp.maxForce) * forceMul;
            cp.maxSpeed = (Number(cp.__track1BaseMaxSpeed) || cp.maxSpeed) * speedMul;

            // 力をランダム化（方向/回転）
            // NOTE: 強すぎる場合があるので "Weak" を優先
            const oldForce = cp.force.clone();
            if (typeof cp.applyRandomForceWeak === 'function') {
                cp.applyRandomForceWeak();
            } else if (typeof cp.applyRandomForce === 'function') {
                cp.applyRandomForce();
            } else {
                console.warn(`Scene04.applyTrack1Camera: cp[${index}] has no applyRandomForceWeak or applyRandomForce`);
            }
            
            // デバッグ: 最初のパーティクルだけログ出力
            if (index === 0) {
                console.log('Scene04.applyTrack1Camera:', {
                    velocity,
                    v01,
                    forceMul,
                    speedMul,
                    oldMaxForce,
                    newMaxForce: cp.maxForce,
                    oldMaxSpeed,
                    newMaxSpeed: cp.maxSpeed,
                    oldForce: oldForce,
                    newForce: cp.force.clone(),
                    hasApplyRandomForceWeak: typeof cp.applyRandomForceWeak === 'function',
                    hasApplyRandomForce: typeof cp.applyRandomForce === 'function'
                });
            }
        });

        // カメラを切り替える
        this.switchCameraRandom();
    }

    // render()をオーバーライド
    async render() {
        if (!this.postProcessing) {
            console.warn('Scene04: postProcessing is null');
            return;
        }

        try {
            await super.render();
        } catch (err) {
            console.error('Scene04 renderエラー:', err);
        }
    }

    handleKeyPress(key) {
        // 共通キーはSceneBaseで処理（c/Cなど）
        if (super.handleKeyPress && super.handleKeyPress(key)) return;
        if (key === 'g' || key === 'G') {
            // g/Gは3Dグリッド（遮蔽が効く方）をトグル
            this.SHOW_WORLD_GRID = !this.SHOW_WORLD_GRID;
            if (this.worldGrid) {
                this.worldGrid.setVisible(this.SHOW_WORLD_GRID);
            }
        }
    }

    handleTrackNumber(trackNumber, message) {
        const args = message?.args || [];
        const velocity = Number(args[1] ?? 127);
        const durationMs = Number(args[2] ?? 0);
        
        if (trackNumber === 1) {
            this.applyTrack1Camera(velocity, durationMs);
            return;
        }
        
        // track2-4は親クラスで処理
        super.handleTrackNumber(trackNumber, message);
    }

    onResize() {
        super.onResize();
        if (this.camera) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        }
    }

    dispose() {
        // terrainMeshを破棄
        if (this.terrainMesh) {
            try {
                this.scene.remove(this.terrainMesh);
                if (this.terrainMesh.geometry) this.terrainMesh.geometry.dispose();
                if (this.terrainMesh.material) this.terrainMesh.material.dispose();
            } catch (e) {
                // WebGPU のノード管理エラーを無視
            }
            this.terrainMesh = null;
        }
        
        // グリッドを破棄
        if (this.worldGrid) {
            try {
                if (this.worldGrid.group && this.worldGrid.group.parent) {
                    this.worldGrid.group.parent.remove(this.worldGrid.group);
                }
                this.worldGrid.dispose();
            } catch (e) {
                // エラーを無視
            }
            this.worldGrid = null;
        }
        
        super.dispose();
    }
    
    initCameraDebugObjects() {
        if (!this.cameraDebugGroup) {
            console.warn('Scene04.initCameraDebugObjects: cameraDebugGroup is null');
            return;
        }
        if (!this.cameraParticles || this.cameraParticles.length === 0) {
            console.warn('Scene04.initCameraDebugObjects: cameraParticles is empty');
            return;
        }
        
        const sphereSize = 0.03;
        const circleRadius = 0.08;
        const circleSegments = 32;
        
        // 既存をクリア
        this.cameraDebugGroup.clear();
        this.cameraDebugSpheres = [];
        this.cameraDebugLines = [];
        this.cameraDebugCircles = [];
        this.cameraDebugTextPositions = [];
        
        for (let i = 0; i < this.cameraParticles.length; i++) {
            const sphereGeometry = new THREE.SphereGeometry(sphereSize, 32, 32);
            // Scene04は大きなTerrainなので、MeshBasicMaterialでライト不要にする
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
        
        // overlaySceneに確実に追加されているか確認し、必要なら移動
        if (this.cameraDebugGroup && this.overlayScene && this.cameraDebugGroup.parent !== this.overlayScene) {
            try {
                if (this.cameraDebugGroup.parent) {
                    this.cameraDebugGroup.parent.remove(this.cameraDebugGroup);
                }
                this.overlayScene.add(this.cameraDebugGroup);
            } catch (e) {
                console.warn('Scene04.initCameraDebugObjects: failed to move to overlayScene', e);
            }
        }
        
        console.log('Scene04.initCameraDebugObjects: created', {
            spheres: this.cameraDebugSpheres.length,
            lines: this.cameraDebugLines.length,
            circles: this.cameraDebugCircles.length,
            cameraParticles: this.cameraParticles.length,
            groupParent: this.cameraDebugGroup.parent?.constructor?.name || 'null',
            overlayScene: this.overlayScene ? 'exists' : 'missing',
            scene: this.scene ? 'exists' : 'missing'
        });
    }
}
