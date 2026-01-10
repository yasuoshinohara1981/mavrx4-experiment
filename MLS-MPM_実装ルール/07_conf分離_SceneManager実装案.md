# SceneManagerにconf分離を最小変更で実装

## 前提

- conf分離（baselineConf / activeConf）方針は確定
- Sceneはconfを直接触らない
- SceneManagerが apply / restore を責任持つ
- 既存シーンは極力触りたくない（最小変更）

---

## 1) SceneManagerに追加する実装

### 1.1 constructorでのbaselineConf保存

```javascript
// SceneManager.js
import { conf } from '../common/conf.js';

export class SceneManager {
    constructor(renderer, camera, sharedResourceManager = null) {
        // ... 既存のコード ...
        
        // baselineConfの保存（起動時のconf状態を保存）
        this._baselineConf = this._captureConfState();
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
            'stiffness',
            'restDensity',
            'dynamicViscosity',
            'gravity',
            'noise',
            'speed',
            'size',
            'actualSize',
            'density',
            // 必要に応じて追加
        ];
        
        const state = {};
        keysToCapture.forEach(key => {
            if (key in conf) {
                // プリミティブ値はそのまま、オブジェクトはコピー
                const value = conf[key];
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    state[key] = value.clone ? value.clone() : { ...value };
                } else {
                    state[key] = value;
                }
            }
        });
        
        return state;
    }
}
```

### 1.2 applySceneParams(sceneParams)

```javascript
// SceneManager.js
/**
 * シーンのconfパラメータを適用
 * @param {Object|null} sceneParams シーンの希望パラメータ（nullの場合は何もしない）
 */
applySceneParams(sceneParams) {
    if (!sceneParams || typeof sceneParams !== 'object') {
        // sceneParamsが未定義/null/オブジェクトでない場合は何もしない（安全なデフォルト処理）
        return;
    }
    
    // confに適用
    Object.keys(sceneParams).forEach(key => {
        if (key in conf) {
            const value = sceneParams[key];
            // プリミティブ値はそのまま、オブジェクトは適切に処理
            if (value && typeof value === 'object' && !Array.isArray(value) && value.clone) {
                // Vector3等のclone可能なオブジェクト
                conf[key].copy ? conf[key].copy(value) : (conf[key] = value.clone());
            } else {
                conf[key] = value;
            }
        } else {
            // confに存在しないキーは警告（デバッグ用）
            console.warn(`[SceneManager] sceneParamsに存在しないconfプロパティ: ${key}`);
        }
    });
    
    // conf.updateParams()を呼ぶ（particles変更時にrestDensityなどを更新）
    if (typeof conf.updateParams === 'function') {
        conf.updateParams();
    }
}
```

### 1.3 restoreConf()

```javascript
// SceneManager.js
/**
 * conf状態をbaselineConfに復元
 */
restoreConf() {
    if (!this._baselineConf) {
        // baselineConfが無い場合は何もしない（安全なデフォルト処理）
        console.warn('[SceneManager] baselineConfが存在しません');
        return;
    }
    
    // baselineConfの状態を復元
    Object.keys(this._baselineConf).forEach(key => {
        if (key in conf) {
            const value = this._baselineConf[key];
            // プリミティブ値はそのまま、オブジェクトは適切に処理
            if (value && typeof value === 'object' && !Array.isArray(value) && value.clone) {
                // Vector3等のclone可能なオブジェクト
                conf[key].copy ? conf[key].copy(value) : (conf[key] = value.clone());
            } else {
                conf[key] = value;
            }
        }
    });
    
    // conf.updateParams()を呼ぶ
    if (typeof conf.updateParams === 'function') {
        conf.updateParams();
    }
}
```

---

## 2) シーン切替時の流れ（擬似コード）

```javascript
// SceneManager.js
async switchScene(index) {
    // ... 既存のコード（indexチェック、プリロード待機など） ...
    
    // ===== 1. exit旧シーン =====
    const oldScene = this.scenes[this.currentSceneIndex];
    if (oldScene) {
        // 旧シーンを非アクティブ化
        if (oldScene.setResourceActive) {
            oldScene.setResourceActive(false);
        }
    }
    
    // ===== 2. restoreConf =====
    // baselineConfに戻す（次のシーンの適用前にクリーンな状態にする）
    this.restoreConf();
    
    // ===== 3. applySceneParams(新シーン) =====
    const newScene = this.scenes[index];
    if (newScene) {
        // 新シーンのsceneParamsを取得（安全なデフォルト処理）
        const sceneParams = newScene.getSceneParams ? newScene.getSceneParams() : null;
        
        // sceneParamsが未定義/nullの場合は何もしない（既存シーンとの互換性）
        if (sceneParams !== null && sceneParams !== undefined) {
            this.applySceneParams(sceneParams);
        }
    }
    
    // ===== 4. enter新シーン =====
    // 既存の処理（シャドウ設定、HUD設定など）
    if (newScene._shadowMapEnabled !== undefined) {
        this.renderer.shadowMap.enabled = newScene._shadowMapEnabled;
        if (newScene._shadowMapType !== undefined) {
            this.renderer.shadowMap.type = newScene._shadowMapType;
        }
    }
    
    newScene.showHUD = this.globalShowHUD;
    if (newScene.hud) newScene.hud.showHUD = this.globalShowHUD;
    
    // 非アクティブ時は重い更新を止める
    if (newScene.setResourceActive) newScene.setResourceActive(false);
    
    // 既存のensureSetup()処理はそのまま
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
```

---

## 3) 既存シーンを壊さないための安全なデフォルト処理

### 3.1 sceneParamsが未定義な場合の処理

```javascript
// SceneManager.js - applySceneParams()内
applySceneParams(sceneParams) {
    // ✅ 安全なデフォルト処理1: null/undefinedチェック
    if (!sceneParams || typeof sceneParams !== 'object') {
        return; // 何もしない（既存シーンとの互換性）
    }
    
    // ✅ 安全なデフォルト処理2: 空オブジェクトチェック
    if (Object.keys(sceneParams).length === 0) {
        return; // 空オブジェクトの場合は何もしない
    }
    
    // ... 既存の適用処理 ...
}
```

### 3.2 getSceneParams()が存在しない場合の処理

```javascript
// SceneManager.js - switchScene()内
const newScene = this.scenes[index];
if (newScene) {
    // ✅ 安全なデフォルト処理: getSceneParams()が存在しない場合はnullを返す
    const sceneParams = newScene.getSceneParams ? newScene.getSceneParams() : null;
    
    // ✅ 安全なデフォルト処理: sceneParamsがnullの場合は何もしない
    if (sceneParams !== null && sceneParams !== undefined) {
        this.applySceneParams(sceneParams);
    }
}
```

### 3.3 confに存在しないキーの処理

```javascript
// SceneManager.js - applySceneParams()内
Object.keys(sceneParams).forEach(key => {
    if (key in conf) {
        // confに存在するキーのみ適用
        conf[key] = sceneParams[key];
    } else {
        // ✅ 安全なデフォルト処理: confに存在しないキーは警告のみ（エラーにしない）
        console.warn(`[SceneManager] sceneParamsに存在しないconfプロパティ: ${key}`);
    }
});
```

### 3.4 オブジェクト値の安全な処理

```javascript
// SceneManager.js - applySceneParams()内
Object.keys(sceneParams).forEach(key => {
    if (key in conf) {
        const value = sceneParams[key];
        
        // ✅ 安全なデフォルト処理: オブジェクト値の適切な処理
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (value.clone && conf[key].copy) {
                // Vector3等のclone可能なオブジェクト
                conf[key].copy(value);
            } else if (value.clone) {
                conf[key] = value.clone();
            } else {
                // 通常のオブジェクトは浅いコピー
                conf[key] = { ...value };
            }
        } else {
            // プリミティブ値はそのまま
            conf[key] = value;
        }
    }
});
```

---

## 実装の差分（最小変更）

### SceneManager.jsへの追加

```javascript
// 1. import追加
import { conf } from '../common/conf.js';

// 2. constructorに追加
constructor(renderer, camera, sharedResourceManager = null) {
    // ... 既存のコード ...
    
    // baselineConfの保存
    this._baselineConf = this._captureConfState();
}

// 3. メソッド追加（3つ）
_captureConfState() { /* ... */ }
applySceneParams(sceneParams) { /* ... */ }
restoreConf() { /* ... */ }

// 4. switchScene()内に追加（2箇所）
async switchScene(index) {
    // ... 既存のコード ...
    
    // ===== 2. restoreConf =====
    this.restoreConf();
    
    // ===== 3. applySceneParams(新シーン) =====
    const newScene = this.scenes[index];
    if (newScene) {
        const sceneParams = newScene.getSceneParams ? newScene.getSceneParams() : null;
        if (sceneParams !== null && sceneParams !== undefined) {
            this.applySceneParams(sceneParams);
        }
    }
    
    // ... 既存のコード ...
}
```

---

## まとめ

### 実装のポイント

1. **baselineConfの保存**: constructorで起動時のconf状態を保存
2. **applySceneParams()**: sceneParamsをconfに適用（安全なデフォルト処理あり）
3. **restoreConf()**: baselineConfに復元
4. **シーン切替時の流れ**: exit旧シーン → restoreConf → applySceneParams(新シーン) → enter新シーン

### 安全なデフォルト処理

1. **sceneParamsがnull/undefined**: 何もしない
2. **getSceneParams()が存在しない**: nullを返す
3. **confに存在しないキー**: 警告のみ（エラーにしない）
4. **オブジェクト値**: 適切にコピー/参照を処理

### 既存シーンへの影響

- **getSceneParams()が無いシーン**: 何も変更されない（既存の動作を維持）
- **getSceneParams()がnullを返すシーン**: 何も変更されない（既存の動作を維持）
- **getSceneParams()が有効な値を返すシーン**: confが適用される（新機能）
