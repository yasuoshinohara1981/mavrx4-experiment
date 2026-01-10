# MLS-MPMアーキテクチャ設計質問

## 質問内容

MLS-MPM（MlsMpmSimulator + 粒子バッファ + compute pipeline）は
(1) 全シーンで「1インスタンス共有」にすべきか
(2) シーンごとに「別インスタンス」にすべきか

### 現状コードの状況

- `MlsMpmParticleSystem.init()` が毎回 `new MlsMpmSimulator(renderer)` している
- 各シーンで独立したインスタンスを作成している
- `MlsMpmSimulator`は以下のリソースを保持：
  - `particleBuffer` (StructuredArray): 粒子データ
  - `cellBuffer` (StructuredArray): グリッドセルデータ（atomic操作あり）
  - `cellBufferF` (instancedArray): グリッドセルデータ（float版）
  - `kernels`: compute pipeline（clearGrid, p2g1, p2g2, g2p, updateParticles等）
  - `uniforms`: 各種パラメータ（重力、剛性、粘性、粒子数など）

### 懸念事項

- シーン追加で既存シーンがデグレするのを防ぎたい
- メモリ使用量とパフォーマンスのバランス
- シーン間での状態の独立性

---

## ChatGPT的回答

### 推奨方針：**(2) シーンごとに「別インスタンス」**

### 理由

#### 1. **状態の独立性が最重要**
- MLS-MPMは**時間発展する物理シミュレーション**であり、各シーンで異なる初期状態・パラメータ・外力を適用する必要がある
- 1インスタンス共有の場合、シーンAの粒子状態がシーンBに影響を与えるリスクがある
- シーン切り替え時に「前のシーンの粒子が残っている」問題が発生する可能性が高い

#### 2. **GPUバッファの独立性**
- `particleBuffer`、`cellBuffer`は各シーンで**異なる初期配置・粒子数**を持つ可能性がある
- `conf.particles`や`conf.maxParticles`がシーンごとに異なる場合、共有インスタンスでは対応不可
- シーン固有のパラメータ（例：`gridSize`、初期配置パターン）を保持できない

#### 3. **Compute Pipelineの再利用性**
- **Compute Pipeline自体は共有可能**だが、**バッファとuniformsは独立が必要**
- WebGPUでは`GPUComputePipeline`は複数シーンで共有できるが、`GPUBuffer`はシーンごとに独立させるべき
- 各シーンで異なる`dispatch`サイズ（粒子数、グリッドサイズ）を使う可能性がある

#### 4. **メモリ使用量の懸念は相対的に小さい**
- 粒子バッファは`maxParticles`に依存（現状は`conf.maxParticles`から取得）
- シーンが同時にアクティブになることはない（シーン切り替えは排他的）
- メモリ使用量よりも「状態の独立性」の方が重要

#### 5. **デバッグとメンテナンス性**
- シーンごとに独立したインスタンスの方が、問題の切り分けが容易
- シーン固有のバグが他のシーンに影響しない

### ただし、以下の最適化は検討可能

#### Compute Pipelineの共有（オプション）
- `kernels`（compute shaderの定義）自体は共有可能
- ただし、Three.js/TSLの実装では`Fn().compute()`が内部でpipelineを作成するため、現状の実装では共有が難しい
- 将来的に最適化する場合は、compute pipelineを明示的に管理するレイヤーを追加

#### Uniformsの初期化コスト削減
- シーン切り替え時に`resetParticles()`を呼ぶことで、前のシーンの状態をクリア
- ただし、完全な独立性を保つには、インスタンスを分ける方が安全

---

## 選んだ方針（別インスタンス）での「シーンが触っていいAPI」と「触っちゃダメな内部状態」

### ✅ シーンが触っていいAPI（公開API）

#### MlsMpmParticleSystem経由
- `particleSystem.setVisible(visible)` - 表示/非表示の切り替え
- `particleSystem.resetParticles()` - 粒子のリセット
- `particleSystem.applyTrack5Force(noteNumber, velocity, durationMs)` - 外力の適用
- `particleSystem.stepSimulation(delta, elapsed)` - シミュレーションの更新
- `particleSystem.updateRenderers()` - レンダラーの更新

#### MlsMpmSimulator経由（直接アクセスが必要な場合）
- `sim.setMouseRay(origin, direction, intersect)` - マウス操作
- `sim.uniforms.*.value` - パラメータの設定（重力、剛性、粘性など）
  - 例：`sim.uniforms.gravity.value.set(0, -9.8, 0)`
  - 例：`sim.uniforms.stiffness.value = 100.0`
- `sim.numParticles` - 現在の粒子数（読み取り）
- `sim.uniforms.numParticles.value` - 粒子数の設定

### ❌ 触っちゃダメな内部状態

#### バッファ関連（直接操作禁止）
- `sim.particleBuffer` - 直接操作禁止（`resetParticles()`や`update()`経由で操作）
- `sim.cellBuffer` - 直接操作禁止（compute kernel内部で管理）
- `sim.cellBufferF` - 直接操作禁止（compute kernel内部で管理）
- `sim.particleBuffer.buffer` - WebGPU backendの内部実装に依存するため触らない

#### Compute Pipeline関連
- `sim.kernels.*` - compute shaderの定義（変更禁止）
- `sim.kernels.clearGrid`、`sim.kernels.p2g1`など - 内部実装のため触らない

#### 内部状態
- `sim.impulses` - Track5 impulseの内部管理配列（`applyTrack5Force()`経由で操作）
- `sim.lastForceCenter` - 前回の力の中心位置（内部状態）
- `sim.mousePos`、`sim.mousePosArray` - マウス位置の内部管理（`setMouseRay()`経由で操作）

#### 設定フラグ（変更は可能だが注意が必要）
- `sim.freezeWhenNoImpulse` - シーン固有の動作モード（変更可能だが、他のシーンに影響しないよう注意）
- `sim.onlyImpulseMotion` - シーン固有の動作モード（同上）

### 📝 推奨パターン

```javascript
// ✅ 良い例：公開API経由で操作
await this.particleSystem.resetParticles();
this.particleSystem.setVisible(true);
this.particleSystem.applyTrack5Force(60, 1.0, 1000);

// ✅ 良い例：uniforms経由でパラメータ設定
this.particleSystem.sim.uniforms.gravity.value.set(0, -9.8, 0);
this.particleSystem.sim.uniforms.stiffness.value = 100.0;

// ❌ 悪い例：内部バッファを直接操作
this.particleSystem.sim.particleBuffer.set(0, "position", [1, 2, 3]); // 禁止

// ❌ 悪い例：compute kernelを直接呼び出し
this.particleSystem.sim.kernels.p2g1(); // 禁止
```

---

## まとめ

- **方針**: シーンごとに別インスタンスを作成（現状の実装を維持）
- **理由**: 状態の独立性、パラメータの独立性、デバッグ性が最重要
- **最適化**: Compute Pipelineの共有は将来的に検討可能だが、現状は不要
- **API設計**: 公開API経由での操作を推奨し、内部バッファやcompute pipelineへの直接アクセスは禁止
