/**
 * CameraParticle Class
 * カメラを動かすためのパーティクル
 * Particleクラスを継承
 */

import { Particle } from './Particle.js';
import * as THREE from 'three';
import { conf } from '../common/conf.js';

// カメラモード定数
export const CameraMode = {
    RANDOM: -1,           // ランダムモード（従来の動作）
    FRONT_WIDE: 0,        // フロント・ワイド（基準視点）
    FRONT_MEDIUM: 1,      // フロント・ミディアム
    CLOSEUP: 2,           // クローズアップ
    SIDE_PAN: 3,          // サイド・パン
    OFF_CENTER: 4,        // オフセンター固定
    SLOW_ORBIT: 5,        // スロー・オービット
    FOLLOW: 6,            // フォロー（追従）
    STILL: 7              // 静止ショット
};

// カメラモード名
export const CameraModeNames = {
    [CameraMode.RANDOM]: 'random',
    [CameraMode.FRONT_WIDE]: 'frontWide',
    [CameraMode.FRONT_MEDIUM]: 'frontMedium',
    [CameraMode.CLOSEUP]: 'closeup',
    [CameraMode.SIDE_PAN]: 'sidePan',
    [CameraMode.OFF_CENTER]: 'offCenter',
    [CameraMode.SLOW_ORBIT]: 'slowOrbit',
    [CameraMode.FOLLOW]: 'follow',
    [CameraMode.STILL]: 'still'
};

export class CameraParticle extends Particle {
    constructor() {
        super();
        
        // 物理パラメータ
        this.maxSpeed = 8.0;
        this.maxForce = 2.0;
        // NOTE:
        // - 減衰は conf で一括管理する（いつでも元に戻せるように）
        // - 初期値は conf.cameraNoDamping を見る
        this.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
        
        // 距離パラメータ
        this.maxDistance = 1500.0;
        this.minDistance = 400.0;
        this.maxDistanceReset = 1000.0;
        
        // 立方体の境界（nullの場合は球体の制限を使用）
        this.boxMin = null;
        this.boxMax = null;
        this.bounceDamping = 0.8;
        
        // 回転
        this.rotationX = (Math.random() - 0.5) * Math.PI * 2;
        this.rotationY = (Math.random() - 0.5) * Math.PI * 2;
        
        // 移動と回転の有効化フラグ（カメラランダマイズがオフの時にfalseにする）
        this.enableMovement = true;
        
        // グループ（A, B, C）
        this.group = 'A';
        
        // カメラモード
        this.cameraMode = CameraMode.RANDOM; // デフォルトはランダムモード
        this.modeName = CameraModeNames[CameraMode.RANDOM];
        
        // カメラモード別の状態
        this.modeState = {
            // サイドパン用
            sidePanDirection: 1, // 1=右, -1=左
            sidePanInitialized: false,
            
            // スローオービット用（球面座標系）
            orbitLongitude: 0, // 経度 (0～2π)
            orbitLatitudeBase: Math.PI, // 緯度の基準 (180° = 赤道)
            orbitLatitudeOffset: 0, // 緯度のオフセット (±90°)
            orbitSpeed: 0.0008, // 回転速度
            
            // オフセンター用
            offCenterOffset: new THREE.Vector3(0, 0, 0),
            
            // フォロー用
            followTarget: new THREE.Vector3(0, 0, 0),
            smoothLookAtTarget: new THREE.Vector3(0, 0, 0),
            lastFollowTargetUpdateMs: 0,
            
            // 注視点（クローズアップ、オフセンター用）
            lookAtTarget: new THREE.Vector3(0, 0, 0)
        };
        
        // 初期位置を設定
        this.initializePosition();
    }
    
    /**
     * 初期位置を設定
     */
    initializePosition() {
        if (this.boxMin && this.boxMax) {
            // 立方体の境界がある場合
            this.position.set(
                this.boxMin.x + Math.random() * (this.boxMax.x - this.boxMin.x),
                this.boxMin.y + Math.random() * (this.boxMax.y - this.boxMin.y),
                this.boxMin.z + Math.random() * (this.boxMax.z - this.boxMin.z)
            );
        } else {
            // 球面上のランダムな位置に配置
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const distance = this.minDistance + Math.random() * (this.maxDistanceReset - this.minDistance);
            
            this.position.set(
                Math.cos(angle1) * Math.sin(angle2) * distance,
                Math.sin(angle1) * Math.sin(angle2) * distance,
                Math.cos(angle2) * distance
            );
        }
    }
    
    /**
     * 更新処理
     */
    update() {
        // 毎フレーム conf を反映（ライブ中に値を変えても追従できる）
        this.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);

        // 基底クラスの更新処理を呼ぶ
        super.update();
        
        // 立方体の境界がある場合は、立方体の境界で制限
        if (this.boxMin && this.boxMax) {
            this.checkBoundingBox();
        } else {
            // 球体の制限を使用
            if (this.position.length() > this.maxDistance) {
                this.position.normalize();
                this.position.multiplyScalar(this.maxDistance);
            }
        }
        
        // 移動が有効な場合のみ、回転を更新（gentleForceは削除：OSCが来た時だけ動く）
        if (this.enableMovement) {
            // 回転も少し動かす（Processingと同じ）
            this.rotationX += this.velocity.y * 0.01;
            this.rotationY += this.velocity.x * 0.01;
        } else {
            // 移動が無効な場合：
            // - conf.cameraNoDamping=true : 減衰しない（ゼロ減衰）
            // - conf.cameraNoDamping=false: 以前の挙動（減衰して静止）
            if (!conf.cameraNoDamping) {
                const damp = Number(conf.cameraMovementOffVelocityDamping ?? 0.95);
                this.velocity.multiplyScalar(damp);
            }
            this.force.set(0, 0, 0);
        }
    }
    
    /**
     * グループを設定
     */
    setGroup(group) {
        this.group = group;
    }
    
    /**
     * 弱めのランダムな力を加える（A群・B群用）
     */
    applyRandomForceWeak() {
        const action = Math.random();
        
        if (action < 0.2) {
            // 20%の確率で球体の中心に向かう
            const toCenter = new THREE.Vector3(0, 0, 0).sub(this.position);
            if (toCenter.length() > 0) {
                toCenter.normalize();
                const strength = 0.3 + Math.random() * 0.3;  // 弱め
                this.force.copy(toCenter.multiplyScalar(strength));
            }
        } else if (action < 0.4) {
            // 20%の確率で遠くに移動（急に遠くへ）
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 0.5 + Math.random() * 0.5;  // 弱め
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        } else if (action < 0.7) {
            // 30%の確率でランダムな方向に急に動く
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 0.4 + Math.random() * 0.4;  // 弱め
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        } else {
            // 30%の確率で通常のランダムな方向
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 0.2 + Math.random() * 0.3;  // 弱め
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        }
        
        // 回転もランダムに変更（弱め）
        this.rotationX += (Math.random() - 0.5) * 0.2;
        this.rotationY += (Math.random() - 0.5) * 0.2;
    }
    
    /**
     * 立方体の境界をチェックして反発
     */
    checkBoundingBox() {
        // X方向の境界チェック
        if (this.position.x < this.boxMin.x) {
            this.position.x = this.boxMin.x;
            this.velocity.x *= -this.bounceDamping;
        } else if (this.position.x > this.boxMax.x) {
            this.position.x = this.boxMax.x;
            this.velocity.x *= -this.bounceDamping;
        }
        
        // Y方向の境界チェック
        if (this.position.y < this.boxMin.y) {
            this.position.y = this.boxMin.y;
            this.velocity.y *= -this.bounceDamping;
        } else if (this.position.y > this.boxMax.y) {
            this.position.y = this.boxMax.y;
            this.velocity.y *= -this.bounceDamping;
        }
        
        // Z方向の境界チェック
        if (this.position.z < this.boxMin.z) {
            this.position.z = this.boxMin.z;
            this.velocity.z *= -this.bounceDamping;
        } else if (this.position.z > this.boxMax.z) {
            this.position.z = this.boxMax.z;
            this.velocity.z *= -this.bounceDamping;
        }
    }
    
    /**
     * ランダムな力を加える（突き飛ばす）
     */
    applyRandomForce() {
        const action = Math.random();
        
        if (action < 0.2) {
            // 20%の確率で球体の中心に向かう
            const toCenter = new THREE.Vector3(0, 0, 0).sub(this.position);
            if (toCenter.length() > 0) {
                toCenter.normalize();
                const strength = 1.5 + Math.random() * 1.5;
                this.force.copy(toCenter.multiplyScalar(strength));
            }
        } else if (action < 0.4) {
            // 20%の確率で遠くに移動（急に遠くへ）
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 3.0 + Math.random() * 3.0;
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        } else if (action < 0.7) {
            // 30%の確率でランダムな方向に急に動く
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 2.0 + Math.random() * 2.5;
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        } else {
            // 30%の確率で通常のランダムな方向
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const strength = 1.0 + Math.random() * 1.5;
            
            this.force.set(
                Math.cos(angle1) * Math.sin(angle2) * strength,
                Math.sin(angle1) * Math.sin(angle2) * strength,
                Math.cos(angle2) * strength
            );
        }
        
        // 回転もランダムに変更
        this.rotationX += (Math.random() - 0.5) * 0.4;
        this.rotationY += (Math.random() - 0.5) * 0.4;
    }
    
    /**
     * リセット
     */
    reset() {
        this.initializePosition();
        this.velocity.set(0, 0, 0);
        this.acceleration.set(0, 0, 0);
        this.force.set(0, 0, 0);
        this.rotationX = (Math.random() - 0.5) * Math.PI * 2;
        this.rotationY = (Math.random() - 0.5) * Math.PI * 2;
    }
    
    /**
     * 回転を取得
     */
    getRotationX() {
        return this.rotationX;
    }
    
    getRotationY() {
        return this.rotationY;
    }
    
    /**
     * 位置を回転させる（オービット用）
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @param {number} z - Z座標
     * @param {number} rotX - X軸周りの回転角度（ラジアン）
     * @param {number} rotY - Y軸周りの回転角度（ラジアン）
     * @param {number} rotZ - Z軸周りの回転角度（ラジアン）
     * @returns {{x: number, y: number, z: number}} 回転後の座標
     */
    _rotatePosition(x, y, z, rotX, rotY, rotZ) {
        // X軸周りの回転
        let y1 = y * Math.cos(rotX) - z * Math.sin(rotX);
        let z1 = y * Math.sin(rotX) + z * Math.cos(rotX);
        let x1 = x;
        
        // Y軸周りの回転
        let x2 = x1 * Math.cos(rotY) + z1 * Math.sin(rotY);
        let z2 = -x1 * Math.sin(rotY) + z1 * Math.cos(rotY);
        let y2 = y1;
        
        // Z軸周りの回転
        let x3 = x2 * Math.cos(rotZ) - y2 * Math.sin(rotZ);
        let y3 = x2 * Math.sin(rotZ) + y2 * Math.cos(rotZ);
        let z3 = z2;
        
        return { x: x3, y: y3, z: z3 };
    }
    
    /**
     * カメラモードを設定（初期化）
     * @param {number} mode - カメラモード (CameraMode定数)
     * @param {number} rMax - パーティクルシステムの最大半径
     * @param {THREE.Vector3} boxMin - カメラの境界Box最小値
     * @param {THREE.Vector3} boxMax - カメラの境界Box最大値
     */
    setupCameraMode(mode, rMax, boxMin, boxMax) {
        this.cameraMode = mode;
        this.modeName = CameraModeNames[mode];
        this.boxMin = boxMin ? boxMin.clone() : null;
        this.boxMax = boxMax ? boxMax.clone() : null;
        
        switch (mode) {
            case CameraMode.FRONT_WIDE: // ① フロント・ワイド（基準視点）
                this.maxSpeed = 0.01;
                this.maxForce = 0.005;
                this.friction = conf.cameraNoDamping ? 0.0 : 0.05;
                this.position.set(0, 0, rMax * 4.5); // もっと引く
                this.desired = this.position.clone();
                break;
                
            case CameraMode.FRONT_MEDIUM: // ② フロント・ミディアム
                this.maxSpeed = 0.03;
                this.maxForce = 0.01;
                this.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                this.position.set(0, 0, rMax * 2.0);
                this.desired = this.position.clone();
                break;
                
            case CameraMode.CLOSEUP: // ③ クローズアップ
                this.maxSpeed = 0.05;
                this.maxForce = 0.02;
                this.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                // ランダムな方向に近づく（もっと近く、注視点をランダムに）
                const closeupDir = new THREE.Vector3(
                    (Math.random() - 0.5) * 1.0,
                    (Math.random() - 0.5) * 1.0,
                    1
                ).normalize();
                this.position.copy(closeupDir.multiplyScalar(rMax * 0.5));
                this.desired = this.position.clone();
                // 注視点をランダムに設定（中心じゃない）
                this.modeState.lookAtTarget = new THREE.Vector3(
                    (Math.random() - 0.5) * rMax * 0.5,
                    (Math.random() - 0.5) * rMax * 0.5,
                    (Math.random() - 0.5) * rMax * 0.5
                );
                break;
                
            case CameraMode.SIDE_PAN: // ④ サイド・パン
                this.maxSpeed = 0.12;
                this.maxForce = 0.08;
                this.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                // 切り替わった時にランダムで右か左に方向を決める
                this.modeState.sidePanDirection = Math.random() > 0.5 ? 1 : -1;
                this.modeState.sidePanInitialized = false;
                this.position.set(0, 0, rMax * 2.4);
                this.desired = this.position.clone();
                break;
                
            case CameraMode.OFF_CENTER: // ⑤ オフセンター固定
                this.maxSpeed = 0.01;
                this.maxForce = 0.005;
                this.friction = conf.cameraNoDamping ? 0.0 : 0.05;
                // オフセットを適用した位置に配置
                this.modeState.offCenterOffset.set(
                    (Math.random() - 0.5) * 0.3,
                    (Math.random() - 0.5) * 0.3,
                    0
                );
                const offCenterX = this.modeState.offCenterOffset.x * rMax * 2.0;
                const offCenterY = this.modeState.offCenterOffset.y * rMax * 2.0;
                this.position.set(offCenterX, offCenterY, rMax * 2.4);
                this.desired = this.position.clone();
                // 注視点をランダムに設定（中心じゃない）
                this.modeState.lookAtTarget = new THREE.Vector3(
                    (Math.random() - 0.5) * rMax * 0.5,
                    (Math.random() - 0.5) * rMax * 0.5,
                    (Math.random() - 0.5) * rMax * 0.5
                );
                break;
                
            case CameraMode.SLOW_ORBIT: // ⑥ スロー・オービット（球面座標系で位置を直接マッピング）
                this.maxSpeed = 0.15;
                this.maxForce = 0.08;
                this.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                // 球面座標系の初期化（切り替え時のみ）
                this.modeState.orbitAngle = Math.random() * Math.PI * 2; // 角度: 0～360°（進行方向）
                this.modeState.orbitRadius = rMax * 2.8; // 半径
                this.modeState.orbitSpeed = 0.0008; // 回転速度
                
                // ランダムな回転角度（軌道の傾き）
                this.modeState.orbitRotationX = (Math.random() - 0.5) * Math.PI; // X軸周りの回転: ±90°
                this.modeState.orbitRotationY = (Math.random() - 0.5) * Math.PI; // Y軸周りの回転: ±90°
                this.modeState.orbitRotationZ = (Math.random() - 0.5) * Math.PI; // Z軸周りの回転: ±90°
                
                // 初期位置を設定（XZ平面上の円）
                const angle = this.modeState.orbitAngle;
                const r = this.modeState.orbitRadius;
                
                // XZ平面上の円（Y=0の赤道）
                let posX = r * Math.cos(angle);
                let posY = 0;
                let posZ = r * Math.sin(angle);
                
                // ランダム回転を適用
                const rotatedPos = this._rotatePosition(posX, posY, posZ, 
                    this.modeState.orbitRotationX, 
                    this.modeState.orbitRotationY, 
                    this.modeState.orbitRotationZ);
                
                this.position.set(rotatedPos.x, rotatedPos.y, rotatedPos.z);
                
                // boxの制限を解除（範囲関係なく周回）
                this.boxMin = null;
                this.boxMax = null;
                break;
                
            case CameraMode.FOLLOW: // ⑦ フォロー（追従）
                this.maxSpeed = 0.06;
                this.maxForce = 0.025;
                this.friction = conf.cameraNoDamping ? 0.0 : (conf.cameraFriction ?? 0.02);
                this.position.set(0, 0, rMax * 2.2);
                this.desired = this.position.clone();
                this.modeState.followTarget.set(0, 0, 0);
                this.modeState.smoothLookAtTarget.set(0, 0, 0);
                this.modeState.lastFollowTargetUpdateMs = 0;
                break;
                
            case CameraMode.STILL: // ⑧ 静止ショット
                this.maxSpeed = 0.005;
                this.maxForce = 0.002;
                this.friction = conf.cameraNoDamping ? 0.0 : 0.08;
                this.position.set(0, 0, rMax * 2.5);
                this.desired = this.position.clone();
                break;
                
            case CameraMode.RANDOM: // ランダムモード
            default:
                // ランダムモードの場合は何もしない（従来の動作）
                break;
        }
    }
    
    /**
     * カメラモード別の更新処理（毎フレーム呼ぶ）
     * @param {number} deltaTime - フレーム間の時間差
     * @param {number} rMax - パーティクルシステムの最大半径（動的に変わる可能性がある）
     */
    updateCameraMode(deltaTime, rMax) {
        if (this.cameraMode === CameraMode.RANDOM) {
            // ランダムモードの場合は何もしない（従来の動作）
            return;
        }
        
        switch (this.cameraMode) {
            case CameraMode.FRONT_WIDE: // ① フロント・ワイド - ほぼ固定
                // desiredを少しだけ動かす（微ドリフト）
                break;
                
            case CameraMode.FRONT_MEDIUM: // ② フロント・ミディアム - 微ドリフト
                const drift = new THREE.Vector3(
                    (Math.random() - 0.5) * 0.01,
                    (Math.random() - 0.5) * 0.01,
                    0
                );
                this.desired.add(drift);
                break;
                
            case CameraMode.CLOSEUP: // ③ クローズアップ - ランダムに近づく
                // 時々新しい近接位置を設定
                if (Math.random() < 0.01) {
                    const closeupDir = new THREE.Vector3(
                        (Math.random() - 0.5) * 1.0,
                        (Math.random() - 0.5) * 1.0,
                        1
                    ).normalize();
                    this.desired.copy(closeupDir.multiplyScalar(rMax * 0.5));
                }
                break;
                
            case CameraMode.SIDE_PAN: // ④ サイド・パン - 切替時のみ力を加える
                // 切替時のみ力を加える（フラグで管理）
                if (!this.modeState.sidePanInitialized) {
                    const panDir = this.modeState.sidePanDirection;
                    const panForce = 0.01; // 力を弱く
                    
                    // 右か左に力を加える（切替時のみ）
                    this.force.x = panDir * panForce;
                    this.force.y = 0;
                    this.force.z = 0;
                    
                    this.modeState.sidePanInitialized = true;
                }
                
                // 範囲を超えたら方向を反転（境界でバウンド）
                const panLimit = rMax * 3.0;
                if (Math.abs(this.position.x) > panLimit) {
                    this.modeState.sidePanDirection *= -1;
                }
                break;
                
            case CameraMode.OFF_CENTER: // ⑤ オフセンター固定 - 固定（位置を維持）
                // オフセット位置を維持
                const offCenterX = this.modeState.offCenterOffset.x * rMax * 2.0;
                const offCenterY = this.modeState.offCenterOffset.y * rMax * 2.0;
                this.desired.set(offCenterX, offCenterY, rMax * 2.4);
                break;
                
            case CameraMode.SLOW_ORBIT: // ⑥ スロー・オービット - 角度を進めて位置を直接マッピング
                // 角度を進める（0～360°をループ）
                const oldAngle = this.modeState.orbitAngle;
                this.modeState.orbitAngle += this.modeState.orbitSpeed * deltaTime * 60;
                while (this.modeState.orbitAngle >= Math.PI * 2) {
                    this.modeState.orbitAngle -= Math.PI * 2;
                }
                
                // XZ平面上の円（Y=0の赤道）
                const angle = this.modeState.orbitAngle;
                const r = rMax * 2.8;
                
                let posX = r * Math.cos(angle);
                let posY = 0;
                let posZ = r * Math.sin(angle);
                
                // ランダム回転を適用
                const rotatedPos = this._rotatePosition(posX, posY, posZ, 
                    this.modeState.orbitRotationX, 
                    this.modeState.orbitRotationY, 
                    this.modeState.orbitRotationZ);
                
                this.position.set(rotatedPos.x, rotatedPos.y, rotatedPos.z);
                break;
                
            case CameraMode.FOLLOW: // ⑦ フォロー（追従） - Track5の圧力位置を追う
                // Track5の最新の圧力位置を追う（滑らかに補間）
                if (this.modeState.followTarget && this.modeState.smoothLookAtTarget) {
                    // 注視点を滑らかに補間（カメラを回すような連続した動き）
                    const lookAtLerp = 0.08; // 補間係数
                    this.modeState.smoothLookAtTarget.lerp(this.modeState.followTarget, lookAtLerp);
                    
                    // カメラ位置も滑らかに追う
                    const toTarget = this.modeState.followTarget.clone().sub(this.desired);
                    const distance = toTarget.length();
                    
                    // 距離に応じて追従速度を変える
                    let followSpeed = 0.0;
                    if (distance > 0.5) {
                        followSpeed = 0.015;
                    } else if (distance > 0.2) {
                        followSpeed = 0.008;
                    } else {
                        followSpeed = 0.003;
                    }
                    
                    // 最大速度制限
                    const maxStep = 0.02 * deltaTime * 60;
                    const step = Math.min(distance * followSpeed, maxStep);
                    
                    if (distance > 0.001) {
                        toTarget.normalize().multiplyScalar(step);
                        this.desired.add(toTarget);
                    }
                }
                break;
                
            case CameraMode.STILL: // ⑧ 静止ショット - ほぼ動かない
                this.desired.copy(this.position);
                break;
        }
    }
}

