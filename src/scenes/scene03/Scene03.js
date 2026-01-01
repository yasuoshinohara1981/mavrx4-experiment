/**
 * Scene03 (WebGPU): Placeholder Scene
 * 元のファイルが失われたため、最小限のプレースホルダーシーン
 */

import { SceneBase } from '../SceneBase.js';
import * as THREE from "three/webgpu";
import { GridRuler3D } from '../../lib/GridRuler3D.js';
import { conf } from '../../common/conf.js';

export class Scene03 extends SceneBase {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera);
        this.title = 'mathym | uiojp (Placeholder)';
        this.sharedResourceManager = sharedResourceManager;
        
        // 表示設定
        this.SHOW_PARTICLES = true;
        
        // グリッド
        this.gridRuler = null;
        this.showGrid = false;
        
        // カメラ設定
        this.camera.near = 0.1;
        this.camera.far = 2000;
        this.camera.updateProjectionMatrix();
        
        // パーティクル
        this.particleSystem = null;
    }

    async setup() {
        // シーン作成
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111122);
        
        // オーバーレイシーン（HUD用）
        this.overlayScene = new THREE.Scene();
        
        // ライト
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);
        
        // シンプルな球体パーティクルシステム
        this._createParticles();
        
        // グリッド
        this.gridRuler = new GridRuler3D({
            gridSize: 2000,
            gridDivisions: 40,
            axisLength: 500,
        });
        this.gridRuler.addToScene(this.overlayScene);
        this.gridRuler.setVisible(this.showGrid);
        
        // HUD初期化
        this.initHUD();
        
        // PostFX初期化
        this.initPostFX();
        
        // カメラ初期位置
        this.camera.position.set(0, 200, 600);
        this.camera.lookAt(0, 0, 0);
    }
    
    _createParticles() {
        const geometry = new THREE.BufferGeometry();
        const particleCount = 100000;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        
        // 球体状にパーティクルを配置
        const radius = 400;
        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            const r = radius * (0.8 + Math.random() * 0.2);
            
            positions[i3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i3 + 2] = r * Math.cos(phi);
            
            // 白〜青のグラデーション
            const t = Math.random();
            colors[i3] = 0.7 + t * 0.3;
            colors[i3 + 1] = 0.7 + t * 0.3;
            colors[i3 + 2] = 1.0;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const material = new THREE.PointsMaterial({
            size: 3,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true,
        });
        
        this.particleSystem = new THREE.Points(geometry, material);
        this.scene.add(this.particleSystem);
        this.particleCount = particleCount;
    }

    update(deltaTime) {
        // 時間更新
        this.time += deltaTime * 0.001;
        
        // パーティクルをゆっくり回転
        if (this.particleSystem) {
            this.particleSystem.rotation.y += deltaTime * 0.0001;
        }
        
        // HUD更新
        if (this.hud && this.showHUD) {
            this.hud.update({
                sceneTitle: this.title,
                fps: this.lastFrameTime ? Math.round(1000 / this.lastFrameTime) : 0,
                particleCount: this.particleCount,
                phase: this.phase,
                oscStatus: this.oscStatus,
            });
        }
    }

    async render() {
        if (!this.scene || !this.camera) return;
        
        // メインレンダリング
        if (this.postProcessing) {
            await this.postProcessing.renderAsync();
        } else {
            await this.renderer.renderAsync(this.scene, this.camera);
        }
        
        // オーバーレイ（グリッド）
        if (this.showGrid && this.overlayScene) {
            await this.renderer.renderAsync(this.overlayScene, this.camera);
        }
        
        // HUD
        if (this.hud && this.showHUD) {
            this.hud.render(this.renderer, this.camera);
        }
    }

    handleKeyDown(key) {
        switch (key.toLowerCase()) {
            case 'g':
                this.showGrid = !this.showGrid;
                if (this.gridRuler) this.gridRuler.setVisible(this.showGrid);
                console.log(`[Scene03] グリッド: ${this.showGrid ? 'ON' : 'OFF'}`);
                break;
            case 'h':
                this.showHUD = !this.showHUD;
                if (this.hud) this.hud.showHUD = this.showHUD;
                break;
        }
    }

    setResourceActive(active) {
        this._resourceActive = !!active;
        if (this.particleSystem) {
            this.particleSystem.visible = this._resourceActive;
        }
    }

    dispose() {
        if (this.particleSystem) {
            this.particleSystem.geometry.dispose();
            this.particleSystem.material.dispose();
            this.scene.remove(this.particleSystem);
        }
        if (this.gridRuler) {
            this.gridRuler.dispose();
        }
        if (this.hud) {
            this.hud.dispose();
        }
    }
}
