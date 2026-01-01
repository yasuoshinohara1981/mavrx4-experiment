/**
 * MlsMpmParticleSystem (WebGPU)
 * - MLS-MPMシミュレーション + 描画（Mesh/Points）をまとめた再利用用ユニット
 * - シーン固有のパラメータは conf や、呼び出し側の設定で調整する前提
 */

import { conf } from '../common/conf.js';
import MlsMpmSimulator from '../mls-mpm/mlsMpmSimulator.js';
import ParticleRenderer from '../mls-mpm/particleRenderer.js';
import PointRenderer from '../mls-mpm/pointRenderer.js';

export class MlsMpmParticleSystem {
  constructor(renderer) {
    this.renderer = renderer;
    this.sim = null;
    this.particleRenderer = null;
    this.pointRenderer = null;
    // 外部（シーン）からの表示トグルを保持する
    this.visible = true;
  }

  /**
   * GPU側バッファの初期化まで含めてセットアップする
   * @param {{ scene: import('three').Scene }} params
   */
  async init({ scene }) {
    this.sim = new MlsMpmSimulator(this.renderer);
    await this.sim.init();

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

    this.applyVisibilityFromConf();
  }

  applyVisibilityFromConf() {
    const showPoints = !!conf.points;
    if (this.particleRenderer?.object) this.particleRenderer.object.visible = this.visible && !showPoints;
    if (this.pointRenderer?.object) this.pointRenderer.object.visible = this.visible && showPoints;
  }

  setVisible(visible) {
    this.visible = !!visible;
    this.applyVisibilityFromConf();
  }

  updateRenderers() {
    this.applyVisibilityFromConf();
    if (this.particleRenderer) this.particleRenderer.update();
    if (this.pointRenderer) this.pointRenderer.update();
  }

  async stepSimulation(delta, elapsed) {
    if (!this.sim) return;
    await this.sim.update(delta, elapsed);
  }

  resetParticles() {
    return this.sim?.resetParticles?.();
  }

  applyTrack5Force(noteNumber, velocity, durationMs) {
    return this.sim?.applyTrack5Force?.(noteNumber, velocity, durationMs);
  }
}


