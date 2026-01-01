/**
 * シーンマネージャー（WebGPU版）
 * 複数のシーンを管理し、切り替えを制御
 */

import { Scene01 } from '../scenes/scene01/Scene01.js';
import { Scene02 } from '../scenes/scene02/Scene02.js';
import { Scene03 } from '../scenes/scene03/Scene03.js';
import { Scene04 } from '../scenes/scene04/Scene04.js';

export class SceneManager {
    constructor(renderer, camera, sharedResourceManager = null) {
        this.renderer = renderer;
        this.camera = camera;
        this.sharedResourceManager = sharedResourceManager;
        this.scenes = [];
        this.currentSceneIndex = 0;
        this.onSceneChange = null;
        
        // HUDの状態をグローバルに保持（シーン切り替えに関係なく保持）
        this.globalShowHUD = true;

        // render を await するとメインループが詰まってFPSが上下に暴れやすいので、
        // ここで「1本だけin-flight」にして fire-and-forget で回す
        this._renderInFlight = false;

        // 切替時に止めないための「pending切替」
        // - switchScene() されたら、旧シーンを描画し続けながら新シーンを裏で setup
        // - setup完了した瞬間に currentSceneIndex を差し替える
        this._pendingSceneIndex = null;
        this._pendingSwitchToken = 0;
        
        // プリロード完了を待つためのPromise
        this._preloadPromise = null;
        this._preloadDone = false;
        this.onPreloadProgress = null; // プリロード進捗コールバック
        
        // シーン切り替え後の初回update/render計測用
        this._switchFrameCount = 0;
        this._switchStartTime = null;
        
        // シーンを初期化
        this.initScenes();
    }
    
    initScenes() {
        // WebGPU専用構成
        this.scenes.push(new Scene01(this.renderer, this.camera, this.sharedResourceManager));
        this.scenes.push(new Scene02(this.renderer, this.camera, this.sharedResourceManager));
        this.scenes.push(new Scene03(this.renderer, this.camera, this.sharedResourceManager));
        this.scenes.push(new Scene04(this.renderer, this.camera, this.sharedResourceManager));
        
        // 起動時に全部初期化（ライブ用途：切り替えは瞬時にしたい）
        this._setupDone = new Set();
        this._preloadPromise = this.preloadAllScenes()
            .then(() => {
                this._preloadDone = true;
                console.log('全シーンのプリロード完了');
            })
            .catch(err => {
                console.error('シーンのプリロードエラー:', err);
                this._preloadDone = true; // エラーでも完了扱い
            });
    }

    /**
     * 全シーンを起動時にsetupする（時間かかってOK / 切替は瞬時）
     */
    async preloadAllScenes() {
        const total = this.scenes.length;
        const originalSceneIndex = this.currentSceneIndex;
        
        for (let i = 0; i < this.scenes.length; i++) {
            const s = this.scenes[i];
            if (!s || this._setupDone.has(i)) continue;
            
            // 進捗コールバック
            if (this.onPreloadProgress) {
                this.onPreloadProgress(i + 1, total, s.title || `Scene ${i + 1}`);
            }
            
            await s.setup();
            this._setupDone.add(i);
            // HUDはグローバルに同期
            s.showHUD = this.globalShowHUD;
            if (s.hud) s.hud.showHUD = this.globalShowHUD;
            
            // 初回レンダリングを実行してシェーダーコンパイルを済ませる（ライブ用途：切り替え時の遅延を防ぐ）
            // 一時的にシーンを切り替えてレンダリング
            const tempSceneIndex = this.currentSceneIndex;
            this.currentSceneIndex = i;
            if (s.setResourceActive) s.setResourceActive(true);
            
            try {
                const renderStart = performance.now();
                if (s.render) {
                    await s.render();
                }
                const renderTime = performance.now() - renderStart;
                if (renderTime > 100) {
                    console.log(`シーン${i + 1}の初回レンダリング（プリロード）: ${renderTime.toFixed(2)}ms`);
                }
            } catch (err) {
                console.warn(`シーン${i + 1}の初回レンダリングエラー（無視）:`, err);
            } finally {
                // 元のシーンに戻す
                this.currentSceneIndex = tempSceneIndex;
                if (s.setResourceActive) s.setResourceActive(false);
                
                // パーティクルシステムの表示状態を明示的に復元（Scene01などで必要）
                // プリロード時のrender()実行後、表示状態が正しく設定されていない可能性があるため
                if (i === 0 && s.particleSystem && s.particleSystem.setVisible) {
                    // Scene01の場合、SHOW_PARTICLESの状態を反映
                    s.particleSystem.setVisible(!!s.SHOW_PARTICLES);
                }
            }
            
            console.log(`シーン${i + 1}をプリロード完了: ${s.title || `Scene ${i + 1}`}`);
        }
        
        // 元のシーンに戻す（念のため）
        this.currentSceneIndex = originalSceneIndex;
        
        // 現在のシーンをアクティブ化（プリロード完了後に表示されるように）
        const currentScene = this.scenes[this.currentSceneIndex];
        if (currentScene && currentScene.setResourceActive) {
            currentScene.setResourceActive(true);
        }
        
        // 最終進捗
        if (this.onPreloadProgress) {
            this.onPreloadProgress(total, total, '完了');
        }
    }
    
    /**
     * プリロードが完了しているか確認
     */
    isPreloadDone() {
        return this._preloadDone;
    }
    
    /**
     * プリロード完了を待つ
     */
    async waitForPreload() {
        if (this._preloadDone) return;
        if (this._preloadPromise) {
            await this._preloadPromise;
        }
    }
    
    async switchScene(index) {
        if (index < 0 || index >= this.scenes.length) {
            console.warn(`シーンインデックス ${index} は無効です`);
            return;
        }
        
        // 同じシーンへの切り替えは無視
        if (index === this.currentSceneIndex) {
            console.log(`既にシーン ${index + 1} がアクティブです`);
            return;
        }
        
        // プリロードが完了していない場合は待つ
        if (!this._preloadDone) {
            console.log('プリロード完了を待機中...');
            await this.waitForPreload();
        }
        
        // 旧シーン描画を止めずに切り替える：まず「切替要求」として保持
        this._pendingSceneIndex = index;
        const token = ++this._pendingSwitchToken;

        const newScene = this.scenes[index];
        if (!newScene) return;

        // プリロードが完了していれば、即座にシャドウ設定を適用（非同期チェーンを待たない）
        // 常に適用する（プリロード完了済みなら確実に設定されているはず）
        if (newScene._shadowMapEnabled !== undefined) {
            const shadowBefore = this.renderer.shadowMap.enabled;
            this.renderer.shadowMap.enabled = newScene._shadowMapEnabled;
            if (newScene._shadowMapType !== undefined) {
                this.renderer.shadowMap.type = newScene._shadowMapType;
            }
            const shadowAfter = this.renderer.shadowMap.enabled;
            console.log(`シャドウ設定を即座に適用: ${shadowBefore} → ${shadowAfter} (${newScene.title || `Scene ${index + 1}`})`);
            // 実際に反映されているか確認
            console.log(`確認(即座): renderer.shadowMap.enabled = ${this.renderer.shadowMap.enabled}`);
        } else {
            console.warn(`シーン${index + 1}のシャドウ設定が未定義: _shadowMapEnabled=${newScene._shadowMapEnabled}`);
        }

        // HUDの状態をグローバル状態に合わせる（準備中でも反映しておく）
        newScene.showHUD = this.globalShowHUD;
        if (newScene.hud) newScene.hud.showHUD = this.globalShowHUD;

        // 非アクティブ時は重い更新を止める（ただし旧シーンはまだアクティブのまま）
        if (newScene.setResourceActive) newScene.setResourceActive(false);

        // まだsetupしてないなら裏でやる（旧シーンは描画継続）
        // ただし、プリロードが完了していれば通常はsetup済みのはず
        const ensureSetup = async () => {
            if (this._setupDone?.has(index)) return;
            await newScene.setup();
            this._setupDone?.add(index);
        };

        ensureSetup()
            .then(() => {
                // 切替要求が最新ならここでスワップ（途中で別シーン要求されたら捨てる）
                if (token !== this._pendingSwitchToken) return;
                if (this._pendingSceneIndex !== index) return;

                const switchStartTime = performance.now();
                
                const oldScene = this.scenes[this.currentSceneIndex];
                if (oldScene?.setResourceActive) {
                    const deactivateStart = performance.now();
                    oldScene.setResourceActive(false);
                    const deactivateTime = performance.now() - deactivateStart;
                    if (deactivateTime > 1) {
                        console.log(`旧シーン非アクティブ化: ${deactivateTime.toFixed(2)}ms`);
                    }
                }

                this.currentSceneIndex = index;
                const activeScene = this.scenes[this.currentSceneIndex];
                
                if (activeScene?.setResourceActive) {
                    const activateStart = performance.now();
                    activeScene.setResourceActive(true);
                    const activateTime = performance.now() - activateStart;
                    if (activateTime > 1) {
                        console.log(`新シーンアクティブ化: ${activateTime.toFixed(2)}ms`);
                    }
                }

                // シャドウ設定を復元（各シーン固有の設定を適用）
                // プリロード完了済みの場合は既に適用済みだが、念のため再適用
                if (activeScene._shadowMapEnabled !== undefined) {
                    const shadowBefore = this.renderer.shadowMap.enabled;
                    this.renderer.shadowMap.enabled = activeScene._shadowMapEnabled;
                    if (activeScene._shadowMapType !== undefined) {
                        this.renderer.shadowMap.type = activeScene._shadowMapType;
                    }
                    const shadowAfter = this.renderer.shadowMap.enabled;
                    console.log(`シャドウ設定を復元: ${shadowBefore} → ${shadowAfter} (${activeScene.title || `Scene ${index + 1}`})`);
                    // 実際に反映されているか確認
                    console.log(`確認: renderer.shadowMap.enabled = ${this.renderer.shadowMap.enabled}`);
                } else {
                    console.warn(`シーン${index + 1}のシャドウ設定が未定義: _shadowMapEnabled=${activeScene._shadowMapEnabled}`);
                }

                // HUDの状態を改めて適用
                activeScene.showHUD = this.globalShowHUD;
                if (activeScene.hud) activeScene.hud.showHUD = this.globalShowHUD;

                const switchTime = performance.now() - switchStartTime;
                if (switchTime > 1) {
                    console.log(`シーン切り替え処理: ${switchTime.toFixed(2)}ms`);
                }

                // 切り替え後の初回update/render計測を開始
                this._switchFrameCount = 0;
                this._switchStartTime = performance.now();

                if (this.onSceneChange) this.onSceneChange(activeScene.title || `Scene ${index + 1}`);
                console.log(`シーン切り替え(ノンブロック): ${activeScene.title || `Scene ${index + 1}`}`);
            })
            .catch(err => {
                console.error('シーンのセットアップエラー:', err);
            });
    }
    
    update(deltaTime) {
        const scene = this.scenes[this.currentSceneIndex];
        if (scene) {
            // 切り替え直後の初回update計測
            if (this._switchStartTime !== null && this._switchFrameCount === 0) {
                const updateStart = performance.now();
                scene.update(deltaTime);
                const updateTime = performance.now() - updateStart;
                if (updateTime > 5) {
                    console.log(`初回update: ${updateTime.toFixed(2)}ms`);
                }
            } else {
                scene.update(deltaTime);
            }
        }
    }
    
    async render() {
        const scene = this.scenes[this.currentSceneIndex];
        if (!scene) return;
        if (this._renderInFlight) return;
        this._renderInFlight = true;
        
        // 切り替え直後の初回render計測
        const isFirstRender = this._switchStartTime !== null && this._switchFrameCount === 0;
        if (isFirstRender) {
            const renderStart = performance.now();
            Promise.resolve(scene.render())
                .then(() => {
                    const renderTime = performance.now() - renderStart;
                    if (renderTime > 5) {
                        console.log(`初回render: ${renderTime.toFixed(2)}ms`);
                    }
                    // 初回update/render計測を終了
                    if (this._switchStartTime !== null) {
                        const totalTime = performance.now() - this._switchStartTime;
                        if (totalTime > 10) {
                            console.log(`切り替え後の初回フレーム合計: ${totalTime.toFixed(2)}ms`);
                        }
                        this._switchStartTime = null;
                    }
                })
                .catch(err => console.error('シーンrenderエラー:', err))
                .finally(() => {
                    this._renderInFlight = false;
                    if (this._switchFrameCount === 0) {
                        this._switchFrameCount = 1;
                    }
                });
        } else {
            Promise.resolve(scene.render())
                .catch(err => console.error('シーンrenderエラー:', err))
                .finally(() => {
                    this._renderInFlight = false;
                });
        }
        
        if (this._switchFrameCount < 3) {
            this._switchFrameCount++;
        }
    }
    
    handleOSC(message) {
        const scene = this.scenes[this.currentSceneIndex];
        if (scene) {
            scene.handleOSC(message);
        }
    }
    
    onResize() {
        const scene = this.scenes[this.currentSceneIndex];
        if (scene && scene.onResize) {
            scene.onResize();
        }
    }
    
    /**
     * 現在のシーンを取得
     */
    getCurrentScene() {
        return this.scenes[this.currentSceneIndex] || null;
    }
}

