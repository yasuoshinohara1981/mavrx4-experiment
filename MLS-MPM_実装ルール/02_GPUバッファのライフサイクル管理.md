# 質問2: シーン切替時のライフサイクル（init/setup/enter/exit/dispose）で、MlsMpmSimulatorのGPUバッファをいつ確保し、いつ解放すべき？

## 回答

### 推奨方針：**「全シーン常駐」方式**

---

## 理由

1. **プリロードで全シーンsetupしている**ため、既にGPUバッファは確保済み
2. **シーン切り替えは瞬時にしたい**（ライブ用途）
3. **GPUバッファの解放・再確保は重い**（メモリ確保・初期化コスト）
4. **WebGPUでは、非アクティブなバッファのメモリ使用量は問題になりにくい**（VRAMは十分にある前提）

---

## ライフサイクル

```
init()          → シーンオブジェクト作成（GPUバッファは未確保）
  ↓
setup()         → MlsMpmParticleSystem.init() → GPUバッファ確保 ✅
  ↓
setResourceActive(true)  → アクティブ化（update/renderを有効化）
  ↓
update/render   → シミュレーション実行
  ↓
setResourceActive(false) → 非アクティブ化（update/renderを停止、バッファは保持）
  ↓
dispose()       → GPUバッファ解放（通常は呼ばない、アプリ終了時のみ）
```

---

## 実装方針

### setup()時: GPUバッファを確保（プリロード時に実行）

```javascript
// Scene01.js
async setup() {
  // setup()時にconfから読み取って保存
  this._mlsMpmParams = {
    maxParticles: conf.maxParticles,
    particles: conf.particles,
    points: conf.points,
  };
  
  // MlsMpmParticleSystemに渡す
  this.particleSystem = new MlsMpmParticleSystem(this.renderer);
  await this.particleSystem.init({ 
    scene: this.scene,
    params: this._mlsMpmParams
  });
  
  // GPUバッファはここで確保される
}
```

### setResourceActive(false)時: update/renderを停止するが、バッファは保持

```javascript
// SceneBase.js または各シーン
setResourceActive(active) {
  this._resourceActive = active;
  
  if (active) {
    // アクティブ化：update/renderを有効化
    // バッファは既に確保済みなので、何もしない
  } else {
    // 非アクティブ化：update/renderを停止
    // バッファは保持（解放しない）
  }
}
```

### setResourceActive(true)時: update/renderを再開（バッファは既に確保済み）

```javascript
// SceneBase.js または各シーン
update(deltaTime) {
  if (!this._resourceActive) {
    return; // 非アクティブ時は更新しない
  }
  
  // シミュレーション実行
  if (this.particleSystem) {
    await this.particleSystem.stepSimulation(deltaTime, this.time);
  }
}
```

### dispose()時: GPUバッファを解放（通常は呼ばない、アプリ終了時のみ）

```javascript
// SceneBase.js または各シーン
dispose() {
  // 通常は呼ばない（アプリ終了時のみ）
  if (this.particleSystem?.sim) {
    // GPUバッファの解放処理（必要に応じて実装）
    // 現状はThree.js/WebGPUが自動的に解放するため、明示的な処理は不要
  }
}
```

---

## 「アクティブなシーンだけ生成」方式のデメリット

- シーン切り替え時にGPUバッファの確保・解放が発生し、**遅延が発生する**
- プリロードの設計と矛盾する（全シーンsetupしているのに、バッファだけ遅延確保は不自然）

---

## 実装例

### SceneManagerでの実装

```javascript
// SceneManager.js
async preloadAllScenes() {
  for (let i = 0; i < this.scenes.length; i++) {
    const s = this.scenes[i];
    
    // setup()実行（GPUバッファを確保）
    await s.setup();
    
    // プリロード時のrender()実行（シェーダーコンパイル）
    if (shouldChangeIndex) {
      this.currentSceneIndex = i;
    }
    if (s.setResourceActive) {
      s.setResourceActive(true);
    }
    
    if (s.render) {
      await s.render();
    }
    
    // 非アクティブ化（バッファは保持）
    if (s.setResourceActive) {
      s.setResourceActive(false);
    }
    
    // currentSceneIndexを復元
    if (shouldChangeIndex) {
      this.currentSceneIndex = tempSceneIndex;
    }
  }
}

async switchScene(index) {
  const oldScene = this.scenes[this.currentSceneIndex];
  if (oldScene?.setResourceActive) {
    oldScene.setResourceActive(false); // 非アクティブ化（バッファは保持）
  }
  
  this.currentSceneIndex = index;
  const newScene = this.scenes[this.currentSceneIndex];
  
  if (newScene?.setResourceActive) {
    newScene.setResourceActive(true); // アクティブ化（バッファは既に確保済み）
  }
}
```

---

## まとめ

- **方針**: 「全シーン常駐」方式を推奨
- **setup()時**: GPUバッファを確保（プリロード時に実行）
- **setResourceActive(false)時**: update/renderを停止するが、バッファは保持
- **setResourceActive(true)時**: update/renderを再開（バッファは既に確保済み）
- **dispose()時**: GPUバッファを解放（通常は呼ばない、アプリ終了時のみ）
