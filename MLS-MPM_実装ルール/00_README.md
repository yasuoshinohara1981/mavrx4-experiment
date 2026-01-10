# MLS-MPM 実装ルール

このフォルダには、MLS-MPMをシーンごとに別インスタンスにする方針に関する実装ルールをまとめています。

## ファイル構成

- **00_README.md** - このファイル（概要）
- **01_プリロード設計と別インスタンス方針の両立.md** - 質問1の回答
- **02_GPUバッファのライフサイクル管理.md** - 質問2の回答
- **03_confグローバル状態の扱い方.md** - 質問3の回答
- **04_conf分離_最小変更案.md** - conf分離の最小変更案（設計と方針）
- **05_conf分離_実装例.md** - conf分離の具体的な実装例（コード）
- **06_Canaryシーン設計.md** - Scene00_Canaryの設計とrenderProfile/sceneParamsの契約
- **07_conf分離_SceneManager実装案.md** - SceneManagerにconf分離を最小変更で実装する具体的な実装案

## 質問の背景

MLS-MPM（MlsMpmSimulator + 粒子バッファ + compute pipeline）をシーンごとに別インスタンスにする方針を維持する場合、以下の3つの質問に対する回答をまとめています：

1. プリロードで「全シーンrender」する設計は、別インスタンス方針と両立するか？
2. シーン切替時のライフサイクルで、MlsMpmSimulatorのGPUバッファをいつ確保し、いつ解放すべきか？
3. confのようなグローバル状態がMLS-MPMの表示や挙動に影響しているが、別インスタンス方針でデグレを防ぐには conf をどう扱うべきか？

## 推奨方針のまとめ

### 1. プリロード設計
- ✅ **全シーンrenderは両立可能**
- **安全条件**: setup()時にconfから読み取ってシーン内に保存、プリロード時のrender()ではconfを変更しない

### 2. ライフサイクル
- ✅ **「全シーン常駐」方式を推奨**
- setup()時にGPUバッファを確保
- setResourceActive(false)でupdate/renderを停止（バッファは保持）
- dispose()は通常呼ばない（アプリ終了時のみ）

### 3. confの扱い
- ✅ **「setup()時にconfから読み取ってシーン内に保存」方式**
- MlsMpmParticleSystem.init()にparamsを渡す
- confは読み取り専用化（段階的移行）

## 実装の優先順位

1. **最優先**: MlsMpmParticleSystem.init()にparamsを渡す対応
2. **次**: setup()時にconfから読み取ってシーン内に保存
3. **最後**: confの読み取り専用化（段階的移行）

## 関連ファイル

- `src/systems/MlsMpmParticleSystem.js` - MLS-MPMパーティクルシステム
- `src/mls-mpm/mlsMpmSimulator.js` - MLS-MPMシミュレーター
- `src/systems/SceneManager.js` - シーンマネージャー
- `src/common/conf.js` - グローバル設定
