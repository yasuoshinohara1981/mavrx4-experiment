/**
 * Scene03 (WebGPU): Metal Road with Growing Objects
 * 
 * - 金属的な「道」の上をカメラが進む
 * - actual_tickに応じてオブジェクトが生える
 * - 通常のMeshを配列で管理（WebGPUでInstancedMeshが動的更新できないため）
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from "three/webgpu";
import { GridRuler3D } from '../../lib/GridRuler3D.js';
import { loadHdrCached } from '../../lib/hdrCache.js';
import hdri from '../../assets/autumn_field_puresky_1k.hdr';
import { conf } from '../../common/conf.js';
import { CameraParticle } from '../../lib/CameraParticle.js';

export class Scene03 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | coalesce (Road)';
        this.sharedResourceManager = sharedResourceManager;
        
        // トラックのON/OFF
        this.trackEffects = {
            1: true,
            2: true,
            3: true,
            4: false,
            5: true,
            6: true,
            7: false,
            8: true,
            9: true,
            10: true,
        };
        
        // カメラモード
        this.cameraMode = 'follow';
        
        // 進行位置
        this.actualTick = 0;
        this.roadProgress = 0;
        
        // 道の設定（長くして消えないように）
        this.roadLength = 50000;
        this.roadWidth = 20;
        
        // オブジェクト配列
        this.track1Objects = [];
        this.track1CircleEffects = []; // Track1の水平Circleエフェクト
        this.track1CircleGroups = []; // Track1のサークルグループ（sceneに直接追加）
        this.track5Objects = [];
        this.track5CircleGroups = []; // Track5のサークルグループ（sceneに直接追加）
        this.track6Objects = [];
        this.track8Objects = [];
        this.track9Objects = [];
        this.track10Objects = [];
        this.monolithObjects = [];
        
        // グリッド
        this.gridRuler = null;
        this.showGrid = false;
        
        // ノイズシード
        this.noiseSeed = Math.random() * 1000;
        
        // フェーズ管理
        this.lastPhase = -1;
        
        // カメラ注視点
        this.lookAtTarget = new THREE.Vector3(0, 1, 0);
        this.lookAtGoal = new THREE.Vector3(0, 1, 0);
        this.lastLookAtChangeTime = 0;
        this.lookAtMinInterval = 2000; // 2秒間隔（揺れを防ぐため長めに）
        
        // カメラパーティクル
        this.cameraParticle = null;
        
        // X位置と角度の連続性を保つための前回位置（蛇のように連続させる）
        // 各トラックで異なるノイズオフセットを使用
        this.lastTrack1X = 0;
        this.lastTrack5X = 0;
        this.lastTrack8X = 0;
        this.lastTrack8RotX = 0;
        this.lastTrack8RotY = 0;
        this.lastTrack8RotZ = 0;
        this.lastTrack9X = 0;
        this.lastTrack9RotX = 0;
        this.lastTrack9RotY = 0;
        this.lastTrack9RotZ = 0;
        this.lastTrack10X = 0;
        this.lastTrack10RotX = 0;
        this.lastTrack10RotY = 0;
        this.lastTrack10RotZ = 0;
        
        // 小節管理
        this.lastBar = -1;
        this.actualBar = 0;
        
        // ジオメトリ・マテリアル（再利用）
        this.geometries = {};
        this.materials = {};
    }

    async setup() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a12);
        
        this.overlayScene = new THREE.Scene();
        
        // HDRI
        try {
            const envMap = await loadHdrCached(hdri, this.renderer);
            this.scene.environment = envMap;
            this.scene.environmentIntensity = 0.3; // 少し暗く（0.4 → 0.3）
        } catch (e) {
            console.warn('HDRI load failed:', e);
        }
        
        this.renderer.toneMappingExposure = 0.6; // 少し暗く（0.7 → 0.6）
        
        // シャドウマップを有効化
        this._shadowMapEnabled = true;
        this._shadowMapType = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.enabled = this._shadowMapEnabled;
        this.renderer.shadowMap.type = this._shadowMapType;
        
        // ライト
        this._setupLights();
        
        // カメラ設定
        this.camera.fov = 50;
        this.camera.near = 0.1;
        this.camera.far = 2000;
        this.camera.updateProjectionMatrix();
        
        // カメラパーティクルの初期化
        this.cameraParticle = new CameraParticle();
        this.cameraParticle.position.set(0, 3, 0);
        // 立方体の境界を設定（カメラが遠くに行きすぎないように）
        this.cameraParticle.boxMin = new THREE.Vector3(-15, 0, -1000);
        this.cameraParticle.boxMax = new THREE.Vector3(15, 30, 1000);
        // 速度制限を低くして制御しやすく、摩擦を強めに
        this.cameraParticle.maxSpeed = 2.0;
        this.cameraParticle.maxForce = 0.8;
        this.cameraParticle.friction = 0.25; // 摩擦を強めに（跳ね返りを抑える）
        this.cameraParticle.bounceDamping = 0.3; // 跳ね返りを大幅に減衰
        
        // ジオメトリとマテリアルを作成
        this._createGeometriesAndMaterials();
        
        // 道を作成
        this._createRoad();
        
        // グリッド
        this.gridRuler = new GridRuler3D();
        this.gridRuler.init({
            center: { x: 0, y: 0, z: 0 },
            size: { x: 100, y: 20, z: 100 },
            floorSize: 200,
            floorY: -0.5,
            color: 0xffffff,
            opacity: 0.3,
        });
        this.overlayScene.add(this.gridRuler.group);
        this.gridRuler.setVisible(this.showGrid);
        
        // カメラ初期位置
        this._updateCameraPosition();
        
        // HUD初期化
        this.initializeHUD();
        
        // PostFX初期化（bloomを無効化）
        const originalBloom = conf.bloom;
        conf.bloom = false;
        this.initPostFX({
            scene: this.scene,
            overlayScene: this.overlayScene,
            camera: this.camera
        });
        conf.bloom = originalBloom; // 他のシーンに影響しないように戻す
        
        console.log('Scene03 setup complete (Mesh配列版)');
    }
    
    _setupLights() {
        const ambientLight = new THREE.AmbientLight(0x404050, 0.3);
        this.scene.add(ambientLight);
        
        // メインライト
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(10, 30, -20);
        dirLight.castShadow = true;
        // シャドウマップの設定
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.1;
        dirLight.shadow.camera.far = 500;
        dirLight.shadow.camera.left = -50;
        dirLight.shadow.camera.right = 50;
        dirLight.shadow.camera.top = 50;
        dirLight.shadow.camera.bottom = -50;
        dirLight.shadow.bias = -0.0001;
        dirLight.shadow.normalBias = 0.02;
        // ライトのターゲットを設定
        dirLight.target.position.set(0, 0, 0);
        this.scene.add(dirLight);
        this.scene.add(dirLight.target);
        this.dirLight = dirLight;
        
        // フィルライト1
        const fillLight1 = new THREE.DirectionalLight(0x4466aa, 0.5);
        fillLight1.position.set(-5, 10, 10);
        this.scene.add(fillLight1);
        
        // フィルライト2（追加）
        const fillLight2 = new THREE.DirectionalLight(0xaa6644, 0.4);
        fillLight2.position.set(5, 15, -10);
        this.scene.add(fillLight2);
        
        // リムライト（追加）
        const rimLight = new THREE.DirectionalLight(0xaaaaff, 0.3);
        rimLight.position.set(0, 5, 30);
        this.scene.add(rimLight);
    }
    
    _createGeometriesAndMaterials() {
        // === Track1: 黒い太め円柱（ピカピカな金属、大きく） ===
        this.geometries.track1Cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
        this.materials.track1Cyl = new THREE.MeshPhysicalMaterial({
            color: 0x0a0a0a,
            roughness: 0.15,
            metalness: 1.0,
            clearcoat: 0.8,
        });
        
        // Track1: シルバーのCircle（ピカピカな金属、大きく、厚みのある円盤で表現）
        this.geometries.track1Circle = new THREE.CylinderGeometry(0.6, 0.6, 0.05, 32);
        this.materials.track1Circle = new THREE.MeshPhysicalMaterial({
            color: 0x888888,
            roughness: 0.1,
            metalness: 1.0,
            clearcoat: 0.9,
        });
        
        // === Track5: 細め円柱（ピカピカな金属、もっと大きく） ===
        this.geometries.track5Cyl = new THREE.CylinderGeometry(0.35, 0.35, 1, 12);
        this.materials.track5Cyl = new THREE.MeshPhysicalMaterial({
            color: 0xcccccc,
            roughness: 0.1,
            metalness: 1.0,
            clearcoat: 0.9,
        });
        
        // Track5: 円柱のエッジ（上下の円）
        // Track5: 上のCircle（黒、大きく、厚みのある円盤で表現）
        this.geometries.track5Circle = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 24);
        this.materials.track5Circle = new THREE.MeshPhysicalMaterial({
            color: 0x0a0a0a,
            roughness: 0.15,
            metalness: 1.0,
            clearcoat: 0.8,
        });
        
        // Track5: 上のCircle（シルバー、円柱の一番上に載せる用）
        this.materials.track5CircleSilver = new THREE.MeshPhysicalMaterial({
            color: 0xc0c0c0, // シルバー
            roughness: 0.05,
            metalness: 1.0,
            clearcoat: 1.0,
        });
        
        // === Track6: 赤い細いシリンダー（小さく） ===
        this.geometries.track6 = new THREE.CylinderGeometry(0.025, 0.025, 1, 8);
        this.materials.track6 = new THREE.MeshPhysicalMaterial({
            color: 0xcc2222,
            roughness: 0.1,
            metalness: 1.0,
            clearcoat: 0.8,
            emissive: 0x440000,
            emissiveIntensity: 0.3,
        });
        
        // === モノリス（ピカピカな金属、幅を太く） ===
        this.geometries.monolith = new THREE.BoxGeometry(3.5, 9, 0.35); // 大きく（約1.15倍）
        this.materials.monolith = new THREE.MeshPhysicalMaterial({
            color: 0x020202,
            roughness: 0.2,
            metalness: 1.0,
            clearcoat: 0.9,
        });
        
        // モノリス: エッジマテリアル（EdgesGeometryは生成時に作成）
        this.materials.monolithEdge = new THREE.LineBasicMaterial({
            color: 0x020202,
            linewidth: 1,
        });
        
        // === Track8,9,10: シリンダーを「剥がした」ような薄い曲面金属片（それぞれ異なる形） ===
        // 高さがあって薄い、シリンダーの一部を剥がしたような形
        
        // Track8: シルバー - シリンダーの90度部分を剥がした形（高さあり、小さめ）
        this.geometries.track8 = new THREE.CylinderGeometry(
            0.8, 0.8, 1.5, 32, 1, true, 0, Math.PI / 2 // 半径0.8, 高さ1.5, 90度
        );
        this.materials.track8 = new THREE.MeshPhysicalMaterial({
            color: 0xc0c0c0, // シルバー
            roughness: 0.05,
            metalness: 1.0,
            clearcoat: 1.0,
            side: THREE.DoubleSide,
        });
        // Track9: 黒 - シリンダーの120度部分を剥がした形（高さあり、小さめ）
        this.geometries.track9 = new THREE.CylinderGeometry(
            0.6, 0.6, 1.8, 32, 1, true, 0, Math.PI * 2 / 3 // 半径0.6, 高さ1.8, 120度
        );
        this.materials.track9 = new THREE.MeshPhysicalMaterial({
            color: 0x0a0a0a, // 黒
            roughness: 0.15,
            metalness: 1.0,
            clearcoat: 0.8,
            side: THREE.DoubleSide,
        });
        // Track10: グレー - シリンダーの180度部分を剥がした形（高さあり、小さめ）
        this.geometries.track10 = new THREE.CylinderGeometry(
            1.0, 1.0, 1.2, 32, 1, true, 0, Math.PI // 半径1.0, 高さ1.2, 180度
        );
        this.materials.track10 = new THREE.MeshPhysicalMaterial({
            color: 0x606060, // グレー
            roughness: 0.1,
            metalness: 1.0,
            clearcoat: 0.9,
            side: THREE.DoubleSide,
        });
    }
    
    _createRoad() {
        const roadGeom = new THREE.PlaneGeometry(this.roadWidth, this.roadLength, 1, 100);
        roadGeom.rotateX(-Math.PI / 2);
        
        const roadMat = new THREE.MeshPhysicalMaterial({
            color: 0x1a1a1a,
            roughness: 0.2,
            metalness: 1.0,
            clearcoat: 0.7,
            side: THREE.DoubleSide,
        });
        
        this.road = new THREE.Mesh(roadGeom, roadMat);
        this.road.position.set(0, -0.5, 0);
        this.road.receiveShadow = true;
        this.scene.add(this.road);
    }
    
    // ノイズ関数
    _noise(x, y = 0) {
        const n = Math.sin(x * 12.9898 + y * 78.233 + this.noiseSeed) * 43758.5453;
        return n - Math.floor(n);
    }
    
    // 平行四辺形を作成（Track8用）
    _createParallelogram(size, thickness) {
        const geometry = new THREE.BufferGeometry();
        const halfSize = size * 0.5;
        const skew = 0.6; // X方向の歪み
        
        const vertices = new Float32Array([
            // 前面
            -halfSize, -halfSize, thickness,
            halfSize * skew, -halfSize, thickness,
            halfSize * skew, halfSize, thickness,
            -halfSize, halfSize, thickness,
            // 後面
            -halfSize, -halfSize, -thickness,
            halfSize * skew, -halfSize, -thickness,
            halfSize * skew, halfSize, -thickness,
            -halfSize, halfSize, -thickness,
        ]);
        
        const indices = new Uint16Array([
            0, 1, 2,  0, 2, 3,  // 前面
            4, 7, 6,  4, 6, 5,  // 後面
            0, 3, 7,  0, 7, 4,  // 左面
            1, 5, 6,  1, 6, 2,  // 右面
            3, 2, 6,  3, 6, 7,  // 上面
            0, 4, 5,  0, 5, 1,  // 下面
        ]);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        return geometry;
    }
    
    // 台形を作成（Track9用）
    _createTrapezoid(size, thickness) {
        const geometry = new THREE.BufferGeometry();
        const halfSize = size * 0.5;
        const topWidth = 0.7;  // 上辺の幅比
        const bottomWidth = 1.0; // 下辺の幅比
        
        const vertices = new Float32Array([
            // 前面
            -halfSize * bottomWidth, -halfSize, thickness,  // 左下
            halfSize * bottomWidth, -halfSize, thickness,   // 右下
            halfSize * topWidth, halfSize, thickness,       // 右上
            -halfSize * topWidth, halfSize, thickness,      // 左上
            // 後面
            -halfSize * bottomWidth, -halfSize, -thickness,
            halfSize * bottomWidth, -halfSize, -thickness,
            halfSize * topWidth, halfSize, -thickness,
            -halfSize * topWidth, halfSize, -thickness,
        ]);
        
        const indices = new Uint16Array([
            0, 1, 2,  0, 2, 3,  // 前面
            4, 7, 6,  4, 6, 5,  // 後面
            0, 3, 7,  0, 7, 4,  // 左面
            1, 5, 6,  1, 6, 2,  // 右面
            3, 2, 6,  3, 6, 7,  // 上面
            0, 4, 5,  0, 5, 1,  // 下面
        ]);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        return geometry;
    }
    
    // 菱形を作成（Track10用）
    _createDiamond(size, thickness) {
        const geometry = new THREE.BufferGeometry();
        const halfSize = size * 0.5;
        
        const vertices = new Float32Array([
            // 前面（菱形）
            0, -halfSize, thickness,        // 下
            halfSize, 0, thickness,         // 右
            0, halfSize, thickness,         // 上
            -halfSize, 0, thickness,        // 左
            // 後面
            0, -halfSize, -thickness,
            halfSize, 0, -thickness,
            0, halfSize, -thickness,
            -halfSize, 0, -thickness,
        ]);
        
        const indices = new Uint16Array([
            0, 1, 2,  0, 2, 3,  // 前面
            4, 7, 6,  4, 6, 5,  // 後面
            0, 3, 7,  0, 7, 4,  // 左面
            1, 5, 6,  1, 6, 2,  // 右面
            3, 2, 6,  3, 6, 7,  // 上面
            0, 4, 5,  0, 5, 1,  // 下面
        ]);
        
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.computeVertexNormals();
        return geometry;
    }
    
    // 曲面の平行四辺形を作成（Track8用、四隅がとんがってる）
    _createWarpedParallelogram(size, thickness) {
        const geometry = new THREE.BufferGeometry();
        const halfSize = size * 0.5;
        const skew = 0.6;
        const segments = 8; // 曲面の分割数
        const curveAmount = 0.3; // 曲がりの強さ
        const cornerSharpness = 0.2; // 四隅のとんがり具合
        
        const vertices = [];
        const indices = [];
        
        // 前面と後面を曲面で作成（四隅をとんがらせる）
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const y = -halfSize + (halfSize * 2 * t);
            const curve = Math.sin(t * Math.PI) * curveAmount * halfSize;
            
            // 四隅をとんがらせる（端に近いほど外側に）
            const cornerX = Math.abs(t - 0.5) > 0.3 ? cornerSharpness * halfSize * Math.sign(t - 0.5) : 0;
            const cornerY = Math.abs(t - 0.5) > 0.3 ? cornerSharpness * halfSize * Math.sign(t - 0.5) : 0;
            
            // 前面
            vertices.push(-halfSize + curve + cornerX, y + cornerY, thickness);
            vertices.push(halfSize * skew + curve + cornerX, y + cornerY, thickness);
            // 後面
            vertices.push(-halfSize + curve + cornerX, y + cornerY, -thickness);
            vertices.push(halfSize * skew + curve + cornerX, y + cornerY, -thickness);
        }
        
        // インデックスを生成
        for (let i = 0; i < segments; i++) {
            const base = i * 4;
            // 前面
            indices.push(base, base + 1, base + 5);
            indices.push(base, base + 5, base + 4);
            // 後面
            indices.push(base + 2, base + 7, base + 3);
            indices.push(base + 2, base + 6, base + 7);
            // 側面
            indices.push(base, base + 4, base + 6);
            indices.push(base, base + 6, base + 2);
            indices.push(base + 1, base + 3, base + 7);
            indices.push(base + 1, base + 7, base + 5);
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
        geometry.computeVertexNormals();
        return geometry;
    }
    
    // 曲面の台形を作成（Track9用、四隅がとんがってる）
    _createWarpedTrapezoid(size, thickness) {
        const geometry = new THREE.BufferGeometry();
        const halfSize = size * 0.5;
        const topWidth = 0.7;
        const bottomWidth = 1.0;
        const segments = 8;
        const curveAmount = 0.4;
        const cornerSharpness = 0.25;
        
        const vertices = [];
        const indices = [];
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const y = -halfSize + (halfSize * 2 * t);
            const width = bottomWidth + (topWidth - bottomWidth) * t;
            const curve = Math.sin(t * Math.PI) * curveAmount * halfSize;
            
            // 四隅をとんがらせる
            const cornerX = Math.abs(t - 0.5) > 0.3 ? cornerSharpness * halfSize * width * Math.sign(t - 0.5) : 0;
            const cornerY = Math.abs(t - 0.5) > 0.3 ? cornerSharpness * halfSize * Math.sign(t - 0.5) : 0;
            
            vertices.push(-halfSize * width + curve + cornerX, y + cornerY, thickness);
            vertices.push(halfSize * width + curve + cornerX, y + cornerY, thickness);
            vertices.push(-halfSize * width + curve + cornerX, y + cornerY, -thickness);
            vertices.push(halfSize * width + curve + cornerX, y + cornerY, -thickness);
        }
        
        for (let i = 0; i < segments; i++) {
            const base = i * 4;
            indices.push(base, base + 1, base + 5);
            indices.push(base, base + 5, base + 4);
            indices.push(base + 2, base + 7, base + 3);
            indices.push(base + 2, base + 6, base + 7);
            indices.push(base, base + 4, base + 6);
            indices.push(base, base + 6, base + 2);
            indices.push(base + 1, base + 3, base + 7);
            indices.push(base + 1, base + 7, base + 5);
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
        geometry.computeVertexNormals();
        return geometry;
    }
    
    // 曲面の菱形を作成（Track10用、四隅がとんがってる）
    _createWarpedDiamond(size, thickness) {
        const geometry = new THREE.BufferGeometry();
        const halfSize = size * 0.5;
        const segments = 8;
        const curveAmount = 0.25;
        const cornerSharpness = 0.3;
        
        const vertices = [];
        const indices = [];
        
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * halfSize;
            const y = Math.sin(angle) * halfSize;
            const curve = Math.sin((i / segments) * Math.PI) * curveAmount * halfSize;
            
            // 四隅をとんがらせる（0, 90, 180, 270度の位置）
            const cornerAngle = Math.abs(angle % (Math.PI / 2));
            const cornerDist = cornerAngle < 0.2 ? cornerSharpness * halfSize : 0;
            const cornerX = Math.cos(angle) * cornerDist;
            const cornerY = Math.sin(angle) * cornerDist;
            
            vertices.push(x + curve + cornerX, y + cornerY, thickness);
            vertices.push(x + curve + cornerX, y + cornerY, -thickness);
        }
        
        for (let i = 0; i < segments; i++) {
            const base = i * 2;
            const next = ((i + 1) % (segments + 1)) * 2;
            indices.push(base, next, next + 1);
            indices.push(base, next + 1, base + 1);
            indices.push(base, base + 1, next + 1);
            indices.push(base, next + 1, next);
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
        geometry.computeVertexNormals();
        return geometry;
    }
    
    // ツノっぽい形状を作成（三角錐、四角形、ひし形を曲面で表現）
    _createHornShape(size, thickness, sides = 4, isDiamond = false) {
        const geometry = new THREE.BufferGeometry();
        const halfSize = size * 0.5;
        const heightSegments = 12; // 高さ方向の分割数
        const segmentsPerSide = 4; // 各辺の分割数
        const curveAmount = 0.5; // 曲がりの強さ
        const tipSharpness = 0.8; // 先端のとんがり具合
        
        const vertices = [];
        const indices = [];
        
        // 底面の頂点を定義
        const baseAngles = [];
        for (let i = 0; i < sides; i++) {
            let angle;
            if (isDiamond) {
                // ひし形の場合（45度回転）
                angle = (i / sides) * Math.PI * 2 + Math.PI / 4;
            } else {
                angle = (i / sides) * Math.PI * 2;
            }
            baseAngles.push(angle);
        }
        
        // 高さ方向に分割して曲面を作成
        for (let h = 0; h <= heightSegments; h++) {
            const heightT = h / heightSegments;
            // 先端に向かって細くなる（ツノっぽく）
            const radiusScale = 1 - Math.pow(heightT, 1.5);
            const currentRadius = halfSize * radiusScale;
            
            // 各辺を分割
            for (let s = 0; s < sides; s++) {
                const angle1 = baseAngles[s];
                const angle2 = baseAngles[(s + 1) % sides];
                
                // 辺に沿った位置
                for (let i = 0; i <= segmentsPerSide; i++) {
                    const t = i / segmentsPerSide;
                    const angle = angle1 + (angle2 - angle1) * t;
                    
                    // 基本位置
                    const baseX = Math.cos(angle) * currentRadius;
                    const baseY = Math.sin(angle) * currentRadius;
                    const baseZ = heightT * size * 0.6; // 高さ
                    
                    // 曲面の歪み（sin波で）
                    const curve = Math.sin(heightT * Math.PI) * curveAmount * currentRadius;
                    const curveX = Math.cos(angle) * curve;
                    const curveY = Math.sin(angle) * curve;
                    
                    // 先端をとんがらせる
                    const tipDist = heightT > 0.6 ? tipSharpness * currentRadius * Math.pow((heightT - 0.6) / 0.4, 2) : 0;
                    const tipX = Math.cos(angle) * tipDist;
                    const tipY = Math.sin(angle) * tipDist;
                    
                    // 前面と後面の頂点
                    const finalX = baseX + curveX + tipX;
                    const finalY = baseY + curveY + tipY;
                    
                    vertices.push(finalX, finalY, baseZ + thickness);
                    vertices.push(finalX, finalY, baseZ - thickness);
                }
            }
        }
        
        // インデックスを生成
        const pointsPerSide = segmentsPerSide + 1;
        for (let h = 0; h < heightSegments; h++) {
            for (let s = 0; s < sides; s++) {
                const baseH = h * sides * pointsPerSide * 2;
                const nextH = (h + 1) * sides * pointsPerSide * 2;
                const baseS = s * pointsPerSide * 2;
                const nextS = ((s + 1) % sides) * pointsPerSide * 2;
                
                for (let i = 0; i < segmentsPerSide; i++) {
                    const base = baseH + baseS + i * 2;
                    const next = baseH + baseS + (i + 1) * 2;
                    const baseNextS = baseH + nextS + i * 2;
                    const nextNextS = baseH + nextS + (i + 1) * 2;
                    const baseNextH = nextH + baseS + i * 2;
                    const nextNextH = nextH + baseS + (i + 1) * 2;
                    
                    // 前面
                    indices.push(base, next, nextNextS);
                    indices.push(base, nextNextS, baseNextS);
                    // 後面
                    indices.push(base + 1, nextNextS + 1, next + 1);
                    indices.push(base + 1, baseNextS + 1, nextNextS + 1);
                    // 側面（高さ方向）
                    if (h < heightSegments - 1) {
                        indices.push(base, baseNextH, nextNextH);
                        indices.push(base, nextNextH, next);
                    }
                }
            }
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
        geometry.computeVertexNormals();
        return geometry;
    }
    
    // ひし形を歪ませた薄い曲面を作成（Track8,9,10用、画像に近い複雑な形状）
    _createWarpedDiamondShape(size, thickness, xSkew = 1.0, ySkew = 1.0) {
        const geometry = new THREE.BufferGeometry();
        const halfSize = size * 0.5;
        const segments = 24; // より滑らかで複雑な曲面
        const curveAmount = 0.5; // 曲がりの強さ（強め）
        const cornerSharpness = 0.8; // 四隅のとんがり具合（非常に強め）
        const twistAmount = 0.3; // ねじれの強さ
        
        const vertices = [];
        const indices = [];
        
        // ひし形の4つの頂点を定義（45度回転させたひし形）
        const diamondAngles = [
            Math.PI / 4,        // 右上
            Math.PI * 3 / 4,    // 左上
            Math.PI * 5 / 4,    // 左下
            Math.PI * 7 / 4     // 右下
        ];
        
        // 各頂点を周回して複雑な曲面を作成
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angleIndex = Math.floor(t * 4) % 4;
            const nextAngleIndex = (angleIndex + 1) % 4;
            const localT = (t * 4) % 1;
            
            const angle1 = diamondAngles[angleIndex];
            const angle2 = diamondAngles[nextAngleIndex];
            
            // ひし形の辺に沿った位置（線形補間）
            const x1 = Math.cos(angle1) * halfSize * xSkew;
            const y1 = Math.sin(angle1) * halfSize * ySkew;
            const x2 = Math.cos(angle2) * halfSize * xSkew;
            const y2 = Math.sin(angle2) * halfSize * ySkew;
            
            const baseX = x1 + (x2 - x1) * localT;
            const baseY = y1 + (y2 - y1) * localT;
            
            // 複雑な曲面の歪み（複数のsin波の組み合わせ）
            const curve1 = Math.sin(localT * Math.PI) * curveAmount * halfSize;
            const curve2 = Math.sin(localT * Math.PI * 2) * curveAmount * 0.3 * halfSize;
            const curve = curve1 + curve2;
            const midAngle = angle1 + (angle2 - angle1) * localT;
            const curveX = Math.cos(midAngle) * curve;
            const curveY = Math.sin(midAngle) * curve;
            
            // ねじれ（Z軸周りの回転）
            const twist = Math.sin(t * Math.PI * 2) * twistAmount * halfSize;
            const twistX = Math.cos(midAngle + Math.PI / 2) * twist;
            const twistY = Math.sin(midAngle + Math.PI / 2) * twist;
            
            // 四隅をとんがらせる（頂点に近いほど外側に、より鋭く）
            const cornerDist = (localT < 0.15 || localT > 0.85) ? 
                cornerSharpness * halfSize * Math.pow(1 - Math.abs(localT - 0.5) * 2, 0.5) : 0;
            const cornerX = Math.cos(midAngle) * cornerDist;
            const cornerY = Math.sin(midAngle) * cornerDist;
            
            // 前面と後面の頂点（ねじれも適用）
            const finalX = baseX + curveX + cornerX + twistX;
            const finalY = baseY + curveY + cornerY + twistY;
            
            vertices.push(finalX, finalY, thickness);
            vertices.push(finalX, finalY, -thickness);
        }
        
        // インデックスを生成（前面、後面、側面）
        for (let i = 0; i < segments; i++) {
            const base = i * 2;
            const next = ((i + 1) % (segments + 1)) * 2;
            
            // 前面
            indices.push(base, next, next + 1);
            indices.push(base, next + 1, base + 1);
            // 後面
            indices.push(base + 1, next + 1, next);
            indices.push(base + 1, next, base);
            // 側面（エッジ）
            indices.push(base, base + 1, next + 1);
            indices.push(base, next + 1, next);
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
        geometry.computeVertexNormals();
        return geometry;
    }
    
    // Track1: 黒い太め円柱 + ランダムCircle（X位置をノイズに乗せる）
    _spawnTrack1Object(z, velocity = 100, durationMs = 0) {
        const v01 = velocity / 127;
        // Track1専用のノイズ（道の幅いっぱいに振れる）
        const noiseOffset = (this._noise(z * 0.008 + 0) - 0.5) * 4.0; // より大きく
        this.lastTrack1X += noiseOffset;
        this.lastTrack1X = Math.max(-this.roadWidth * 0.48, Math.min(this.roadWidth * 0.48, this.lastTrack1X));
        const noiseX = this.lastTrack1X;
        const height = 1.5 + v01 * 3;
        const scale = (0.8 + v01 * 0.4) * 1.4; // 大きく（1.4倍）
        
        // グループで管理
        const group = new THREE.Group();
        group.position.set(noiseX, -height, z); // 初期位置を下に（アニメーション用）
        // グループの回転を明示的に0に設定（サークルの回転に影響しないように）
        group.rotation.set(0, 0, 0);
        
        // 円柱（元に戻す：垂直）
        const cyl = new THREE.Mesh(this.geometries.track1Cyl, this.materials.track1Cyl);
        cyl.scale.set(scale, height, scale);
        cyl.position.y = height / 2;
        cyl.castShadow = true;
        group.add(cyl);
        
        // ランダムなCircle（1〜4個、一番上には来ない）
        const circleCount = 1 + Math.floor(this._noise(z * 0.2) * 4);
        for (let i = 0; i < circleCount; i++) {
            const circleY = 0.3 + this._noise(z * 0.3 + i) * (height - 0.8);
            const circleScale = 0.6 + this._noise(z * 0.4 + i) * 0.8;
            
            // Track1のサークルエフェクトと同じ方法：グループで回転を管理（sceneに直接追加）
            const circleGroup = new THREE.Group();
            // 初期位置を下に設定（生えてくるアニメーション用）
            circleGroup.position.set(noiseX, -height + circleY, z);
            circleGroup.userData.isCircleGroup = true; // サークルグループのマーク
            
            const circle = new THREE.Mesh(this.geometries.track1Circle, this.materials.track1Circle);
            circle.scale.set(circleScale * scale, circleScale * scale, circleScale * scale);
            // Circleメッシュ自体を回転させる（グループじゃなくてメッシュに直接）
            circle.rotation.x = Math.PI; // 180度回転して水平にする
            circle.castShadow = true;
            circleGroup.add(circle);
            
            // サークルのエッジ
            
            this.scene.add(circleGroup);
            // アニメーション用のデータを追加
            const spawnTime = performance.now();
            const duration = durationMs > 0 ? durationMs : 500;
            this.track1CircleGroups = this.track1CircleGroups || [];
            this.track1CircleGroups.push({
                group: circleGroup,
                baseY: -height + circleY,
                targetY: circleY,
                spawnTime: spawnTime,
                duration: duration
            });
        }
        
        this.scene.add(group);
        
        this.track1Objects.push({ 
            mesh: group, 
            z,
            spawnTime: performance.now(),
            duration: durationMs > 0 ? durationMs : 500,
            baseY: -height,
            targetHeight: -0.5  // 道の上（-0.5）に配置
        });
    }
    
    // Track5: 細め円柱 + ランダムなCircle（位置・大きさランダム）
    _spawnTrack5Object(z, velocity = 100, durationMs = 0) {
        const v01 = velocity / 127;
        // Track5専用のノイズ（道の幅いっぱいに振れる）
        const noiseOffset = (this._noise(z * 0.008 + 1000) - 0.5) * 4.0; // より大きく
        this.lastTrack5X += noiseOffset;
        this.lastTrack5X = Math.max(-this.roadWidth * 0.48, Math.min(this.roadWidth * 0.48, this.lastTrack5X));
        const noiseX = this.lastTrack5X;
        
        // 大きさもランダムに（大きく）
        const baseHeight = 0.5 + v01 * 1.0;
        const heightVariation = (this._noise(z * 0.3) - 0.5) * 0.8;
        const height = (baseHeight + heightVariation) * 1.3; // 大きく（1.3倍）
        
        const baseScale = 0.7 + v01 * 0.3;
        const scaleVariation = (this._noise(z * 0.4) - 0.5) * 0.4;
        const scale = (baseScale + scaleVariation) * 1.5; // 大きく（1.5倍）
        
        const group = new THREE.Group();
        group.position.set(noiseX, -height, z); // 初期位置を下に（アニメーション用）
        // グループの回転を明示的に0に設定（サークルの回転に影響しないように）
        group.rotation.set(0, 0, 0);
        
        // 円柱（元に戻す：垂直）
        const cyl = new THREE.Mesh(this.geometries.track5Cyl, this.materials.track5Cyl);
        cyl.scale.set(scale, height, scale);
        cyl.position.y = height / 2;
        cyl.castShadow = true;
        group.add(cyl);
        
        // ランダムなCircle（1枚は必ず円柱の一番上に、追加で0〜2個ランダム配置）
        const circleCount = 1 + Math.floor(this._noise(z * 0.2) * 3);
        for (let i = 0; i < circleCount; i++) {
            let circleY;
            let circleScale;
            let circleMaterial;
            
            if (i === 0) {
                // 最初の1枚は必ず円柱の一番上にぴったり配置
                circleY = height; // 円柱の天面にぴったり載せる
                // 円柱より大きくする（1.5倍）
                circleScale = 1.5;
                // シルバーマテリアルを使用
                circleMaterial = this.materials.track5CircleSilver;
            } else {
                // 残りはランダムに配置（円柱の上から少し下まで）
                circleY = height * 0.3 + this._noise(z * 0.3 + i * 100) * height * 0.7;
                // 大きさをランダムに
                circleScale = 0.5 + this._noise(z * 0.4 + i * 200) * 0.8;
                // 通常の黒マテリアルを使用
                circleMaterial = this.materials.track5Circle;
            }
            
            // Track1のサークルエフェクトと同じ方法：グループで回転を管理（sceneに直接追加）
            const circleGroup = new THREE.Group();
            // 初期位置を下に設定（生えてくるアニメーション用）
            circleGroup.position.set(noiseX, -height + circleY, z);
            circleGroup.userData.isCircleGroup = true; // サークルグループのマーク
            
            const circle = new THREE.Mesh(this.geometries.track5Circle, circleMaterial);
            circle.scale.set(circleScale * scale, circleScale * scale, circleScale * scale);
            // Circleメッシュ自体を回転させる（グループじゃなくてメッシュに直接）
            circle.rotation.x = Math.PI; // 180度回転して水平にする
            circle.castShadow = true;
            circleGroup.add(circle);
            
            // サークルのエッジ（水平にする）
            
            this.scene.add(circleGroup);
            // アニメーション用のデータを追加
            const spawnTime = performance.now();
            const duration = durationMs > 0 ? durationMs : 500;
            this.track5CircleGroups = this.track5CircleGroups || [];
            this.track5CircleGroups.push({
                group: circleGroup,
                baseY: -height + circleY,
                targetY: circleY,
                spawnTime: spawnTime,
                duration: duration
            });
        }
        
        // アニメーション用のデータを追加
        const spawnTime = performance.now();
        const duration = durationMs > 0 ? durationMs : 500;
        
        this.scene.add(group);
        this.track5Objects.push({ 
            mesh: group, 
            z,
            spawnTime,
            duration,
            baseY: -height,
            targetHeight: -0.5  // 道の上（-0.5）に配置
        });
        
        // Track5での注視点更新は削除（痙攣を防ぐため）
    }
    
    // Track6: 赤い細いシリンダー
    _spawnTrack6Object(z, velocity = 100, durationMs = 0) {
        const v01 = velocity / 127;
        const height = (2 + v01 * 8) * 0.9; // 大きく（0.9倍）
        
        const group = new THREE.Group();
        group.position.set(0, -height, z); // 初期位置を下に（アニメーション用）
        
        const mesh = new THREE.Mesh(this.geometries.track6, this.materials.track6);
        mesh.scale.set(1.2, height, 1.2); // 横方向も大きく
        mesh.position.y = height / 2;
        mesh.castShadow = true;
        group.add(mesh);
        
        // アニメーション用のデータを追加
        const spawnTime = performance.now();
        const duration = durationMs > 0 ? durationMs : 500;
        
        this.scene.add(group);
        this.track6Objects.push({ 
            mesh: group, 
            z,
            spawnTime,
            duration,
            baseY: -height,
            targetHeight: -0.5  // 道の上（-0.5）に配置
        });
    }
    
    // Track8: シルバーの曲面金属片（X位置と角度、高さを蛇のように）
    _spawnTrack8Object(z, velocity = 100, durationMs = 0) {
        const v01 = velocity / 127;
        
        // X位置をノイズで蛇のように（Track5と同じ周期）
        const noiseOffsetX = (this._noise(z * 0.008 + 2000) - 0.5) * 4.0;
        this.lastTrack8X += noiseOffsetX;
        this.lastTrack8X = Math.max(-this.roadWidth * 0.48, Math.min(this.roadWidth * 0.48, this.lastTrack8X));
        const noiseX = this.lastTrack8X;
        
        // 角度をノイズで蛇のように（もっとゆったり変化）
        const noiseOffsetRotX = (this._noise(z * 0.0003 + 2100) - 0.5) * 0.3;
        const noiseOffsetRotY = (this._noise(z * 0.0003 + 2200) - 0.5) * 0.3;
        const noiseOffsetRotZ = (this._noise(z * 0.0003 + 2300) - 0.5) * 0.3;
        this.lastTrack8RotX += noiseOffsetRotX;
        this.lastTrack8RotY += noiseOffsetRotY;
        this.lastTrack8RotZ += noiseOffsetRotZ;
        
        // 高さをランダムに（バリエーション増加）
        const baseHeight = 0.5 + v01 * 1.5;
        const heightVariation = (this._noise(z * 0.3 + 2000) - 0.5) * 1.5; // バリエーション増加（1.0 → 1.5）
        const height = baseHeight + heightVariation;
        
        // 大きさにもバリエーションを追加
        const baseScale = 0.8 + v01 * 0.6;
        const scaleVariation = (this._noise(z * 0.4 + 2100) - 0.5) * 0.3; // 大きさのバリエーション
        const scale = (baseScale + scaleVariation) * 1.2; // 大きく（1.2倍）
        
        const group = new THREE.Group();
        group.position.set(noiseX, 0, z);
        group.rotation.set(this.lastTrack8RotX, this.lastTrack8RotY, this.lastTrack8RotZ);
        
        const mesh = new THREE.Mesh(this.geometries.track8, this.materials.track8);
        mesh.scale.set(scale, scale, scale);
        mesh.castShadow = true;
        group.add(mesh);
        
        // エッジ
        // アニメーション用のデータを追加
        const spawnTime = performance.now();
        const duration = durationMs > 0 ? durationMs : 500;
        
        // 初期位置を下に設定（生えてくるアニメーション用）
        group.position.y = -height;
        
        this.scene.add(group);
        this.track8Objects.push({ 
            mesh: group, 
            z,
            spawnTime,
            duration,
            baseY: -height,
            targetHeight: -0.5 + height * 0.5  // 道の上（-0.5）から高さの半分
        });
    }
    
    // Track9: 黒の曲面金属片（X位置と角度、高さを蛇のように）
    _spawnTrack9Object(z, velocity = 100, durationMs = 0) {
        const v01 = velocity / 127;
        
        // X位置をノイズで蛇のように（Track5と同じ周期）
        const noiseOffsetX = (this._noise(z * 0.008 + 3000) - 0.5) * 4.0;
        this.lastTrack9X += noiseOffsetX;
        this.lastTrack9X = Math.max(-this.roadWidth * 0.48, Math.min(this.roadWidth * 0.48, this.lastTrack9X));
        const noiseX = this.lastTrack9X;
        
        // 角度をノイズで蛇のように（もっとゆったり変化）
        const noiseOffsetRotX = (this._noise(z * 0.0003 + 3100) - 0.5) * 0.3;
        const noiseOffsetRotY = (this._noise(z * 0.0003 + 3200) - 0.5) * 0.3;
        const noiseOffsetRotZ = (this._noise(z * 0.0003 + 3300) - 0.5) * 0.3;
        this.lastTrack9RotX += noiseOffsetRotX;
        this.lastTrack9RotY += noiseOffsetRotY;
        this.lastTrack9RotZ += noiseOffsetRotZ;
        
        // 高さをランダムに（バリエーション増加）
        const baseHeight = 0.5 + v01 * 1.5;
        const heightVariation = (this._noise(z * 0.3 + 3000) - 0.5) * 1.5; // バリエーション増加（1.0 → 1.5）
        const height = baseHeight + heightVariation;
        
        // 大きさにもバリエーションを追加
        const baseScale = 0.8 + v01 * 0.6;
        const scaleVariation = (this._noise(z * 0.4 + 3100) - 0.5) * 0.3; // 大きさのバリエーション
        const scale = (baseScale + scaleVariation) * 1.2; // 大きく（1.2倍）
        
        const group = new THREE.Group();
        group.position.set(noiseX, 0, z);
        group.rotation.set(this.lastTrack9RotX, this.lastTrack9RotY, this.lastTrack9RotZ);
        
        const mesh = new THREE.Mesh(this.geometries.track9, this.materials.track9);
        mesh.scale.set(scale, scale, scale);
        mesh.castShadow = true;
        group.add(mesh);
        
        // エッジ
        // アニメーション用のデータを追加
        const spawnTime = performance.now();
        const duration = durationMs > 0 ? durationMs : 500;
        
        // 初期位置を下に設定（生えてくるアニメーション用）
        group.position.y = -height;
        
        this.scene.add(group);
        this.track9Objects.push({ 
            mesh: group, 
            z,
            spawnTime,
            duration,
            baseY: -height,
            targetHeight: -0.5 + height * 0.5  // 道の上（-0.5）から高さの半分
        });
    }
    
    // Track10: グレーの曲面金属片（X位置と角度、高さを蛇のように）
    _spawnTrack10Object(z, velocity = 100, durationMs = 0) {
        const v01 = velocity / 127;
        
        // X位置をノイズで蛇のように（Track5と同じ周期）
        const noiseOffsetX = (this._noise(z * 0.008 + 4000) - 0.5) * 4.0;
        this.lastTrack10X += noiseOffsetX;
        this.lastTrack10X = Math.max(-this.roadWidth * 0.48, Math.min(this.roadWidth * 0.48, this.lastTrack10X));
        const noiseX = this.lastTrack10X;
        
        // 角度をノイズで蛇のように（もっとゆったり変化）
        const noiseOffsetRotX = (this._noise(z * 0.0003 + 4100) - 0.5) * 0.3;
        const noiseOffsetRotY = (this._noise(z * 0.0003 + 4200) - 0.5) * 0.3;
        const noiseOffsetRotZ = (this._noise(z * 0.0003 + 4300) - 0.5) * 0.3;
        this.lastTrack10RotX += noiseOffsetRotX;
        this.lastTrack10RotY += noiseOffsetRotY;
        this.lastTrack10RotZ += noiseOffsetRotZ;
        
        // 高さをランダムに（バリエーション増加）
        const baseHeight = 0.5 + v01 * 1.5;
        const heightVariation = (this._noise(z * 0.3 + 4000) - 0.5) * 1.5; // バリエーション増加（1.0 → 1.5）
        const height = baseHeight + heightVariation;
        
        // 大きさにもバリエーションを追加
        const baseScale = 0.8 + v01 * 0.6;
        const scaleVariation = (this._noise(z * 0.4 + 4100) - 0.5) * 0.3; // 大きさのバリエーション
        const scale = (baseScale + scaleVariation) * 1.2; // 大きく（1.2倍）
        
        const group = new THREE.Group();
        group.position.set(noiseX, 0, z);
        group.rotation.set(this.lastTrack10RotX, this.lastTrack10RotY, this.lastTrack10RotZ);
        
        const mesh = new THREE.Mesh(this.geometries.track10, this.materials.track10);
        mesh.scale.set(scale, scale, scale);
        mesh.castShadow = true;
        group.add(mesh);
        
        // エッジ
        // アニメーション用のデータを追加
        const spawnTime = performance.now();
        const duration = durationMs > 0 ? durationMs : 500;
        
        // 初期位置を下に設定（生えてくるアニメーション用）
        group.position.y = -height;
        
        this.scene.add(group);
        this.track10Objects.push({ 
            mesh: group, 
            z,
            spawnTime,
            duration,
            baseY: -height,
            targetHeight: -0.5 + height * 0.5  // 道の上（-0.5）から高さの半分
        });
    }
    
    // モノリス生成
    _spawnMonolith(z, durationMs = 0) {
        const group = new THREE.Group();
        group.position.set(0, -4, z); // 初期位置を下に（アニメーション用）
        
        const mesh = new THREE.Mesh(this.geometries.monolith, this.materials.monolith);
        mesh.castShadow = true;
        group.add(mesh);
        
        // モノリスのエッジ
        const edgeGeometry = new THREE.EdgesGeometry(this.geometries.monolith);
        const edgeLines = new THREE.LineSegments(edgeGeometry, this.materials.monolithEdge);
        group.add(edgeLines);
        
        // アニメーション用のデータを追加
        const spawnTime = performance.now();
        const duration = durationMs > 0 ? durationMs : 500;
        
        this.scene.add(group);
        this.monolithObjects.push({ 
            mesh: group, 
            z,
            spawnTime,
            duration,
            baseY: -4,
            targetHeight: -0.5 + 4  // 道の上（-0.5）から4の高さ
        });
    }
    
    // 注視点を更新（使用しない - 痙攣を防ぐため）
    _updateLookAtTarget(targetPosition) {
        // 注視点の更新は削除（自動的に前方を注視するように変更）
    }
    
    // 前方のオブジェクトを探す（leadモード用）
    _findForwardObject(cameraZ) {
        const searchRange = 50; // 前方50ユニット以内を検索
        const minZ = cameraZ;
        const maxZ = cameraZ + searchRange;
        
        let closestObj = null;
        let closestDist = Infinity;
        
        // すべてのオブジェクト配列をチェック
        const allObjects = [
            ...this.track1Objects,
            ...this.track5Objects,
            ...this.track6Objects,
            ...this.track8Objects,
            ...this.track9Objects,
            ...this.track10Objects,
            ...this.monolithObjects
        ];
        
        for (const obj of allObjects) {
            if (!obj.mesh) continue;
            const objZ = obj.z;
            const objY = obj.mesh.position.y;
            
            // 前方にあるオブジェクトのみ
            if (objZ >= minZ && objZ <= maxZ) {
                const dist = Math.abs(objZ - cameraZ);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestObj = { x: obj.mesh.position.x, y: objY, z: objZ };
                }
            }
        }
        
        return closestObj;
    }
    
    _updateCameraPosition() {
        const cameraZ = this.roadProgress;
        
        // カメラパーティクルの更新
        if (this.cameraParticle) {
            this.cameraParticle.update();
            
            // Z位置は道の進行に合わせる
            if (this.cameraMode === 'follow') {
                this.cameraParticle.position.z = cameraZ - 15;
            } else {
                // leadモード：もっと前方に離す
                this.cameraParticle.position.z = cameraZ + 25;
            }
            
            // Y座標の制限（高さを制限）
            this.cameraParticle.position.y = Math.max(-5, Math.min(30, this.cameraParticle.position.y));
            
            // カメラ位置をパーティクル位置に同期
            this.camera.position.copy(this.cameraParticle.position);
        }
        
        if (this.cameraMode === 'follow') {
            // followモード：後ろから追いかける（注視点を固定して滑らかに）
            // 注視点をカメラの前方に固定（オブジェクトに追従しない）
            const lookAtZ = cameraZ + 20;
            const lookAtY = 1;
            
            // 目標位置を直接計算（goalを使わない）
            this.lookAtTarget.set(0, lookAtY, lookAtZ);
        } else {
            // leadモード：前方のオブジェクトを注視（更新頻度を下げる）
            const forwardObj = this._findForwardObject(cameraZ);
            const now = performance.now();
            
            if (forwardObj) {
                // 前方のオブジェクトが見つかったら、それを注視（更新頻度を下げる）
                const targetPos = new THREE.Vector3(forwardObj.x, forwardObj.y, forwardObj.z);
                // 距離が一定以上離れた時だけ更新（痙攣を防ぐ）
                const distToGoal = this.lookAtGoal.distanceTo(targetPos);
                if (distToGoal > 5.0 && now - this.lastLookAtChangeTime > this.lookAtMinInterval * 3) {
                    this.lookAtGoal.copy(targetPos);
                    this.lastLookAtChangeTime = now;
                }
            } else {
                // オブジェクトが見つからない場合はデフォルト位置（固定）
                const defaultLookAt = new THREE.Vector3(0, 1, cameraZ + 30);
                // 距離が一定以上離れた時だけ更新
                const distToGoal = this.lookAtGoal.distanceTo(defaultLookAt);
                if (distToGoal > 10.0) {
                    this.lookAtGoal.copy(defaultLookAt);
                }
            }
            
            // lerpFactorを大きくして滑らかに（痙攣を防ぐ）
            const lerpFactor = 0.25; // 0.15 → 0.25 に変更（さらに滑らかに）
            this.lookAtTarget.lerp(this.lookAtGoal, lerpFactor);
        }
        
        this.camera.lookAt(this.lookAtTarget);
        
        if (this.dirLight) {
            this.dirLight.position.set(10, 30, cameraZ - 20);
            this.dirLight.target.position.set(0, 0, cameraZ);
        }
    }
    
    // オブジェクトの生えてくるアニメーションを処理
    _updateObjectAnimations(deltaTime = 0.016) {
        const now = performance.now();
        
        const updateAnimations = (arr) => {
            for (let i = 0; i < arr.length; i++) {
                const obj = arr[i];
                if (obj.spawnTime && obj.duration && obj.targetHeight !== undefined) {
                    const elapsed = now - obj.spawnTime;
                    const progress = Math.min(elapsed / obj.duration, 1.0);
                    
                    // イージング関数（easeOutCubic）
                    const eased = 1 - Math.pow(1 - progress, 3);
                    
                    // Y位置を下から上にアニメーション
                    const currentY = obj.baseY + (obj.targetHeight - obj.baseY) * eased;
                    
                    // メッシュまたはグループの位置を更新
                    if (obj.mesh) {
                        // GroupまたはMeshの場合、Y位置を更新
                        obj.mesh.position.y = currentY;
                    }
                }
            }
        };
        
        updateAnimations(this.track1Objects);
        updateAnimations(this.track5Objects);
        updateAnimations(this.track6Objects);
        updateAnimations(this.track8Objects);
        updateAnimations(this.track9Objects);
        updateAnimations(this.track10Objects);
        updateAnimations(this.monolithObjects);
        
        // Track1とTrack5のサークルグループのアニメーション（sceneに直接追加されたもの）
        const updateCircleGroups = (arr) => {
            for (let i = 0; i < arr.length; i++) {
                const obj = arr[i];
                if (obj.spawnTime && obj.duration) {
                    const elapsed = now - obj.spawnTime;
                    const progress = Math.min(elapsed / obj.duration, 1.0);
                    const eased = 1 - Math.pow(1 - progress, 3);
                    const currentY = obj.baseY + (obj.targetY - obj.baseY) * eased;
                    if (obj.group) {
                        obj.group.position.y = currentY;
                        // メッシュの回転を維持（グループの子要素）
                        if (obj.group.children && obj.group.children.length > 0) {
                            for (let j = 0; j < obj.group.children.length; j++) {
                                const child = obj.group.children[j];
                                if (child instanceof THREE.Mesh) {
                                    child.rotation.x = Math.PI; // 180度回転で水平を維持
                                }
                            }
                        }
                    }
                }
            }
        };
        if (this.track1CircleGroups) updateCircleGroups(this.track1CircleGroups);
        if (this.track5CircleGroups) updateCircleGroups(this.track5CircleGroups);
        
    }
    
    // 古いオブジェクトを削除（見えなくなるまで消さない）
    _cleanupOldObjects() {
        // カメラの視界から完全に消える距離（farより少し手前）
        const cleanupDistance = 500; // 100 → 500に変更（見えなくなるまで）
        const cameraZ = this.camera.position.z;
        
        const cleanup = (arr) => {
            for (let i = arr.length - 1; i >= 0; i--) {
                // カメラの後ろに十分離れたら削除
                if (arr[i].z < cameraZ - cleanupDistance) {
                    if (arr[i].mesh) {
                        this.scene.remove(arr[i].mesh);
                    }
                    arr.splice(i, 1);
                }
            }
        };
        
        cleanup(this.track1Objects);
        
        // Track1のサークルグループも削除
        if (this.track1CircleGroups) {
            for (let i = this.track1CircleGroups.length - 1; i >= 0; i--) {
                const obj = this.track1CircleGroups[i];
                if (obj.group && obj.group.position.z < cameraZ - cleanupDistance) {
                    this.scene.remove(obj.group);
                    this.track1CircleGroups.splice(i, 1);
                }
            }
        }
        
        cleanup(this.track5Objects);
        
        // Track5のサークルグループも削除
        if (this.track5CircleGroups) {
            for (let i = this.track5CircleGroups.length - 1; i >= 0; i--) {
                const obj = this.track5CircleGroups[i];
                if (obj.group && obj.group.position.z < cameraZ - cleanupDistance) {
                    this.scene.remove(obj.group);
                    this.track5CircleGroups.splice(i, 1);
                }
            }
        }
        cleanup(this.track6Objects);
        cleanup(this.track8Objects);
        cleanup(this.track9Objects);
        cleanup(this.track10Objects);
        cleanup(this.monolithObjects); // モノリスも同様に処理
    }

    update(deltaTime) {
        this.time += deltaTime * 0.001;
        
        // オブジェクトの生えてくるアニメーションを処理
        this._updateObjectAnimations(deltaTime);
        
        const ticksPerBar = 384;
        const totalBars = 96;
        const ticksPerLoop = ticksPerBar * totalBars;
        
        const loopedTick = (this.actualTick || 0) % ticksPerLoop;
        // カメラの移動速度を速く（0.05 → 0.15、連打で重ならない程度）
        this.roadProgress = loopedTick * 0.15;
        
        // phaseでカメラモード切替とランダマイズ
        if (this.phase !== this.lastPhase) {
            this.lastPhase = this.phase;
            this.cameraMode = Math.random() > 0.5 ? 'follow' : 'lead';
            // モード切替時にカメラをランダマイズ
            this.applyCameraRandomize();
        }
        
        // 小節でモノリス生成
        const currentBar = Math.floor(loopedTick / ticksPerBar);
        if (currentBar !== this.lastBar) {
            this.lastBar = currentBar;
            // カメラより少し奥が最新のシーケンス位置になるように
            const spawnZ = this.roadProgress + (this.cameraMode === 'follow' ? 30 : 40);
            this._spawnMonolith(spawnZ, 0); // モノリスはデュレーションなし
        }
        
        // 道をカメラの進行に合わせて移動（消えないように）
        if (this.road) {
            this.road.position.z = this.roadProgress;
        }
        
        this._updateCameraPosition();
        this._cleanupOldObjects();
        
        // PostFX更新（エフェクト適用）
        this.updatePostFX();
    }

    async render() {
        if (!this.scene || !this.camera) return;
        
        if (this.postProcessing) {
            await this.postProcessing.renderAsync();
        } else {
            await this.renderer.renderAsync(this.scene, this.camera);
        }
        
        if (this.showGrid && this.overlayScene) {
            await this.renderer.renderAsync(this.overlayScene, this.camera);
        }
        
        if (this.hud && this.showHUD) {
            const totalObjects = this.track1Objects.length + this.track5Objects.length + 
                this.track6Objects.length + this.monolithObjects.length;
            const now = performance.now();
            const frameRate = this.lastFrameTime ? 1.0 / ((now - this.lastFrameTime) / 1000.0) : 60.0;
            this.lastFrameTime = now;
            
            // 色反転エフェクトが有効な場合は、HUDの色も反転する（Scene01と同じ方法）
            const isInverted = !!(this.fxUniforms?.invert && this.fxUniforms.invert.value > 0.0);
            
            this.hud.display(
                frameRate, 0, this.camera.position, 0, this.time,
                0, 0, 0, 0, isInverted, this.oscStatus, totalObjects,
                this.trackEffects, this.phase, null, null, 0, '',
                this.actualTick, this.cameraMode
            );
        }
    }

    handleOSC(message) {
        const address = message.address || '';
        const args = message.args || [];
        
        if (address === '/actual_tick') {
            this.actualTick = Number(args[0] ?? 0);
            // roadProgressはupdate()で計算するので、ここでは更新しない
        } else if (address === '/actual_bar') {
            const newBar = Number(args[0] ?? 0);
            // 小節が変わったらカメラをランダマイズ
            if (newBar !== this.actualBar) {
                this.actualBar = newBar;
                this.applyCameraRandomize();
            }
        } else if (address === '/phase') {
            this.phase = Number(args[0] ?? 0);
        }
        
        super.handleOSC(message);
    }
    
    handleTrackNumber(trackNumber, message) {
        if (!this.trackEffects[trackNumber]) return;
        
        const args = message.args || [];
        const velocity = Number(args[1] ?? 127);
        const durationMs = Number(args[2] ?? 0);
        
        // カメラより少し奥が最新のシーケンス位置になるように
        const spawnZ = this.roadProgress + (this.cameraMode === 'follow' ? 30 : 40);
        
        if (trackNumber === 1) {
            this._spawnTrack1Object(spawnZ, velocity, durationMs);
        } else if (trackNumber === 2) {
            this.applyTrack2Invert(velocity, durationMs);
        } else if (trackNumber === 3) {
            this.applyTrack3Chromatic(velocity, durationMs);
        } else if (trackNumber === 4) {
            this.applyTrack4Glitch(velocity, durationMs);
        } else if (trackNumber === 5) {
            this._spawnTrack5Object(spawnZ, velocity, durationMs);
        } else if (trackNumber === 6) {
            this._spawnTrack6Object(spawnZ, velocity, durationMs);
        } else if (trackNumber === 8) {
            this._spawnTrack8Object(spawnZ, velocity, durationMs);
        } else if (trackNumber === 9) {
            this._spawnTrack9Object(spawnZ, velocity, durationMs);
        } else if (trackNumber === 10) {
            this._spawnTrack10Object(spawnZ, velocity, durationMs);
        }
    }
    
    // カメラランダマイズ（actual_barトリガー、カメラパーティクルに力を加える）
    applyCameraRandomize() {
        if (!this.cameraParticle) return;
        
        // X位置とY位置にランダムな力を加える（極めて弱く）
        const forceX = (Math.random() - 0.5) * 3; // X方向の力（極めて弱く）
        const forceY = (Math.random() * 2 - 0.5); // Y方向の力（極めて弱く）
        
        const force = new THREE.Vector3(forceX, forceY, 0);
        this.cameraParticle.addForce(force);
    }
    
    // Track2: Invertエフェクト
    applyTrack2Invert(velocity, durationMs) {
        if (!this.trackEffects[2]) return;
        const dur = durationMs > 0 ? durationMs : 150;
        this.setInvert(true, dur);
    }
    
    // Track3: Chromaticエフェクト
    applyTrack3Chromatic(velocity, durationMs) {
        if (!this.trackEffects[3]) return;
        const amount = Math.min(Math.max(velocity / 127, 0), 1) * 1.0;
        const dur = durationMs > 0 ? durationMs : 150;
        this.setChromatic(amount, dur);
    }
    
    // Track4: Glitchエフェクト
    applyTrack4Glitch(velocity, durationMs) {
        if (!this.trackEffects[4]) return;
        const amount = Math.min(Math.max(velocity / 127, 0), 1) * 0.7;
        const dur = durationMs > 0 ? durationMs : 150;
        this.setGlitch(amount, dur);
    }

    handleKeyPress(key) {
        switch (key.toLowerCase()) {
            case 'c':
                console.log(`[Scene03] カメラ位置:`, this.camera.position.clone());
                console.log(`[Scene03] roadProgress:`, this.roadProgress);
                console.log(`[Scene03] オブジェクト数: T1=${this.track1Objects.length}, T5=${this.track5Objects.length}, T6=${this.track6Objects.length}, Monolith=${this.monolithObjects.length}`);
                break;
            case 'g':
                this.showGrid = !this.showGrid;
                if (this.gridRuler) this.gridRuler.setVisible(this.showGrid);
                console.log(`[Scene03] グリッド: ${this.showGrid ? 'ON' : 'OFF'}`);
                break;
            case 'm':
                this.cameraMode = this.cameraMode === 'follow' ? 'lead' : 'follow';
                console.log(`[Scene03] カメラモード: ${this.cameraMode}`);
                this._updateCameraPosition();
                break;
            case 't':
                const testZ = this.roadProgress + 20;
                console.log(`[Scene03] テスト生成 at Z=${testZ}`);
                this._spawnTrack1Object(testZ, 100);
                this._spawnTrack5Object(testZ + 2, 100);
                this._spawnTrack6Object(testZ + 4, 100);
                break;
        }
    }

    setResourceActive(active) {
        this._resourceActive = !!active;
    }

    dispose() {
        // オブジェクトを削除
        const allObjects = [
            ...this.track1Objects,
            ...this.track5Objects,
            ...this.track6Objects,
            ...this.monolithObjects,
        ];
        
        allObjects.forEach(obj => {
            if (obj.mesh) this.scene.remove(obj.mesh);
        });
        
        // ジオメトリとマテリアルを破棄
        Object.values(this.geometries).forEach(g => g.dispose());
        Object.values(this.materials).forEach(m => m.dispose());
        
        if (this.road) {
            this.scene.remove(this.road);
            this.road.geometry.dispose();
            this.road.material.dispose();
        }
        
        if (this.gridRuler) this.gridRuler.dispose();
        if (this.hud) this.hud.dispose();
    }
}
