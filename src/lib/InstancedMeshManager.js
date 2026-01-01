/**
 * InstancedMeshManager Class
 * GPUインスタンシングを管理するクラス
 * 物理演算（落下、吹き飛ばし、引力など）で使用する大量のインスタンスを効率的に描画
 */

import * as THREE from 'three';

export class InstancedMeshManager {
    /**
     * コンストラクタ
     * @param {THREE.Scene} scene - シーン
     * @param {THREE.BufferGeometry} geometry - ジオメトリ（Box、Sphereなど任意の形状）
     * @param {THREE.Material} material - メインマテリアル
     * @param {number} count - インスタンス数
     * @param {Object} options - オプション
     * @param {THREE.Material} options.wireframeMaterial - ワイヤーフレーム用マテリアル（オプション）
     * @param {number} options.wireframeRenderOrder - ワイヤーフレームの描画順序（デフォルト: 1）
     */
    constructor(scene, geometry, material, count, options = {}) {
        if (!scene) {
            throw new Error('InstancedMeshManager: scene is required');
        }
        if (!geometry) {
            throw new Error('InstancedMeshManager: geometry is required');
        }
        if (!material) {
            throw new Error('InstancedMeshManager: material is required');
        }
        if (!count || count <= 0) {
            throw new Error('InstancedMeshManager: count must be greater than 0');
        }
        
        this.scene = scene;
        this.geometry = geometry;
        this.material = material;
        this.count = count;
        this.wireframeMaterial = options.wireframeMaterial || null;
        this.wireframeRenderOrder = options.wireframeRenderOrder || 1;
        
        // メインのInstancedMeshを作成
        this.mainMesh = new THREE.InstancedMesh(geometry, material, count);
        this.mainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // 動的に更新するため
        this.mainMesh.frustumCulled = false; // 視錐台カリングを無効化（カメラ切り替え時に見えなくなる問題を防ぐ）
        scene.add(this.mainMesh);
        
        // ワイヤーフレーム用のInstancedMesh（オプション）
        if (this.wireframeMaterial) {
            this.wireframeMesh = new THREE.InstancedMesh(geometry, this.wireframeMaterial, count);
            this.wireframeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.wireframeMesh.renderOrder = this.wireframeRenderOrder;
            this.wireframeMesh.frustumCulled = false; // 視錐台カリングを無効化
            scene.add(this.wireframeMesh);
        } else {
            this.wireframeMesh = null;
        }
        
        // 一時変数（毎回newするのを避けてパフォーマンス向上）
        this.tempMatrix = new THREE.Matrix4();
        this.tempQuaternion = new THREE.Quaternion();
        this.tempPosition = new THREE.Vector3();
        this.tempScale = new THREE.Vector3();
    }
    
    /**
     * マトリックスを設定（位置、回転、スケール）
     * @param {number} index - インスタンスのインデックス
     * @param {THREE.Vector3|Object} position - 位置（Vector3または{x, y, z}）
     * @param {THREE.Euler|THREE.Quaternion|Object} rotation - 回転（Euler、Quaternion、または{x, y, z}）
     * @param {THREE.Vector3|Object} scale - スケール（Vector3または{x, y, z}）
     */
    setMatrixAt(index, position, rotation, scale) {
        if (index < 0 || index >= this.count) {
            console.warn(`InstancedMeshManager: index ${index} is out of range (0-${this.count - 1})`);
            return;
        }
        
        // 位置を設定
        if (position instanceof THREE.Vector3) {
            this.tempPosition.copy(position);
        } else if (position && typeof position.x === 'number') {
            this.tempPosition.set(position.x, position.y || 0, position.z || 0);
        } else {
            this.tempPosition.set(0, 0, 0);
        }
        
        // 回転を設定
        if (rotation instanceof THREE.Euler) {
            this.tempQuaternion.setFromEuler(rotation);
        } else if (rotation instanceof THREE.Quaternion) {
            this.tempQuaternion.copy(rotation);
        } else if (rotation && typeof rotation.x === 'number') {
            // オイラー角として扱う
            this.tempQuaternion.setFromEuler(new THREE.Euler(
                rotation.x || 0,
                rotation.y || 0,
                rotation.z || 0,
                rotation.order || 'XYZ'
            ));
        } else {
            this.tempQuaternion.identity();
        }
        
        // スケールを設定
        if (scale instanceof THREE.Vector3) {
            this.tempScale.copy(scale);
        } else if (scale && typeof scale.x === 'number') {
            this.tempScale.set(scale.x, scale.y || scale.x, scale.z || scale.x);
        } else if (typeof scale === 'number') {
            // 数値の場合は均一なスケール
            this.tempScale.set(scale, scale, scale);
        } else {
            this.tempScale.set(1, 1, 1);
        }
        
        // マトリックスを計算
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        
        // メインメッシュに設定
        this.mainMesh.setMatrixAt(index, this.tempMatrix);
        
        // ワイヤーフレームメッシュにも設定（存在する場合）
        if (this.wireframeMesh) {
            this.wireframeMesh.setMatrixAt(index, this.tempMatrix);
        }
    }
    
    /**
     * 更新をマーク（needsUpdateをtrueにする）
     * マトリックスを更新した後、必ず呼び出すこと
     */
    markNeedsUpdate() {
        this.mainMesh.instanceMatrix.needsUpdate = true;
        if (this.wireframeMesh) {
            this.wireframeMesh.instanceMatrix.needsUpdate = true;
        }
    }
    
    /**
     * インスタンス数を変更（再作成が必要）
     * @param {number} newCount - 新しいインスタンス数
     */
    setCount(newCount) {
        if (newCount <= 0) {
            console.warn('InstancedMeshManager: count must be greater than 0');
            return;
        }
        
        // 既存のメッシュを削除
        this.dispose();
        
        // 新しいメッシュを作成
        this.count = newCount;
        this.mainMesh = new THREE.InstancedMesh(this.geometry, this.material, newCount);
        this.mainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mainMesh.frustumCulled = false; // 視錐台カリングを無効化
        this.scene.add(this.mainMesh);
        
        if (this.wireframeMaterial) {
            this.wireframeMesh = new THREE.InstancedMesh(this.geometry, this.wireframeMaterial, newCount);
            this.wireframeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.wireframeMesh.renderOrder = this.wireframeRenderOrder;
            this.wireframeMesh.frustumCulled = false; // 視錐台カリングを無効化
            this.scene.add(this.wireframeMesh);
        }
    }
    
    /**
     * メインメッシュを取得
     * @returns {THREE.InstancedMesh}
     */
    getMainMesh() {
        return this.mainMesh;
    }
    
    /**
     * ワイヤーフレームメッシュを取得
     * @returns {THREE.InstancedMesh|null}
     */
    getWireframeMesh() {
        return this.wireframeMesh;
    }
    
    /**
     * インスタンス数を取得
     * @returns {number}
     */
    getCount() {
        return this.count;
    }
    
    /**
     * リソースを解放
     */
    dispose() {
        if (this.mainMesh) {
            this.scene.remove(this.mainMesh);
            this.mainMesh.dispose();
            this.mainMesh = null;
        }
        
        if (this.wireframeMesh) {
            this.scene.remove(this.wireframeMesh);
            this.wireframeMesh.dispose();
            this.wireframeMesh = null;
        }
    }
}

