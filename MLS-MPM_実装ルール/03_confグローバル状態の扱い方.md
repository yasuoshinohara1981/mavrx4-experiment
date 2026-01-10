# 質問3: confのようなグローバル状態がMLS-MPMの表示や挙動に影響しているが、別インスタンス方針でデグレを防ぐには conf をどう扱うべき？

## 回答

### 推奨方針：**「setup()時にconfから読み取ってシーン内に保存」方式**

---

## 問題点

- `conf.particles`、`conf.maxParticles` がグローバルなので、シーンAで変更するとシーンBに影響する
- `MlsMpmSimulator.init()` が `conf.maxParticles` を参照している
- `MlsMpmParticleSystem.applyVisibilityFromConf()` が `conf.points` を参照している

---

## 実装方針

### 方針A: **シーン固有パラメータをsetup()時に保存**

```javascript
// Scene01.js
async setup() {
  // setup()時にconfから読み取って保存
  this._mlsMpmParams = {
    maxParticles: conf.maxParticles,
    particles: conf.particles,
    points: conf.points,
    // その他のシーン固有パラメータ
  };
  
  // MlsMpmParticleSystemに渡す
  this.particleSystem = new MlsMpmParticleSystem(this.renderer);
  await this.particleSystem.init({ 
    scene: this.scene,
    params: this._mlsMpmParams  // シーン固有パラメータを渡す
  });
}
```

### 方針B: **MlsMpmParticleSystemがparamsを受け取る**

```javascript
// MlsMpmParticleSystem.js
export class MlsMpmParticleSystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.sim = null;
    this.particleRenderer = null;
    this.pointRenderer = null;
    this.visible = true;
    // シーン固有パラメータを保持
    this.params = null;
  }

  async init({ scene, params = null }) {
    // paramsが渡された場合はそれを使う、なければconfから読み取る（後方互換）
    this.params = params || {
      maxParticles: conf.maxParticles,
      particles: conf.particles,
      points: conf.points,
    };
    
    this.sim = new MlsMpmSimulator(this.renderer);
    // MlsMpmSimulator.init()にparamsを渡す
    await this.sim.init({ 
      maxParticles: this.params.maxParticles,
      particles: this.params.particles 
    });
    
    // 起動直後から表示されるように、GPU側の粒子バッファを確実に初期化
    if (this.sim.resetParticles) {
      await this.sim.resetParticles();
    }
    
    this.particleRenderer = new ParticleRenderer(this.sim);
    this.pointRenderer = new PointRenderer(this.sim);
    
    if (scene) {
      scene.add(this.particleRenderer.object);
      scene.add(this.pointRenderer.object);
    }
    
    // params.pointsを使う（conf.pointsではなく）
    this.applyVisibilityFromParams();
  }

  applyVisibilityFromParams() {
    const showPoints = !!(this.params?.points ?? conf.points);
    if (this.particleRenderer?.object) {
      this.particleRenderer.object.visible = this.visible && !showPoints;
    }
    if (this.pointRenderer?.object) {
      this.pointRenderer.object.visible = this.visible && showPoints;
    }
  }

  // applyVisibilityFromConf()は後方互換のため残す
  applyVisibilityFromConf() {
    this.applyVisibilityFromParams();
  }
  
  // ... 既存のメソッド ...
}
```

### 方針C: **MlsMpmSimulatorがparamsを受け取る**

```javascript
// mlsMpmSimulator.js
class mlsMpmSimulator {
  async init({ maxParticles = null, particles = null } = {}) {
    // paramsが渡された場合はそれを使う、なければconfから読み取る（後方互換）
    const actualMaxParticles = maxParticles ?? conf.maxParticles;
    const actualParticles = particles ?? conf.particles;
    
    this.maxParticles = actualMaxParticles;
    this.gridSize.set(64,64,64);
    
    // ... 既存の初期化コード（particleBuffer, cellBuffer等） ...
    
    // 初期パーティクル数を設定
    this.numParticles = actualParticles;
    this.uniforms.numParticles.value = actualParticles;
    
    // ...
  }
}
```

---

## confの読み取り専用化（段階的移行）

### 実装例

```javascript
// conf.js
class Conf {
  _particles = 130000;
  _maxParticles = 8192 * 20;
  
  get particles() { return this._particles; }
  set particles(v) {
    console.warn('conf.particles is read-only. Use scene-specific params instead.');
    // 互換性のため、警告だけ出して設定は許可（段階的移行）
    this._particles = v;
  }
  
  get maxParticles() { return this._maxParticles; }
  set maxParticles(v) {
    console.warn('conf.maxParticles is read-only. Use scene-specific params instead.');
    // 互換性のため、警告だけ出して設定は許可（段階的移行）
    this._maxParticles = v;
  }
  
  // ...
}
```

---

## 実装の優先順位

### 1. 最優先: MlsMpmParticleSystem.init()にparamsを渡す対応

```javascript
// MlsMpmParticleSystem.js
async init({ scene, params = null }) {
  this.params = params || {
    maxParticles: conf.maxParticles,
    particles: conf.particles,
    points: conf.points,
  };
  
  this.sim = new MlsMpmSimulator(this.renderer);
  await this.sim.init({ 
    maxParticles: this.params.maxParticles,
    particles: this.params.particles 
  });
  
  // ...
}
```

### 2. 次: setup()時にconfから読み取ってシーン内に保存

```javascript
// Scene01.js
async setup() {
  this._mlsMpmParams = {
    maxParticles: conf.maxParticles,
    particles: conf.particles,
    points: conf.points,
  };
  
  this.particleSystem = new MlsMpmParticleSystem(this.renderer);
  await this.particleSystem.init({ 
    scene: this.scene,
    params: this._mlsMpmParams
  });
}
```

### 3. 最後: confの読み取り専用化（段階的移行）

```javascript
// conf.js
class Conf {
  _particles = 130000;
  
  get particles() { return this._particles; }
  set particles(v) {
    console.warn('conf.particles is read-only. Use scene-specific params instead.');
    this._particles = v;
  }
}
```

---

## まとめ

- **方針**: 「setup()時にconfから読み取ってシーン内に保存」方式
- **実装**: MlsMpmParticleSystem.init()にparamsを渡す
- **後方互換**: paramsが渡されない場合はconfから読み取る（既存コードとの互換性）
- **段階的移行**: confの読み取り専用化は最後に実施
