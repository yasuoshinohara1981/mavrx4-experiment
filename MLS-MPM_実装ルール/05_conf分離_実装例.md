# conf分離の実装例（具体的なコード）

## 1. SceneBase.jsへの追加

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
        // デフォルトはnull（confを変更しない）
        return null;
    }
}
```

## 2. SceneManager.jsへの追加

```javascript
// SceneManager.js
export class SceneManager {
    constructor(renderer, camera, sharedResourceManager = null) {
        // ... 既存のコード ...
        
        // シーン切替前のconf状態を保持（元に戻すため）
        this._previousConfState = null;
    }
    
    async switchScene(index) {
        // ... 既存のコード（indexチェック、プリロード待機など） ...
        
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
        
        // ... 既存の処理（シャドウ設定、HUD設定など） ...
        
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

## 3. Scene01.jsの変更

### Before（現状）

```javascript
// Scene01.js
async setup() {
    await super.setup();
    
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
```

### After（変更後）

```javascript
// Scene01.js
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

async setup() {
    await super.setup();
    
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
```

## 4. 変更箇所のまとめ

### SceneBase.js
- ✅ `getSceneParams()`メソッドを追加（デフォルトはnullを返す）

### SceneManager.js
- ✅ `_previousConfState`プロパティを追加
- ✅ `_applySceneParams()`メソッドを追加
- ✅ `_restoreConfState()`メソッドを追加
- ✅ `_captureConfState()`メソッドを追加
- ✅ `switchScene()`内で`_applySceneParams()`と`_restoreConfState()`を呼ぶ

### Scene01.js
- ✅ `getSceneParams()`メソッドを追加（`bloom: false`を返す）
- ✅ `setup()`内の`conf.bloom`一時変更を削除
- ✅ `applyPhaseEffects()`/`applyTickEffects()`内の`conf.particles`変更は残す（動的変更のため）

## 5. テストケース

### テスト1: シーン切り替え時のconf状態の復元

```javascript
// Scene01: bloom=false, particles=130000
// Scene02: bloom=true, particles=50000

// Scene01 → Scene02 に切り替え
sceneManager.switchScene(1);
// 期待: conf.bloom = true, conf.particles = 50000

// Scene02 → Scene01 に切り替え
sceneManager.switchScene(0);
// 期待: conf.bloom = false, conf.particles = 130000（元に戻る）
```

### テスト2: シーン内での動的変更

```javascript
// Scene01内でapplyPhaseEffects()を呼ぶ
scene01.applyPhaseEffects(5);
// 期待: conf.particlesが変更される（シーン内での動的変更）

// Scene01 → Scene02 に切り替え
sceneManager.switchScene(1);
// 期待: conf.particlesがScene02の値に戻る（SceneManagerが復元）
```

## 6. 注意事項

- **シーン内での動的変更（particles等）は許可**
  - exit時にSceneManagerが元に戻すため、他のシーンへの影響はない
- **ローカルスコープ内での一時変更は残す**
  - initPostFX()内など、関数内での一時変更は他のシーンに影響しないため残す
- **差分が最小になるように**
  - 既存のconf書き換えを全て削除するのではなく、必要最小限の変更のみ実施
