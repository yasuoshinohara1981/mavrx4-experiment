# conf分離の最小変更案

## 質問1: Sceneが返す「希望パラメータ（sceneParams）」の最小インターフェース

### 設計

```javascript
// SceneBase.js または SceneTemplate.js
/**
 * シーン固有のconfパラメータを返す
 * 子クラスで上書きして、シーン固有の設定を返す
 * @returns {Object|null} シーン固有のconfパラメータ（nullの場合はconfを変更しない）
 */
getSceneParams() {
    // デフォルトはnull（confを変更しない）
    return null;
}
```

### 最小インターフェース

```typescript
interface SceneParams {
    // オプショナル：指定したものだけconfに適用される
    bloom?: boolean;
    particles?: number;
    maxParticles?: number;
    points?: boolean;
    particleShape?: 'sphere' | 'roundedBox';
    // その他、confのプロパティと同じ名前で指定可能
    [key: string]: any;
}
```

### 実装例

```javascript
// SceneBase.js
export class SceneBase {
    // ... 既存のコード ...
    
    /**
     * シーン固有のconfパラメータを返す
     * 子クラスで上書きして、シーン固有の設定を返す
     * @returns {Object|null} シーン固有のconfパラメータ（nullの場合はconfを変更しない）
     */
    getSceneParams() {
        return null;
    }
}
```

---

## 質問2: SceneManager側で、シーンenter時にconfに適用、exit時に元に戻す処理

### 最小変更案（擬似コード）

```javascript
// SceneManager.js
export class SceneManager {
    constructor(renderer, camera, sharedResourceManager = null) {
        // ... 既存のコード ...
        
        // シーン切替前のconf状態を保持（元に戻すため）
        this._previousConfState = null;
    }
    
    async switchScene(index) {
        if (index < 0 || index >= this.scenes.length) {
            console.warn(`シーンインデックス ${index} は無効です`);
            return;
        }
        
        // 同じシーンへの切り替えは無視
        if (index === this.currentSceneIndex) {
            console.log(`既にシーン ${index + 1} がアクティブです`);
            return;
        }
        
        // プリロードが完了していない場合は待つ
        if (!this._preloadDone) {
            console.log('プリロード完了を待機中...');
            await this.waitForPreload();
        }
        
        // ===== 旧シーンのexit処理 =====
        const oldScene = this.scenes[this.currentSceneIndex];
        if (oldScene) {
            // 旧シーンのconf状態を元に戻す
            this._restoreConfState();
            
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
        
        // 既存の処理（シャドウ設定など）
        if (newScene._shadowMapEnabled !== undefined) {
            this.renderer.shadowMap.enabled = newScene._shadowMapEnabled;
            if (newScene._shadowMapType !== undefined) {
                this.renderer.shadowMap.type = newScene._shadowMapType;
            }
        }
        
        // HUDの状態をグローバル状態に合わせる
        newScene.showHUD = this.globalShowHUD;
        if (newScene.hud) newScene.hud.showHUD = this.globalShowHUD;
        
        // 非アクティブ時は重い更新を止める
        if (newScene.setResourceActive) newScene.setResourceActive(false);
        
        // まだsetupしてないなら裏でやる
        const ensureSetup = async () => {
            if (this._setupDone?.has(index)) return;
            await newScene.setup();
            this._setupDone?.add(index);
        };
        
        ensureSetup()
            .then(() => {
                // 切替要求が最新ならここでスワップ
                if (token !== this._pendingSwitchToken) return;
                if (this._pendingSceneIndex !== index) return;
                
                const oldScene = this.scenes[this.currentSceneIndex];
                if (oldScene?.setResourceActive) {
                    oldScene.setResourceActive(false);
                }
                
                this.currentSceneIndex = index;
                const activeScene = this.scenes[this.currentSceneIndex];
                
                if (activeScene?.setResourceActive) {
                    activeScene.setResourceActive(true);
                }
                
                // シャドウ設定を復元
                if (activeScene._shadowMapEnabled !== undefined) {
                    this.renderer.shadowMap.enabled = activeScene._shadowMapEnabled;
                    if (activeScene._shadowMapType !== undefined) {
                        this.renderer.shadowMap.type = activeScene._shadowMapType;
                    }
                }
                
                // HUDの状態を改めて適用
                activeScene.showHUD = this.globalShowHUD;
                if (activeScene.hud) activeScene.hud.showHUD = this.globalShowHUD;
                
                // 切り替え後の初回update/render計測を開始
                this._switchFrameCount = 0;
                this._switchStartTime = performance.now();
                
                if (this.onSceneChange) this.onSceneChange(activeScene.title || `Scene ${index + 1}`);
                console.log(`シーン切り替え(ノンブロック): ${activeScene.title || `Scene ${index + 1}`}`);
            })
            .catch(err => {
                console.error('シーンのセットアップエラー:', err);
            });
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
            // sceneParamsがnullの場合はconfを変更しない
            return;
        }
        
        // confに適用
        Object.keys(sceneParams).forEach(key => {
            if (key in conf) {
                conf[key] = sceneParams[key];
            }
        });
        
        // conf.updateParams()を呼ぶ（particles変更時にrestDensityなどを更新）
        if (typeof conf.updateParams === 'function') {
            conf.updateParams();
        }
    }
    
    /**
     * conf状態を元に戻す
     */
    _restoreConfState() {
        if (!this._previousConfState) {
            return;
        }
        
        // 保存した状態を復元
        Object.keys(this._previousConfState).forEach(key => {
            if (key in conf) {
                conf[key] = this._previousConfState[key];
            }
        });
        
        // conf.updateParams()を呼ぶ
        if (typeof conf.updateParams === 'function') {
            conf.updateParams();
        }
        
        // 状態をクリア
        this._previousConfState = null;
    }
    
    /**
     * 現在のconf状態をキャプチャ（変更される可能性があるプロパティのみ）
     */
    _captureConfState() {
        // シーンが変更する可能性があるconfプロパティのみ保存
        const keysToCapture = [
            'bloom',
            'particles',
            'maxParticles',
            'points',
            'particleShape',
            // 必要に応じて追加
        ];
        
        const state = {};
        keysToCapture.forEach(key => {
            if (key in conf) {
                state[key] = conf[key];
            }
        });
        
        return state;
    }
}
```

---

## 質問3: 既存Scene01.jsのBefore/After

### Before（現状）

```javascript
// Scene01.js
async setup() {
    // ... 既存のコード ...
    
    // ❌ conf.bloomを一時的に変更
    const originalBloom = conf.bloom;
    conf.bloom = false;
    this.initPostFX({
        scene: this.scene,
        overlayScene: this.overlayScene,
        camera: this.camera
    });
    conf.bloom = originalBloom; // 他のシーンに影響しないように戻す
    
    // ... 既存のコード ...
}

applyPhaseEffects(phase) {
    // ... 既存のコード ...
    
    // ❌ conf.particlesを直接変更
    if (conf.particles !== target) {
        conf.particles = target;
        if (typeof conf.updateParams === 'function') {
            conf.updateParams();
        }
    }
}

applyTickEffects(tick) {
    // ... 既存のコード ...
    
    // ❌ conf.particlesを直接変更
    if (conf.particles !== target) {
        conf.particles = target;
        if (typeof conf.updateParams === 'function') conf.updateParams();
    }
}

initPostFX(params) {
    // ... 既存のコード ...
    
    // ❌ conf.bloomを一時的に変更
    const originalBloom = conf.bloom;
    conf.bloom = false;
    // ... 処理 ...
    conf.bloom = originalBloom;
}
```

### After（変更後）

```javascript
// Scene01.js
async setup() {
    // ... 既存のコード ...
    
    // ✅ conf.bloomの一時変更は削除（SceneManagerが管理）
    // ただし、initPostFX()内での一時変更は残す（ローカルスコープ内のみ）
    this.initPostFX({
        scene: this.scene,
        overlayScene: this.overlayScene,
        camera: this.camera
    });
    
    // ... 既存のコード ...
}

/**
 * シーン固有のconfパラメータを返す
 * SceneManagerがenter時に適用、exit時に元に戻す
 */
getSceneParams() {
    return {
        bloom: false,  // Scene01はbloomを無効化
        // particles, maxParticlesは動的に変更するため、ここでは指定しない
        // （applyPhaseEffects/applyTickEffectsで変更する）
    };
}

applyPhaseEffects(phase) {
    // ... 既存のコード ...
    
    // ✅ conf.particlesの変更は残す（シーン内での動的変更は許可）
    // ただし、exit時にSceneManagerが元に戻すため、他のシーンへの影響はない
    if (conf.particles !== target) {
        conf.particles = target;
        if (typeof conf.updateParams === 'function') {
            conf.updateParams();
        }
    }
}

applyTickEffects(tick) {
    // ... 既存のコード ...
    
    // ✅ conf.particlesの変更は残す（シーン内での動的変更は許可）
    if (conf.particles !== target) {
        conf.particles = target;
        if (typeof conf.updateParams === 'function') conf.updateParams();
    }
}

initPostFX(params) {
    // ... 既存のコード ...
    
    // ✅ ローカルスコープ内での一時変更は残す（他のシーンに影響しない）
    const originalBloom = conf.bloom;
    conf.bloom = false;
    // ... 処理 ...
    conf.bloom = originalBloom;
}
```

### 削除するconf書き換え

1. **setup()内のconf.bloom一時変更** → 削除
   - `const originalBloom = conf.bloom; conf.bloom = false; ... conf.bloom = originalBloom;`
   - → `getSceneParams()`で`bloom: false`を返すように変更

### sceneParamsに移すconf書き換え

1. **bloom** → `getSceneParams()`で`bloom: false`を返す

### 残すconf書き換え（シーン内での動的変更）

1. **particles** → `applyPhaseEffects()`/`applyTickEffects()`内での変更は残す
   - 理由: シーン内での動的変更は許可（exit時にSceneManagerが元に戻すため）

### 残すconf書き換え（ローカルスコープ内のみ）

1. **initPostFX()内のconf.bloom一時変更** → 残す
   - 理由: ローカルスコープ内のみで、他のシーンに影響しない

---

## 実装の優先順位

1. **最優先**: SceneBaseに`getSceneParams()`メソッドを追加
2. **次**: SceneManagerに`_applySceneParams()`/`_restoreConfState()`を追加
3. **最後**: Scene01.jsで`getSceneParams()`を実装し、setup()内のconf.bloom一時変更を削除

---

## 注意事項

- **シーン内での動的変更（particles等）は許可**
  - exit時にSceneManagerが元に戻すため、他のシーンへの影響はない
- **ローカルスコープ内での一時変更は残す**
  - initPostFX()内など、関数内での一時変更は他のシーンに影響しないため残す
- **差分が最小になるように**
  - 既存のconf書き換えを全て削除するのではなく、必要最小限の変更のみ実施
