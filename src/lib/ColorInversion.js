/**
 * ColorInversion: 色反転エフェクト管理クラス
 * トラック2で使用
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { debugLog } from './DebugLogger.js';

export class ColorInversion {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.composer = null;
        this.inversionPass = null;
        this.enabled = false;
        this.endTime = 0;  // エフェクト終了時刻（サスティン用）
        this.initialized = false;  // 初期化完了フラグ
        
        // 初期化（非同期）
        this.init();
    }
    
    /**
     * 初期化
     */
    async init() {
        debugLog('colorInversion', '初期化開始');
        // シェーダーを読み込む
        const shaderBasePath = `/shaders/common/`;
        try {
            debugLog('colorInversion', `シェーダー読み込み開始 - ${shaderBasePath}colorInversion.vert`);
            const [vertexShader, fragmentShader] = await Promise.all([
                fetch(`${shaderBasePath}colorInversion.vert`).then(r => {
                    if (!r.ok) throw new Error(`Failed to load vertex shader: ${r.status}`);
                    return r.text();
                }),
                fetch(`${shaderBasePath}colorInversion.frag`).then(r => {
                    if (!r.ok) throw new Error(`Failed to load fragment shader: ${r.status}`);
                    return r.text();
                })
            ]);
            
            if (!vertexShader || !fragmentShader) {
                throw new Error('Shader files are empty');
            }
            
            debugLog('colorInversion', 'シェーダー読み込み完了');
            
            // EffectComposerを作成
            this.composer = new EffectComposer(this.renderer);
            
            // RenderPassを追加（通常のシーン描画）
            const renderPass = new RenderPass(this.scene, this.camera);
            this.composer.addPass(renderPass);
            
            // 色反転シェーダーを作成
            const inversionShader = {
                uniforms: {
                    tDiffuse: { value: null },
                    intensity: { value: 1.0 }  // 反転の強度（0.0〜1.0）
                },
                vertexShader: vertexShader,
                fragmentShader: fragmentShader
            };
            
            // ShaderPassを追加
            this.inversionPass = new ShaderPass(inversionShader);
            this.inversionPass.enabled = false;  // デフォルトでは無効
            this.composer.addPass(this.inversionPass);
            
            // 初期化完了
            this.initialized = true;
            debugLog('colorInversion', '初期化完了');
        } catch (err) {
            console.error('色反転シェーダーの読み込みに失敗:', err);
            // エラーでも初期化フラグを立てる（後で再試行できるように）
            this.initialized = true;
        }
    }
    
    /**
     * 色反転を有効化/無効化
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (this.inversionPass) {
            this.inversionPass.enabled = enabled;
            // スタックトレースを出力して、どこから呼ばれたか特定
            if (!enabled) {
                debugLog('colorInversion', `setEnabled: ${enabled}, 呼び出し元:`, new Error().stack.split('\n').slice(1, 4).join('\n'));
            } else {
                debugLog('colorInversion', `setEnabled: ${enabled}`);
            }
        } else {
            console.warn('ColorInversion: inversionPass is null');
        }
    }
    
    /**
     * 色反転エフェクトを適用（デュレーション付き）
     */
    apply(velocity, durationMs) {
        debugLog('colorInversion', `apply() - velocity:${velocity}, durationMs:${durationMs}`);
        
        // エフェクトを有効化
        this.setEnabled(true);
        
        // デュレーション（サスティン）を設定
        if (durationMs > 0) {
            this.endTime = Date.now() + durationMs;
            debugLog('colorInversion', `endTime設定: ${this.endTime} (現在時刻 + ${durationMs}ms)`);
        } else {
            // デュレーションが0の場合は無期限（キーが離されるまで）
            this.endTime = 0;
            debugLog('colorInversion', 'endTime=0 (無期限モード)');
        }
    }
    
    /**
     * 更新（サスティン終了チェック）
     */
    update() {
        if (this.endTime > 0 && Date.now() >= this.endTime) {
            // サスティン終了
            this.setEnabled(false);
            this.endTime = 0;
        }
    }
    
    /**
     * 色反転が有効かどうか
     */
    isEnabled() {
        return this.enabled;
    }
    
    /**
     * 描画（EffectComposerを使用）
     * EffectComposer内でRenderPassを使ってシーンをレンダリングし、色反転を適用する
     */
    render() {
        if (!this.initialized) {
            console.warn('ColorInversion: not initialized yet');
            return false;
        }
        if (!this.composer) {
            console.warn('ColorInversion: composer is null');
            return false;
        }
        if (!this.inversionPass) {
            console.warn('ColorInversion: inversionPass is null');
            return false;
        }
        if (this.enabled && this.inversionPass.enabled) {
            // EffectComposerがシーンをレンダリングして色反転を適用
            this.composer.render();
            return true;  // レンダリング済み
        }
        return false;  // レンダリングされなかった
    }
    
    /**
     * リサイズ処理
     */
    onResize() {
        if (this.composer) {
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
    }
    
    /**
     * 破棄
     */
    dispose() {
        if (this.composer) {
            // EffectComposerの破棄処理
            this.composer.dispose();
            this.composer = null;
        }
        this.inversionPass = null;
        this.enabled = false;
        this.endTime = 0;
    }
}

