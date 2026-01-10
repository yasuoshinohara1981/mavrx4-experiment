# Scene00_Canary 設計

## 質問1: Scene00_Canary の最小構成と雛形

### 最小構成

- 静的メッシュ1つ（BoxGeometry + MeshStandardMaterial）
- 必要最低限のupdate（何もしない）
- renderProfile と sceneParams を返す

### 雛形コード

```javascript
/**
 * Scene00_Canary（基準シーン）
 * - 表現方式に依存しない最小構成
 * - renderProfile と sceneParams の契約を確定
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from "three/webgpu";

export class Scene00_Canary extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'Canary';
        
        this.trackEffects = {
            1: false,
            2: false,
            3: false,
            4: false,
            5: false,
            6: false,
            7: false,
            8: false,
            9: false,
        };
    }
    
    async setup() {
        await super.setup();
        
        // スクリーンショット用テキスト
        this.setScreenshotText(this.title);
        
        // カメラ設定
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
        this.camera.position.set(0, 0, 2);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateProjectionMatrix();
        
        // シーン設定
        this.scene = new THREE.Scene();
        this.overlayScene = new THREE.Scene();
        this.overlayScene.background = null;
        
        // 静的メッシュ1つ（最小構成）
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
        const mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);
        this.testMesh = mesh;
        
        // ライト（最小構成）
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(0, 10, 10);
        this.scene.add(directionalLight);
        
        // シャドウ設定（renderProfileで管理）
        this._shadowMapEnabled = false;
        this._shadowMapType = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.enabled = this._shadowMapEnabled;
        this.renderer.shadowMap.type = this._shadowMapType;
        
        // PostFX初期化（renderProfileで管理）
        this.initPostFX({
            scene: this.scene,
            overlayScene: this.overlayScene,
            camera: this.camera
        });
    }
    
    /**
     * 必要最低限のupdate（何もしない）
     */
    onUpdate(deltaTime) {
        // 何もしない（最小構成）
    }
    
    /**
     * レンダリングプロファイルを返す
     * - renderer.shadowMap などのレンダリング設定
     * - postProcessing の有効/無効
     * - bloom の有効/無効（postProcessing内で使用）
     * 
     * @returns {Object|null} レンダリングプロファイル（nullの場合はデフォルト設定を使用）
     */
    getRenderProfile() {
        return {
            shadowMap: {
                enabled: false,
                type: THREE.PCFSoftShadowMap, // 'PCFSoftShadowMap' | 'PCFShadowMap' | 'BasicShadowMap'
            },
            postProcessing: {
                enabled: true,  // postProcessingを使用するか
                bloom: false,   // bloomエフェクトの有効/無効
            },
        };
    }
    
    /**
     * シーン固有のconfパラメータを返す
     * - conf.bloom, conf.particles などのシミュレーション/表示パラメータ
     * 
     * @returns {Object|null} シーン固有のconfパラメータ（nullの場合はconfを変更しない）
     */
    getSceneParams() {
        return {
            bloom: false,  // Canaryはbloomを無効化
            // その他のconfパラメータは必要に応じて追加
        };
    }
    
    /**
     * render() は SceneBase のデフォルト実装を使用
     * （postProcessing.renderAsync() を呼ぶ）
     */
    async render() {
        if (!this.postProcessing) {
            // postProcessingが無い場合は通常レンダリング
            await this.renderer.renderAsync(this.scene, this.camera);
            return;
        }
        
        await this.postProcessing.renderAsync();
        
        // HUD表示
        if (this.hud && this.showHUD) {
            const now = performance.now();
            const frameRate = this.lastFrameTime ? 1.0 / ((now - this.lastFrameTime) / 1000.0) : 60.0;
            this.lastFrameTime = now;
            
            const camPos = this.camera?.position?.clone ? this.camera.position.clone() : new THREE.Vector3();
            
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
                false,
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
                0,
                '',
                this.actualTick || 0,
                null,
                this.title || null,
                this.sceneIndex !== undefined ? this.sceneIndex : null
            );
        }
        
        // スクリーンショット用のテキスト描画
        this.drawScreenshotText();
    }
}
```

---

## 質問2: SceneManager側で renderProfile を適用＆復元する仕組み

### 最小実装（擬似コード）

```javascript
// SceneManager.js
export class SceneManager {
    constructor(renderer, camera, sharedResourceManager = null) {
        // ... 既存のコード ...
        
        // シーン切替前の状態を保持（元に戻すため）
        this._previousConfState = null;
        this._previousRenderProfile = null;
    }
    
    async switchScene(index) {
        // ... 既存のコード（indexチェック、プリロード待機など） ...
        
        // ===== 旧シーンのexit処理 =====
        const oldScene = this.scenes[this.currentSceneIndex];
        if (oldScene) {
            // 旧シーンのconf状態を元に戻す
            this._restoreConfState();
            
            // 旧シーンのrenderProfileを元に戻す
            this._restoreRenderProfile();
            
            // 既存の非アクティブ化処理
            if (oldScene.setResourceActive) {
                oldScene.setResourceActive(false);
            }
        }
        
        // ===== 新シーンのenter処理 =====
        const newScene = this.scenes[index];
        if (!newScene) return;
        
        // 新シーンのconf状態を適用
        this._applySceneParams(newScene);
        
        // 新シーンのrenderProfileを適用
        this._applyRenderProfile(newScene);
        
        // 既存の処理（HUD設定など）
        newScene.showHUD = this.globalShowHUD;
        if (newScene.hud) newScene.hud.showHUD = this.globalShowHUD;
        
        // 非アクティブ時は重い更新を止める
        if (newScene.setResourceActive) newScene.setResourceActive(false);
        
        // 既存のensureSetup()処理はそのまま
        // ...
    }
    
    /**
     * シーンのconfパラメータを適用
     * @param {SceneBase} scene シーンインスタンス
     */
    _applySceneParams(scene) {
        // 現在のconf状態を保存（exit時に元に戻すため）
        this._previousConfState = this._captureConfState();
        
        // シーンの希望パラメータを取得
        const sceneParams = scene.getSceneParams ? scene.getSceneParams() : null;
        if (!sceneParams) {
            return;
        }
        
        // confに適用
        Object.keys(sceneParams).forEach(key => {
            if (key in conf) {
                conf[key] = sceneParams[key];
            }
        });
        
        // conf.updateParams()を呼ぶ
        if (typeof conf.updateParams === 'function') {
            conf.updateParams();
        }
    }
    
    /**
     * シーンのrenderProfileを適用
     * @param {SceneBase} scene シーンインスタンス
     */
    _applyRenderProfile(scene) {
        // 現在のrenderProfile状態を保存（exit時に元に戻すため）
        this._previousRenderProfile = this._captureRenderProfile();
        
        // シーンのrenderProfileを取得
        const renderProfile = scene.getRenderProfile ? scene.getRenderProfile() : null;
        if (!renderProfile) {
            return;
        }
        
        // shadowMap設定を適用
        if (renderProfile.shadowMap) {
            if (renderProfile.shadowMap.enabled !== undefined) {
                this.renderer.shadowMap.enabled = renderProfile.shadowMap.enabled;
            }
            if (renderProfile.shadowMap.type !== undefined) {
                this.renderer.shadowMap.type = renderProfile.shadowMap.type;
            }
        }
        
        // postProcessing設定を適用
        // NOTE: postProcessingは各シーンがsetup()時に作成しているため、
        // ここでは設定のみを適用（postProcessingの再作成はしない）
        if (renderProfile.postProcessing) {
            // bloom設定はconfに反映（postProcessing内でconf.bloomを参照している）
            if (renderProfile.postProcessing.bloom !== undefined) {
                conf.bloom = renderProfile.postProcessing.bloom;
            }
        }
    }
    
    /**
     * conf状態を元に戻す
     */
    _restoreConfState() {
        if (!this._previousConfState) {
            return;
        }
        
        Object.keys(this._previousConfState).forEach(key => {
            if (key in conf) {
                conf[key] = this._previousConfState[key];
            }
        });
        
        if (typeof conf.updateParams === 'function') {
            conf.updateParams();
        }
        
        this._previousConfState = null;
    }
    
    /**
     * renderProfile状態を元に戻す
     */
    _restoreRenderProfile() {
        if (!this._previousRenderProfile) {
            return;
        }
        
        // shadowMap設定を復元
        if (this._previousRenderProfile.shadowMap) {
            if (this._previousRenderProfile.shadowMap.enabled !== undefined) {
                this.renderer.shadowMap.enabled = this._previousRenderProfile.shadowMap.enabled;
            }
            if (this._previousRenderProfile.shadowMap.type !== undefined) {
                this.renderer.shadowMap.type = this._previousRenderProfile.shadowMap.type;
            }
        }
        
        // postProcessing設定を復元
        if (this._previousRenderProfile.postProcessing) {
            if (this._previousRenderProfile.postProcessing.bloom !== undefined) {
                conf.bloom = this._previousRenderProfile.postProcessing.bloom;
            }
        }
        
        this._previousRenderProfile = null;
    }
    
    /**
     * 現在のconf状態をキャプチャ
     */
    _captureConfState() {
        const keysToCapture = [
            'bloom',
            'particles',
            'maxParticles',
            'points',
            'particleShape',
        ];
        
        const state = {};
        keysToCapture.forEach(key => {
            if (key in conf) {
                state[key] = conf[key];
            }
        });
        
        return state;
    }
    
    /**
     * 現在のrenderProfile状態をキャプチャ
     */
    _captureRenderProfile() {
        return {
            shadowMap: {
                enabled: this.renderer.shadowMap.enabled,
                type: this.renderer.shadowMap.type,
            },
            postProcessing: {
                bloom: conf.bloom,  // postProcessing内でconf.bloomを参照している
            },
        };
    }
}
```

---

## 質問3: 4カテゴリ別の renderProfile / sceneParams 項目

### 1. GPU粒子（MLS-MPM、GPUParticleSystem等）

#### renderProfileに入れるべき項目
- `shadowMap.enabled` - シャドウマップの有効/無効
- `shadowMap.type` - シャドウマップのタイプ（PCFSoftShadowMap等）
- `postProcessing.enabled` - ポストプロセッシングの有効/無効
- `postProcessing.bloom` - bloomエフェクトの有効/無効

#### sceneParamsに入れるべき項目
- `bloom` - bloomエフェクトの有効/無効（conf.bloom）
- `particles` - 粒子数（conf.particles）
- `maxParticles` - 最大粒子数（conf.maxParticles）
- `points` - Points表示の有効/無効（conf.points）
- `particleShape` - パーティクル形状（conf.particleShape）
- `stiffness` - 剛性（conf.stiffness）
- `restDensity` - 静止密度（conf.restDensity）
- `dynamicViscosity` - 動的粘性（conf.dynamicViscosity）
- `gravity` - 重力（conf.gravity）
- `noise` - ノイズ（conf.noise）

---

### 2. CPU粒子（SimpleParticleSystem等）

#### renderProfileに入れるべき項目
- `shadowMap.enabled` - シャドウマップの有効/無効
- `shadowMap.type` - シャドウマップのタイプ
- `postProcessing.enabled` - ポストプロセッシングの有効/無効
- `postProcessing.bloom` - bloomエフェクトの有効/無効

#### sceneParamsに入れるべき項目
- `bloom` - bloomエフェクトの有効/無効（conf.bloom）
- `particles` - 粒子数（conf.particles）
- `maxParticles` - 最大粒子数（conf.maxParticles）
- `points` - Points表示の有効/無効（conf.points）
- `particleShape` - パーティクル形状（conf.particleShape）
- `speed` - 速度（conf.speed）
- `stiffness` - 剛性（conf.stiffness）
- `restDensity` - 静止密度（conf.restDensity）
- `dynamicViscosity` - 動的粘性（conf.dynamicViscosity）
- `gravity` - 重力（conf.gravity）
- `noise` - ノイズ（conf.noise）

---

### 3. 静的メッシュ（BoxGeometry、PlaneGeometry等）

#### renderProfileに入れるべき項目
- `shadowMap.enabled` - シャドウマップの有効/無効
- `shadowMap.type` - シャドウマップのタイプ
- `postProcessing.enabled` - ポストプロセッシングの有効/無効
- `postProcessing.bloom` - bloomエフェクトの有効/無効

#### sceneParamsに入れるべき項目
- `bloom` - bloomエフェクトの有効/無効（conf.bloom）
- （静的メッシュはconfパラメータに依存しないため、最小限）

---

### 4. Instancing（InstancedMesh、InstancedBufferGeometry等）

#### renderProfileに入れるべき項目
- `shadowMap.enabled` - シャドウマップの有効/無効
- `shadowMap.type` - シャドウマップのタイプ
- `postProcessing.enabled` - ポストプロセッシングの有効/無効
- `postProcessing.bloom` - bloomエフェクトの有効/無効

#### sceneParamsに入れるべき項目
- `bloom` - bloomエフェクトの有効/無効（conf.bloom）
- `particles` - インスタンス数（conf.particles、インスタンス数として使用）
- `maxParticles` - 最大インスタンス数（conf.maxParticles）
- `particleShape` - インスタンス形状（conf.particleShape）
- `size` - サイズ（conf.size）
- `actualSize` - 実際のサイズ（conf.actualSize）

---

## まとめ

### renderProfile の役割
- **レンダリング設定**（renderer.shadowMap、postProcessing等）
- **シーン切り替え時に適用・復元される**

### sceneParams の役割
- **confパラメータ**（bloom、particles等）
- **シーン切り替え時に適用・復元される**

### 実装の優先順位
1. **最優先**: Scene00_Canaryを作成し、renderProfile/sceneParamsの契約を確定
2. **次**: SceneManagerにrenderProfile適用・復元処理を追加
3. **最後**: 既存シーンを段階的に移行
