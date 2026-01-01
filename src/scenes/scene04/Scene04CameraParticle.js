/**
 * Scene04CameraParticle
 * - Scene04専用の「道なりカメラ」パーティクル
 * - “力を加えて”追従する（直接 lerp で座標を書き換えない）
 *
 * 方針:
 * - cameraCenter(=注視点) を原点として、カメラはローカルoffsetで表現
 * - ローカルoffsetを spring で desired に引っ張る
 * - 箱（boxMin/boxMax）でコリドー制限（バウンドせずクランプ）
 */

import * as THREE from 'three';
import { CameraParticle } from '../../lib/CameraParticle.js';

export class Scene04CameraParticle extends CameraParticle {
    constructor({
        desired = new THREE.Vector3(0, 0.18, 1.6),
        // NOTE:
        // pullback（前方へ回って後ろを見る）では desired.z が負側にも行くので広めに取る
        boxMin = new THREE.Vector3(-1.2, 0.03, -40.0),
        boxMax = new THREE.Vector3(1.2, 2.2, 40.0),
        springK = 0.18,
        damping = 0.22,
    } = {}) {
        super();
        this.desired = desired.clone();
        this.boxMin = boxMin.clone();
        this.boxMax = boxMax.clone();
        this.springK = springK;
        this.damping = damping;

        // Scene04は“道”なので回転はほぼ固定でOK（必要なら後で使う）
        this.rotationX = 0;
        this.rotationY = 0;

        // 初期位置はdesired付近
        this.position.copy(this.desired);
        this.velocity.set(0, 0, 0);
        this.force.set(0, 0, 0);
    }

    /**
     * desiredに向かう力を加える（ばね + 速度ダンピング）
     */
    applyFollowForce() {
        const to = this.desired.clone().sub(this.position); // desired - pos
        // spring
        const f = to.multiplyScalar(this.springK);
        // damping（速度方向を打ち消す）
        f.add(this.velocity.clone().multiplyScalar(-this.damping));
        this.addForce(f);
    }

    /**
     * CameraParticle.update() から呼ばれる：境界はバウンドせずクランプ
     */
    checkBoundingBox() {
        // clamp
        const px = THREE.MathUtils.clamp(this.position.x, this.boxMin.x, this.boxMax.x);
        const py = THREE.MathUtils.clamp(this.position.y, this.boxMin.y, this.boxMax.y);
        const pz = THREE.MathUtils.clamp(this.position.z, this.boxMin.z, this.boxMax.z);

        // クランプした軸の速度は殺す（跳ね返りを防ぐ）
        if (px !== this.position.x) this.velocity.x = 0;
        if (py !== this.position.y) this.velocity.y = 0;
        if (pz !== this.position.z) this.velocity.z = 0;

        this.position.set(px, py, pz);
    }
}
