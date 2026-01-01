import mobile from "is-mobile";
import * as THREE from "three/webgpu";

class Conf {
    gui = null;
    // 15万にするため上限も上げる（8192*20=163,840）
    maxParticles = 8192 * 20;
    // 粒数（maxParticles以下にすること）
    particles = 130000;

    // パーティクル形状（すぐ戻せるようにスイッチ化）
    // - 'sphere': 低ポリ球（IcoSphere）
    // - 'roundedBox': 角丸Box（従来）
    particleShape = 'roundedBox';

    bloom = true;

    // ============================================
    // Camera（CameraParticle）共通チューニング
    // ============================================
    // NOTE:
    // - ここを変えれば全シーンのCameraParticle挙動を一括で戻せる
    // - noDamping=true で「減衰ゼロ」寄り（friction=0 / enableMovement=false時も減衰しない）
    cameraNoDamping = true;
    // noDamping=false のときに使う friction（Particle.update の velocity.mult(1-friction)）
    cameraFriction = 0.02;
    // enableMovement=false のときの速度減衰（以前の挙動互換）
    cameraMovementOffVelocityDamping = 0.95;

    // renderer.shadowMap は重い＆全シーン共通なのでここで統制する
    enableShadows = false;
    // 粒子（Instanced Mesh）自体の影
    particleCastShadow = false;
    particleReceiveShadow = false;

    run = true;
    noise = 0.0; // カールノイズ（デフォルトOFF、トラック5で力を加える）
    speed = 1;
    stiffness = 3.;
    restDensity = 1.;
    density = 1;
    // 粘性（摩擦っぽさ）。大きいほど動きが重くなる
    dynamicViscosity = 0.06;
    gravity = 0;
    gravitySensorReading = new THREE.Vector3();
    accelerometerReading = new THREE.Vector3();
    actualSize = 1;
    size = 1;

    // ヒートマップ（運動→色）のレンジ
    // - 1フレームの移動量（概ね |velocity| * dt ）がこの範囲に入ると 青→赤 に変化する
    // - 赤くなりっぱなしなら max を上げる / min を上げる
    // - 青すぎるなら max を下げる / min を下げる
    heatSpeedMin = 0.0005;
    heatSpeedMax = 0.015;

    points = false;

    constructor(info) {
        if (mobile()) {
            this.maxParticles = 8192 * 8;
            this.particles = 4096;
        }
        this.updateParams();

    }

    updateParams() {
        const level = Math.max(this.particles / 8192,1);
        const size = 1.6/Math.pow(level, 1/3);
        this.actualSize = size * this.size;
        this.restDensity = 0.25 * level * this.density;
    }

    setupGravitySensor() {
        if (this.gravitySensor) { return; }
        this.gravitySensor = new GravitySensor({ frequency: 60 });
        this.gravitySensor.addEventListener("reading", (e) => {
            this.gravitySensorReading.copy(this.gravitySensor).divideScalar(50);
            this.gravitySensorReading.setY(this.gravitySensorReading.y * -1);
        });
        this.gravitySensor.start();
    }

    init() {
        // UI（stats/settings）は使わない方針
        // ここはno-opにして、描画用のパラメータはデフォルト値のみ使う
    }

    update() {
    }

    begin() {
        // UIなし
    }
    end() {
        // UIなし
    }
}
export const conf = new Conf();